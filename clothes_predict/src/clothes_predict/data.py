"""讀取 data/*.csv 的共用函式。"""
from __future__ import annotations

import os
from pathlib import Path

import matplotlib
import pandas as pd

DATA_DIR = Path(os.environ.get("CLOTHES_DATA_DIR") or Path(__file__).resolve().parents[2] / "data")
OUT_DIR = Path(__file__).resolve().parents[2] / "out"


def setup_font() -> None:
    """讓 matplotlib 顯示中文（macOS 內建字型）。"""
    matplotlib.rcParams["font.sans-serif"] = ["PingFang TC", "Heiti TC", "Hiragino Sans GB", "Arial Unicode MS", "DejaVu Sans"]
    matplotlib.rcParams["axes.unicode_minus"] = False


def list_files() -> list[Path]:
    return sorted(DATA_DIR.glob("*.csv"))


# 伺服器 CSV 匯出的戶外欄位（中央氣象署測站，見 iot_server README「戶外觀測」）。
# 舊的 CSV 沒有這些欄位，讀進來是 NaN。
OUTDOOR_COLUMNS = [
    "out_temp_c", "out_humi_pct", "out_wind_ms", "out_wind_dir_deg", "out_gust_ms", "out_pressure_hpa",
    "out_rain_10min_mm", "out_rain_1h_mm", "out_rain_day_mm", "out_sunshine_h", "out_sunshine_1h_h",
    "out_radiation_1h_mj", "out_uv",
]
COLUMNS = ["hx711_raw", "ads1115_raw", "touch_raw", "air_temp_c", "air_humi_pct", *OUTDOOR_COLUMNS]


def load(path: Path) -> pd.DataFrame:
    """回傳以台北時間為 index 的 DataFrame，欄位統一為 COLUMNS（感測值、空氣盒子溫濕度、戶外 out_*）。"""
    df = pd.read_csv(path, encoding="utf-8-sig")
    df["time"] = pd.to_datetime(df["time_taipei"])
    df = df.set_index("time").sort_index()
    for col in COLUMNS:
        if col not in df:
            df[col] = float("nan")
    return df[COLUMNS]


# ---------------------------------------------------------------------------
# 晾衣區段：從原始圖人工判讀「掛上濕衣」與「結束」時間（台北時間）。
# before_raw：掛上前 1 分鐘的 hx711 中位數（可能是空夾子，也可能是乾的衣物，見 README）。
# 重疊的檔案（0101-0811 是 0101-1225 的一部分）只取較長的那份。
# garment：同一件衣物用同一個名稱，先驗只從同一件衣物的其他場次來。
# fan：使用者記錄有開電風扇的場次（實際時段由 wind 指標自動判斷）。
# ---------------------------------------------------------------------------
SESSIONS = [
    dict(id="S1_1114", garment="抹布", file="clothes_rag_drying_20261114.csv",
         start="2026-11-14 01:44", end="2026-11-14 15:20", before_raw=148814),
    dict(id="S2_1115", garment="運動長褲", file="clothes_raw_20261115-0101_20261115-1225.csv",
         start="2026-11-15 01:06", end="2026-11-15 12:19", before_raw=136205),
    # 18:50 使用者先拆下 ADS 電阻夾（抹布還掛著），之後的重量下降是拆夾子造成的；此時已差不多乾了
    dict(id="S3_1117a", garment="抹布", file="clothes_raw_20261117-0119_20261117-2030.csv",
         start="2026-11-17 01:34", end="2026-11-17 18:49", before_raw=None, note="18:50 拆電阻夾，已差不多乾"),
    dict(id="S4_1117b", garment="抹布", fan=True, file="clothes_raw_20261117-2025_20261118-0523.csv",
         start="2026-11-17 20:40", end="2026-11-18 05:23", before_raw=139935),
    dict(id="S5_1119", garment="短褲", file="clothes_raw_20261119-2303_20261120-0257.csv",
         start="2026-11-19 23:10", end="2026-11-20 02:57", before_raw=143072),
]

HX711_FAIL_BELOW = 50_000  # 偶發讀值掉到 0 附近，是讀取失敗不是重量


def load_session(sess: dict, period: str = "1min") -> pd.DataFrame:
    """取出一段晾衣資料，濾掉 HX711 失敗值，並依 period 取中位數。

    正式環境 ESP32 約每分鐘回報一筆（10 次中位數），所以預設 1min 來模擬。
    回傳欄位多兩個：
        t_h ：從掛上開始經過的小時數
        wind：同一個 period 內 hx711 的 IQR（四分位距），有風吹時會變大（平常 ~150，電風扇 > 1000）。
              注意：這裡每分鐘約 60 筆原始值，正式環境 ESP32 只取 10 次讀值的中位數，
              要用這個指標，韌體得多傳 10 次讀值的 IQR 或 max-min。
    """
    df = load(DATA_DIR / sess["file"])
    df = df.loc[sess["start"]:sess["end"]].copy()
    df.loc[df["hx711_raw"] < HX711_FAIL_BELOW, "hx711_raw"] = float("nan")
    r = df["hx711_raw"].resample(period)
    m = df.resample(period).median()
    m["wind"] = r.quantile(0.75) - r.quantile(0.25)
    m = m.dropna(subset=["hx711_raw"])
    m["t_h"] = (m.index - m.index[0]).total_seconds() / 3600
    return m
