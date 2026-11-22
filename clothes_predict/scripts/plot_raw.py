"""畫出 data/clothes 每個 CSV 的原始折線圖，存到 out/raw_<檔名>.png。

uv run python scripts/plot_raw.py
"""
import matplotlib.pyplot as plt

from clothes_predict.data import OUT_DIR, list_files, load, setup_font

setup_font()
OUT_DIR.mkdir(exist_ok=True)

for path in list_files():
    df = load(path)
    hours = (df.index - df.index[0]).total_seconds() / 3600
    cols = [("hx711_raw", "HX711（重量）"), ("ads1115_raw", "ADS1115"), ("touch_raw", "touch"),
            ("air_temp_c", "氣溫 °C"), ("air_humi_pct", "濕度 %")]
    fig, axes = plt.subplots(len(cols), 1, figsize=(12, 11), sharex=True)
    for ax, (col, label) in zip(axes, cols):
        ax.plot(hours, df[col], lw=0.6, color="#3b6fb6")
        ax.set_ylabel(label)
        ax.grid(alpha=0.3)
    axes[0].set_title(f"{path.name}\n起始 {df.index[0]}  共 {len(df)} 筆  {hours[-1]:.1f} 小時")
    axes[-1].set_xlabel("經過時間（小時）")
    fig.tight_layout()
    out = OUT_DIR / f"raw_{path.stem}.png"
    fig.savefig(out, dpi=110)
    plt.close(fig)
    print(out)
