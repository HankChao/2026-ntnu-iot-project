"""方法 B：曲線擬合（加先驗的非線性最小平方，MAP），每次預測都用「到目前為止的全部資料」重新擬合。

    uv run python scripts/predict_curve_fit.py                 # 兩段式模型 + 失水量先驗（預設）
    uv run python scripts/predict_curve_fit.py --model exp     # 指數模型
    uv run python scripts/predict_curve_fit.py --no-prior      # 不加先驗，看看純擬合在前期多不穩

模型：W(t) = Wd + m(t)，m(t) 見 clothes_predict/models.py
參數：Wd、W_start（t=0 的重量）、log 速率（twophase：R；exp：k）；twophase 的 Mc = MC_RATIO * (W_start - Wd)
殘差：
    量測：(W_obs - W(t)) / MEAS_SD × 遺忘權重，用 soft_l1 降低滴水、碰撞的影響
    先驗：(W_start - Wd - loss) / loss_sd   ← 和 Kalman 用的同一個先驗
和 Kalman 比：概念直觀、整段一起看比較穩，但每次都要重算（資料越多越慢），
移到 TypeScript 需要自己寫 Levenberg–Marquardt（3 個參數，不難）。
"""
import argparse

import numpy as np
from scipy.optimize import least_squares

from clothes_predict.evaluate import DRY_LEVEL, Prediction, replay
from clothes_predict.models import exp_m, exp_time_to, twophase_m, twophase_time_to

MC_RATIO = 0.2
MEAS_SD = 1500.0   # 不是感測器雜訊，是「模型誤差」：殘差有漂移、跳階且前後相關，設太小會讓先驗完全沒作用
FORGET_H = 3.0     # 遺忘：越舊的點權重越低（e 倍 / 3 小時），讓擬合跟上速率變化
SKIP = 5  # 掛上後前 5 分鐘還在晃


class CurveFit:
    def __init__(self, prior, model="twophase", use_prior=True):
        self.prior, self.model, self.use_prior = prior, model, use_prior
        self.t, self.w = [], []
        self.theta = None

    def update(self, t, w, aux=None):
        self.t.append(t)
        self.w.append(w)

    def _m(self, theta, t):
        wd, ws, lr = theta
        m0 = max(ws - wd, 1.0)
        if self.model == "twophase":
            return twophase_m(m0, np.exp(lr), MC_RATIO * m0, t)
        return exp_m(m0, np.exp(lr), t)

    def _fit(self):
        t = np.array(self.t[SKIP:]) - self.t[SKIP]
        w = np.array(self.w[SKIP:])
        L, sd = self.prior["loss"], self.prior["loss_sd"]
        lr0 = np.log(3000.0 if self.model == "twophase" else 0.25)
        weight = np.exp(-(t[-1] - t) / FORGET_H / 2)  # 殘差乘 sqrt(權重)

        def resid(theta):
            r = (w - (theta[0] + self._m(theta, t))) / MEAS_SD * weight
            if self.use_prior:
                r = np.append(r, [(theta[1] - theta[0] - L) / sd, (theta[2] - lr0) / 1.5])
            return r

        x0 = self.theta if self.theta is not None else np.array([w[0] - L, w[0], lr0])
        lo = [w.min() - 5 * L, w.max() - 2 * L, lr0 - 6]
        hi = [w.min(), w.max() + 2 * L, lr0 + 6]
        x0 = np.clip(x0, np.array(lo) + 1e-6, np.array(hi) - 1e-6)
        self.theta = least_squares(resid, x0, bounds=(lo, hi), loss="soft_l1", f_scale=3.0).x
        return t

    def predict(self):
        t = self._fit()
        t_off = self.t[SKIP]
        wd, ws, lr = self.theta
        total = ws - wd
        now = t[-1]
        m_now = float(self._m(self.theta, now))
        target = (1 - DRY_LEVEL) * total
        if self.model == "twophase":
            t_rem = twophase_time_to(m_now, np.exp(lr), MC_RATIO * total, target)
        else:
            t_rem = exp_time_to(m_now, np.exp(lr), target)
        progress = (ws - (wd + m_now)) / total
        past_t = np.linspace(0, now, 100)
        fut_t = np.linspace(now, now + min(t_rem, 24) + 1, 100)
        return Prediction(progress, t_off + now + t_rem, wd,
                          fut_t + t_off, wd + self._m(self.theta, fut_t),
                          past_t + t_off, wd + self._m(self.theta, past_t))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["twophase", "exp"], default="twophase")
    ap.add_argument("--no-prior", action="store_true")
    a = ap.parse_args()
    name = f"curvefit_{a.model}" + ("_noprior" if a.no_prior else "")
    replay(lambda prior: CurveFit(prior, a.model, not a.no_prior), name=name)
