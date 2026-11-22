"""方法 A：擴展卡爾曼濾波（EKF），逐筆更新，可直接移植到 Bun/TypeScript（只有 3x3 矩陣）。

    uv run python scripts/predict_kalman.py            # 兩段式模型（預設）
    uv run python scripts/predict_kalman.py --model exp  # 指數模型（對照組）
    uv run python scripts/predict_kalman.py --wind off   # 不使用風的指標
    uv run python scripts/predict_kalman.py --prior all  # 先驗用全部場次平均（不分衣物）

風（電風扇）：乾燥速率會變好幾倍。wind 指標 = 每分鐘 hx711 讀值的 IQR（見 data.load_session）。
    --wind inflate（預設）：有風／沒風切換的那一刻，把 log R 的變異數加大，讓速率很快重新收斂；
                         有風時量測雜訊也放大（重量會晃）
    --wind gain          ：另外假設有風時 R 直接乘上 FAN_GAIN，切換當下就反映
    未來曲線假設「目前有沒有風」會持續下去。

ADS1115 融合（--ads on，預設）：ADS 到頂（15 分鐘中位數 > 25,500，且比之前的最低點高 300 以上）時，
    加一次「進度 = 0.9 ± 0.08」的觀測。5 場到頂時的實際進度是 0.84~1.03。
    這能解決「重量變平是因為速率變慢，還是因為快乾了」的混淆，對沒有歷史紀錄的衣物特別有用。

狀態 x = [m, r, Wd]
    m  ：衣物裡剩下的水（counts）
    r  ：速率參數取 log（保證為正）。twophase：R = exp(r) 為等速期蒸發速率（counts/h）；
         exp：k = exp(r) 為速率常數（1/h）
    Wd ：乾重（counts，含夾子歸零偏移）
動態：m 依模型（clothes_predict/models.py）推進 dt，r、Wd 隨機漫步
量測：W = Wd + m
twophase 的臨界含水量 Mc = MC_RATIO * (W0 - Wd)

先驗：失水量 ~ N(loss, loss_sd)，正式環境用「這件衣物過去的紀錄」，這裡用其他場次平均（留一法）。
剛掛上時重量幾乎直線下降，光看重量分不出乾重在哪，所以前期預測主要靠這個先驗。

輸出：
    進度 = (W0 - W_filtered) / (W0 - Wd)
    乾燥時間 = m 降到總水量 5% 的時間（解析解）
"""
import argparse

import numpy as np

from clothes_predict import evaluate
from clothes_predict.evaluate import DRY_LEVEL, WIND_ON, Prediction, replay
from clothes_predict.models import exp_m, exp_time_to, twophase_m, twophase_time_to

MC_RATIO = 0.2
FAN_GAIN = np.log(4.0)   # --wind gain：有風時速率 ×4（S4 實測約 4~6 倍）
WIND_SWITCH_VAR = 1.0    # --wind inflate：切換時 log R 變異數增加量（≈ 允許速率變 e 倍）
WIND_MEAS_MULT = 3.0     # 有風時量測雜訊放大倍數
WIND_DEBOUNCE = 3        # 連續幾筆才切換有風／沒風（碰衣夾也會讓 IQR 暫時變大）
ADS_DRY, ADS_RISE, ADS_WIN = 25_500, 300, 15
ADS_PROGRESS, ADS_PROGRESS_SD = 0.9, 0.08


