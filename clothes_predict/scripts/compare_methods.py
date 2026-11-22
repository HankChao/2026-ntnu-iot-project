"""把各方法放在一起比：預測乾燥時間的誤差隨「經過時間 / 實際乾燥時間」的變化。

    uv run python scripts/compare_methods.py

指標（只看還沒乾的期間 20%~90%）：
    ETA MAE：|預測乾燥時間 - 實際| 的平均（小時）
    相對誤差：同上除以實際乾燥時間
    進度 MAE：線上估計進度和真值的平均差
另外列出 S4（有開電風扇）在「最後一次開風扇後 15/30/60 分鐘」的預測：
開風扇前不可能知道之後會開，所以看的是開了以後多快修正。
"""
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from predict_curve_fit import CurveFit  # noqa: E402
from predict_history_mean import HistoryMean  # noqa: E402
from predict_kalman import EKF  # noqa: E402

from clothes_predict import evaluate  # noqa: E402
from clothes_predict.data import OUT_DIR, setup_font  # noqa: E402

# (名稱, 建立估計器, 先驗是否只用同一件衣物)
METHODS = [
    ("EKF 兩段式 風+ADS", lambda p: EKF(p, "twophase", "inflate", True), True),
    ("EKF 兩段式 風+ADS 先驗不分", lambda p: EKF(p, "twophase", "inflate", True), False),
    ("EKF 兩段式 ADS", lambda p: EKF(p, "twophase", "off", True), True),
    ("EKF 兩段式 風", lambda p: EKF(p, "twophase", "inflate", False), True),
    ("EKF 兩段式 風gain", lambda p: EKF(p, "twophase", "gain", False), True),
    ("EKF 兩段式 純重量", lambda p: EKF(p, "twophase", "off", False), True),
    ("EKF 兩段式 純重量 先驗不分", lambda p: EKF(p, "twophase", "off", False), False),
    ("EKF 指數 純重量", lambda p: EKF(p, "exp", "off", False), True),
    ("擬合 兩段式+先驗", lambda p: CurveFit(p, "twophase", True), True),
    ("擬合 兩段式 無先驗", lambda p: CurveFit(p, "twophase", False), True),
    ("歷史平均（現行做法）", HistoryMean, True),
]


def fan_onset(m):
    """最後一次「連續 3 分鐘以上有風」開始的時間（小時），沒有就回 None。"""
    windy = (m["wind"] > evaluate.WIND_ON).to_numpy()
    t = m["t_h"].to_numpy()
    onset = None
    for k in range(10, len(t) - 2):
        if windy[k] and windy[k + 1] and windy[k + 2] and not windy[k - 1]:
            onset = t[k]
    return onset

setup_font()
data = evaluate.all_sessions()
evaluate.plot_results = lambda *a, **k: None   # 這裡不畫各方法的大圖
evaluate.print_summary = lambda *a, **k: None
bins = np.linspace(0.1, 1.0, 10)
fig, ax = plt.subplots(figsize=(9, 5))
print(f"{'方法':24} {'ETA MAE(h)':>10} {'排除S4':>7} {'相對誤差':>8} {'進度MAE':>8}   S4 開風扇後 +15/+30/+60 分的預測（實際 4.90h）")
for name, make, same_garment in METHODS:
    evaluate.PRIOR_MODE["same_garment"] = same_garment
    res = evaluate.replay(make, data, name)
    fan = []
    for r in res:
        on = fan_onset(r["m"]) if r["sess"].get("fan") else None
        if on is not None:
            log = r["log"]
            for dt in (0.25, 0.5, 1.0):
                k = min(np.searchsorted(log[:, 0], on + dt), len(log) - 1)
                fan.append(log[k, 1])
    abs_e, rel_e, prog_e, frac, nofan = [], [], [], [], []
    for r in res:
        log, td = r["log"], r["truth"]["t_dry"]
        f = log[:, 0] / td
        ok = (f >= 0.2) & (f <= 0.9)
        e = np.abs(np.clip(log[:, 1], 0, 5 * td) - td)
        abs_e += list(e[ok]); rel_e += list(e[ok] / td); frac += list(f[ok])
        if not r["sess"].get("fan"):
            nofan += list(e[ok])
        prog_e += list(np.abs(np.clip(log[ok, 2], 0, 1.5) - log[ok, 3]))
    print(f"{name:24} {np.mean(abs_e):10.2f} {np.mean(nofan):7.2f} {np.mean(rel_e):8.0%} {np.mean(prog_e):8.3f}   "
          + " ".join(f"{v:5.2f}" for v in fan))
    frac, rel_e = np.array(frac), np.array(rel_e)
    idx = np.digitize(frac, bins)
    ys = [np.mean(rel_e[idx == i]) if np.any(idx == i) else np.nan for i in range(1, len(bins))]
    ax.plot((bins[:-1] + bins[1:]) / 2, ys, marker="o", label=name)
ax.set_xlabel("經過時間 / 實際乾燥時間")
ax.set_ylabel("預測乾燥時間相對誤差（越低越好）")
ax.set_ylim(0, 1.5)
ax.grid(alpha=0.3)
ax.legend()
ax.set_title("各方法比較（5 場；先驗用留一法）")
fig.tight_layout()
out = OUT_DIR / "compare_methods.png"
fig.savefig(out, dpi=110)
print(out)
