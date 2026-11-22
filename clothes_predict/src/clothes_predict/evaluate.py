"""線上（逐筆）回放評估：模擬正式環境每分鐘收到一筆，每 10 分鐘問一次預測。

估計器介面（Kalman、曲線擬合都實作這個）：
    est = Estimator(prior)          # prior = dict(loss, loss_sd)：失水量的先驗
    est.update(t_h, w, aux)         # 每收到一筆就呼叫；aux = dict(wind, ads1115_raw, touch_raw, air_temp_c, air_humi_pct)，用不到可以忽略
    est.predict() -> Prediction     # 任何時間都可以問

「乾」的定義（離線真值）：重量進度 >= DRY_LEVEL，進度用整段資料的 W0、W_end 算。
線上預測時不知道 W_end，要靠模型估計乾重 Wd。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import matplotlib.pyplot as plt
import numpy as np

from .data import OUT_DIR, SESSIONS, load_session, setup_font

DRY_LEVEL = 0.95
WIND_ON = 800  # wind（每分鐘 hx711 IQR）超過這個值視為有風
EVAL_EVERY_MIN = 10


@dataclass
class Prediction:
    progress: float                  # 目前乾燥進度 0~1（以估計的乾重計算）
    t_dry: float                     # 預測「乾」的時間（掛上後小時數），np.inf 表示算不出來
    w_dry: float                     # 估計乾重（counts）
    future_t: np.ndarray = field(default_factory=lambda: np.array([]))
    future_w: np.ndarray = field(default_factory=lambda: np.array([]))
    past_t: np.ndarray = field(default_factory=lambda: np.array([]))   # 濾波後的過去曲線（可選）
    past_w: np.ndarray = field(default_factory=lambda: np.array([]))


def truth(m) -> dict:
    w = m["hx711_raw"].rolling(5, center=True, min_periods=1).median()
    w0 = float(w.iloc[3:8].median())
    w_end = float(w.iloc[-30:].median())
    prog = (w0 - w) / (w0 - w_end)
    t = m["t_h"].to_numpy()
    idx = int(np.argmax(prog.to_numpy() >= DRY_LEVEL))
    return dict(w0=w0, w_end=w_end, loss=w0 - w_end, t_dry=float(t[idx]), progress=prog.to_numpy())


def all_sessions():
    data = []
    for s in SESSIONS:
        m = load_session(s)
        data.append((s, m, truth(m)))
    return data


def loo_prior(data, i, same_garment=True) -> dict:
    """留一法先驗（相當於衣物歷史紀錄，不是訓練模型）。

    same_garment=True：只用同一件衣物的其他場次；沒有紀錄時才退回所有其他場次的平均，標準差放寬到 40%。
    """
    garment = data[i][0]["garment"]
    same = [d[2]["loss"] for j, d in enumerate(data) if j != i and d[0]["garment"] == garment]
    if same_garment and same:
        mean = float(np.mean(same))
        # 同一件衣物：剩下的不確定性主要是吸水量差異和漂移，至少給 10%
        return dict(loss=mean, loss_sd=max(float(np.std(same)), 0.10 * mean), source=f"同衣物 {len(same)} 場")
    others = np.array([d[2]["loss"] for j, d in enumerate(data) if j != i])
    mean = float(others.mean())
    return dict(loss=mean, loss_sd=max(float(others.std()), 0.40 * mean), source="無紀錄，用全部平均")


PRIOR_MODE = dict(same_garment=True)


def replay(make_estimator, data=None, name="method"):
    """回放所有場次，回傳每場的 (t, 預測乾燥時間, 進度) 紀錄，並畫圖。"""
    setup_font()
    OUT_DIR.mkdir(exist_ok=True)
    data = data or all_sessions()
    results = []
    for i, (sess, m, tr) in enumerate(data):
        prior = loo_prior(data, i, **PRIOR_MODE)
        prior["_session"] = sess
        est = make_estimator(prior)
        t = m["t_h"].to_numpy()
        w = m["hx711_raw"].to_numpy()
        aux = m[["wind", "ads1115_raw", "touch_raw", "air_temp_c", "air_humi_pct"]].to_dict("records")
        log = []          # (t, t_dry_pred, progress_pred, true_progress)
        snaps = {}        # 進度 25/50/75% 時的完整預測，用來畫曲線
        snap_at = {f: f * tr["t_dry"] for f in (0.25, 0.5, 0.75)}
        for k in range(len(t)):
            est.update(t[k], w[k], aux[k])
            if k % EVAL_EVERY_MIN or k < 10:
                continue
            p = est.predict()
            log.append((t[k], p.t_dry, p.progress, tr["progress"][k]))
            for f, ts in snap_at.items():
                if f not in snaps and t[k] >= ts:
                    snaps[f] = (t[k], p)
        results.append(dict(sess=sess, m=m, truth=tr, log=np.array(log), snaps=snaps, prior=prior))
    plot_results(results, name)
    print_summary(results, name)
    return results


def print_summary(results, name):
    print(f"\n[{name}]  預測乾燥時間誤差（小時，預測 - 實際），在實際乾燥時間的 25/50/75% 時")
    print(f"{'session':10} {'衣物':6} {'實際':>6} {'@25%':>7} {'@50%':>7} {'@75%':>7}  {'進度誤差MAE':>10}  先驗")
    for r in results:
        tr, log = r["truth"], r["log"]
        errs = []
        for f in (0.25, 0.5, 0.75):
            k = np.searchsorted(log[:, 0], f * tr["t_dry"])
            errs.append(log[min(k, len(log) - 1), 1] - tr["t_dry"])
        before = log[:, 0] <= tr["t_dry"]
        mae = np.nanmean(np.abs(np.clip(log[before, 2], 0, 1.5) - log[before, 3]))
        p = r["prior"]
        print(f"{r['sess']['id']:10} {r['sess']['garment']:6} {tr['t_dry']:6.2f} " + " ".join(f"{e:7.2f}" for e in errs)
              + f"  {mae:10.3f}  {p['loss']:.0f}±{p['loss_sd']:.0f}（{p['source']}）")


def plot_results(results, name):
    n = len(results)
    fig, axes = plt.subplots(n, 3, figsize=(17, 3.3 * n), gridspec_kw=dict(width_ratios=[2.2, 1.2, 1.2]))
    colors = {0.25: "#d1495b", 0.5: "#edae49", 0.75: "#00798c"}
    for row, r in zip(axes, results):
        m, tr, log = r["m"], r["truth"], r["log"]
        t, w = m["t_h"].to_numpy(), m["hx711_raw"].to_numpy()
        # 1) 重量 + 三個時間點的「過去 + 預測未來」曲線
        ax = row[0]
        ax.plot(t, w, color="#999", lw=0.8, label="量測（1 分鐘中位數）")
        windy = m["wind"].to_numpy() > WIND_ON
        if windy.any():
            ax.fill_between(t, 0, 1, where=windy, transform=ax.get_xaxis_transform(),
                            color="#7fb3ff", alpha=0.18, lw=0, label="有風（wind 指標）")
        for f, (ts, p) in sorted(r["snaps"].items()):
            if len(p.past_t):
                ax.plot(p.past_t, p.past_w, color=colors[f], lw=1.2)
            if len(p.future_t):
                ax.plot(p.future_t, p.future_w, color=colors[f], lw=1.6, ls="--",
                        label=f"在 {ts:.1f}h 的預測（乾 @ {p.t_dry:.1f}h）")
            ax.axvline(ts, color=colors[f], lw=0.6, alpha=0.6)
        ax.axhline(tr["w_end"], color="k", lw=0.6, ls=":")
        ax.axvline(tr["t_dry"], color="k", lw=1, label=f"實際乾 @ {tr['t_dry']:.1f}h")
        lo, hi = tr["w_end"] - 0.4 * tr["loss"], tr["w0"] + 0.15 * tr["loss"]
        ax.set_ylim(lo, hi)
        ax.set_xlim(0, max(t[-1], tr["t_dry"]) * 1.05)
        ax.set_title(f"{r['sess']['id']}（{r['sess']['garment']}）重量與預測曲線", fontsize=10)
        ax.legend(fontsize=7, loc="upper right")
        ax.grid(alpha=0.3)
        # 2) 預測乾燥時間 vs 經過時間
        ax = row[1]
        ax.plot(log[:, 0], np.clip(log[:, 1], 0, 3 * tr["t_dry"]), color="#2a6fdb")
        ax.axhline(tr["t_dry"], color="k", lw=1)
        ax.fill_between(log[:, 0], tr["t_dry"] - 0.5, tr["t_dry"] + 0.5, color="k", alpha=0.08)
        ax.set_title("預測乾燥時間（灰帶 ±30 分）", fontsize=10)
        ax.set_ylim(0, 2.5 * tr["t_dry"])
        ax.grid(alpha=0.3)
        # 3) 進度
        ax = row[2]
        ax.plot(log[:, 0], log[:, 3], color="k", lw=1, label="真值")
        ax.plot(log[:, 0], np.clip(log[:, 2], -0.2, 1.3), color="#2a6fdb", label="線上估計")
        ax.set_title("乾燥進度", fontsize=10)
        ax.set_ylim(-0.2, 1.3)
        ax.legend(fontsize=7)
        ax.grid(alpha=0.3)
    for ax in axes[-1]:
        ax.set_xlabel("掛上後經過時間（小時）")
    fig.suptitle(name, fontsize=13)
    fig.tight_layout()
    out = OUT_DIR / f"predict_{name}.png"
    fig.savefig(out, dpi=100)
    plt.close(fig)
    print(out)