class EKF:
    MEAS_SD = 400.0      # 1 分鐘中位數的量測雜訊（counts）
    GATE_SD = 25.0       # 創新值超過 25σ（約 1 萬 counts）視為有人碰衣夾，丟掉

    def __init__(self, prior, model="twophase", wind="inflate", ads=True):
        self.prior, self.model, self.wind_mode, self.use_ads = prior, model, wind, ads
        self.ads_buf, self.ads_min, self.ads_done = [], np.inf, False
        self.windy = False
        self.wind_run = 0    # 和目前狀態相反的連續筆數
        # r 是 log 速率；r0_sd = 1 表示先驗允許差 e 倍
        self.r0 = np.log(3000.0 if model == "twophase" else 0.25)   # counts/h 或 1/h
        self.r0_sd = 1.0
        self.Q = np.diag([1000.0**2, 0.3**2, 30.0**2])               # 每小時過程雜訊：m、log 速率、Wd
        self.x = None
        self.buf = []      # 掛上後前 5 分鐘還在晃，取中位數再開始
        self.past = []

    # m 推進 dt 小時
    def _step_m(self, x, dt):
        m, r, wd = x
        if self.wind_mode == "gain" and self.windy:
            r = r + FAN_GAIN
        if self.model == "twophase":
            mc = MC_RATIO * max(self.w0 - wd, 1.0)
            return float(twophase_m(m, np.exp(r), mc, dt))
        return float(exp_m(m, np.exp(r), dt))

    def _f(self, x, dt):
        return np.array([self._step_m(x, dt), x[1], x[2]])

    def _jac(self, x, dt):
        # 數值微分，TypeScript 版也這樣寫最簡單
        J = np.eye(3)
        f0 = self._f(x, dt)
        for i, h in enumerate((1.0, 1e-4, 1.0)):
            xp = x.copy()
            xp[i] += h
            J[:, i] = (self._f(xp, dt) - f0) / h
        return J

    def update(self, t, w, aux=None):
        wind = (aux or {}).get("wind")
        settling = self.x is None or t - self.t0 < 10 / 60   # 掛上後 10 分鐘內的晃動不算風
        raw = bool(self.wind_mode != "off" and not settling and wind is not None and wind == wind and wind > WIND_ON)
        self.wind_run = self.wind_run + 1 if raw != self.windy else 0
        switched = self.wind_run >= WIND_DEBOUNCE
        if switched:
            self.windy, self.wind_run = raw, 0
        windy = self.windy
        if self.x is None:
            self.buf.append(w)
            self.past.append((t, w))
            if len(self.buf) < 5:
                return
            w = float(np.median(self.buf))
            L, sd = self.prior["loss"], self.prior["loss_sd"]
            self.x = np.array([L, self.r0, w - L])
            # m + Wd = 量到的重量，所以兩者完全負相關
            self.P = np.array([[sd**2, 0, -sd**2],
                               [0, self.r0_sd**2, 0],
                               [-sd**2, 0, sd**2 + self.MEAS_SD**2]])
            self.t, self.w0, self.t0 = t, w, self.past[0][0]
            return
        dt = t - self.t
        self.t = t
        if switched and self.wind_mode == "inflate":
            self.P[1, 1] += WIND_SWITCH_VAR
        F = self._jac(self.x, dt)
        self.x = self._f(self.x, dt)
        self.P = F @ self.P @ F.T + self.Q * dt
        H = np.array([1.0, 0.0, 1.0])
        y = w - H @ self.x
        meas_sd = self.MEAS_SD * (WIND_MEAS_MULT if windy else 1.0)
        S = H @ self.P @ H + meas_sd**2
        if y * y / S < self.GATE_SD**2:
            K = self.P @ H / S
            self.x = self.x + K * y
            self.P = (np.eye(3) - np.outer(K, H)) @ self.P
            self.P = (self.P + self.P.T) / 2
        if self.use_ads:
            self._ads_update((aux or {}).get("ads1115_raw"))
        self.x[0] = max(self.x[0], 0.0)
        self.past.append((t, self.x[0] + self.x[2]))

    def _ads_update(self, ads):
        if ads is None or ads != ads or self.ads_done:
            return
        self.ads_buf = (self.ads_buf + [ads])[-ADS_WIN:]
        if len(self.ads_buf) < 5 or self.t - self.t0 < 0.3:
            return
        med = float(np.median(self.ads_buf))
        self.ads_min = min(self.ads_min, med)
        if med > ADS_DRY and med - self.ads_min > ADS_RISE:
            self.ads_done = True
            # 非線性觀測 h(x) = 進度 = (w0 - m - Wd) / (w0 - Wd)，數值微分求 H
            def h(x):
                return (self.w0 - x[0] - x[2]) / max(self.w0 - x[2], 1.0)
            H = np.array([(h(self.x + e) - h(self.x)) / d for e, d in
                          ((np.array([1.0, 0, 0]), 1.0), (np.array([0, 1e-4, 0]), 1e-4), (np.array([0, 0, 1.0]), 1.0))])
            y = ADS_PROGRESS - h(self.x)
            S = H @ self.P @ H + ADS_PROGRESS_SD**2
            K = self.P @ H / S
            self.x = self.x + K * y
            self.P = (np.eye(3) - np.outer(K, H)) @ self.P
            self.P = (self.P + self.P.T) / 2

    def predict(self):
        m, r, wd = self.x
        if self.wind_mode == "gain" and self.windy:
            r = r + FAN_GAIN
        r = np.exp(r)
        total = self.w0 - wd
        progress = (self.w0 - (m + wd)) / total if total > 0 else np.nan
        target = (1 - DRY_LEVEL) * total
        if total <= 0:
            t_rem = np.inf
        elif self.model == "twophase":
            t_rem = twophase_time_to(m, r, MC_RATIO * total, target)
        else:
            t_rem = exp_time_to(m, r, target)
        t_dry = self.t + t_rem
        horizon = self.t + min(t_rem, 24) + 1
        ft = np.linspace(self.t, horizon, 120)
        if self.model == "twophase":
            fw = wd + twophase_m(m, r, MC_RATIO * max(total, 1.0), ft - self.t)
        else:
            fw = wd + exp_m(m, r, ft - self.t)
        past = np.array(self.past)
        return Prediction(progress, t_dry, wd, ft, fw, past[:, 0], past[:, 1])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["twophase", "exp"], default="twophase")
    ap.add_argument("--wind", choices=["inflate", "gain", "off"], default="inflate")
    ap.add_argument("--prior", choices=["garment", "all"], default="garment")
    ap.add_argument("--ads", choices=["on", "off"], default="on")
    args = ap.parse_args()
    evaluate.PRIOR_MODE["same_garment"] = args.prior == "garment"
    name = (f"kalman_{args.model}_wind-{args.wind}_ads-{args.ads}"
            + ("_prior-all" if args.prior == "all" else ""))
    replay(lambda prior: EKF(prior, args.model, args.wind, args.ads == "on"), name=name)
