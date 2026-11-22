"""把 5 段晾衣資料整理成同一張圖：重量、ADS1115、touch 都正規化到 0~1 後疊在一起比較。

- 重量進度 = (W0 - W) / (W0 - W_end)：W0 取掛上後 5 分鐘中位數，W_end 取最後 30 分鐘中位數
- 也標出 ADS1115 到頂（>= 98%）、重量進度到 95% 的時間

uv run python scripts/plot_sessions.py
"""
import matplotlib.pyplot as plt
import numpy as np

from clothes_predict.data import OUT_DIR, SESSIONS, load_session, setup_font

setup_font()
OUT_DIR.mkdir(exist_ok=True)


def norm(s, lo, hi):
    return (s - lo) / (hi - lo)


fig, axes = plt.subplots(len(SESSIONS), 1, figsize=(12, 3.2 * len(SESSIONS)))
print(f"{'session':10} {'hours':>6} {'W0':>8} {'W_end':>8} {'loss':>7} {'before':>8} {'t95%':>6} {'ADS頂':>6} {'touch頂':>7}")
for ax, sess in zip(axes, SESSIONS):
    m = load_session(sess)
    t = m["t_h"].to_numpy()
    w = m["hx711_raw"].rolling(5, center=True, min_periods=1).median()
    w0 = w.iloc[3:8].median()
    w_end = w.iloc[-30:].median()
    prog = norm(w0 - w, 0, w0 - w_end)

    ads = m["ads1115_raw"].rolling(9, center=True, min_periods=1).median()
    ads_n = norm(ads, ads.iloc[5:30].median(), ads.iloc[-30:].median())
    touch = m["touch_raw"].rolling(9, center=True, min_periods=1).median()
    touch_n = norm(touch, touch.iloc[5:30].median(), touch.iloc[-30:].median())

    def first(mask):
        idx = np.argmax(mask.to_numpy()) if mask.any() else None
        return t[idx] if idx is not None else float("nan")

    t95 = first(prog >= 0.95)
    t_ads = first(ads_n >= 0.98)
    t_touch = first(touch_n >= 0.98)
    print(f"{sess['id']:10} {t[-1]:6.1f} {w0:8.0f} {w_end:8.0f} {w0 - w_end:7.0f} "
          f"{sess['before_raw'] or float('nan'):8.0f} {t95:6.2f} {t_ads:6.2f} {t_touch:7.2f}")

    ax.plot(t, prog, label="重量進度", color="#2a6fdb", lw=1.6)
    ax.plot(t, ads_n, label="ADS1115（正規化）", color="#e07b00", lw=1, alpha=0.8)
    ax.plot(t, touch_n, label="touch（正規化）", color="#2e9e5b", lw=1, alpha=0.8)
    for x, c in ((t95, "#2a6fdb"), (t_ads, "#e07b00"), (t_touch, "#2e9e5b")):
        ax.axvline(x, color=c, ls="--", lw=0.8)
    ax.set_ylim(-0.15, 1.15)
    ax.set_title(f"{sess['id']}  失水 {w0 - w_end:.0f} counts  重量95% @ {t95:.1f}h  ADS到頂 @ {t_ads:.1f}h", fontsize=10)
    ax.grid(alpha=0.3)
axes[0].legend(loc="lower right", fontsize=8)
axes[-1].set_xlabel("掛上後經過時間（小時）")
fig.tight_layout()
out = OUT_DIR / "sessions_overview.png"
fig.savefig(out, dpi=110)
print(out)
