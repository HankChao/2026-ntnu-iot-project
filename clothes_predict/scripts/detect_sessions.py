"""自動偵測「什麼時候掛上濕衣服」「什麼時候收下」，和人工標的 SESSIONS 比對。

    uv run python scripts/detect_sessions.py

只用正式環境也拿得到的資料：每分鐘一筆的 hx711、touch（中位數）。
規則（都在 1 分鐘中位數上）：
    比較「前 5 分鐘中位數」和「跳過 SETTLE 分鐘後的 5 分鐘中位數」（剛掛上會晃好幾分鐘）
    掛上：高出 HANG_JUMP 以上，而且後面那 5 分鐘的 IQR 很小（穩定了，不是手還抓著）
    收下：低了 HANG_JUMP 以上，同樣要穩定
    同一個 EVENT_GAP 分鐘內的多個候選只留跳幅最大的
    碰觸：touch 比前 5 分鐘中位數高出 TOUCH_JUMP 以上（掛衣、收衣時手會碰到）
    跳階之後用 30 分鐘斜率分類（跳階方向不重要：換衣服時淨重可能變輕，例如 S3 長褲換成濕抹布）：
        斜率 < WET_SLOPE → 開始晾（濕衣服）；起點回溯到跳階那一分鐘
        否則跳階向下 → 收下；向上 → 掛上乾衣服／不確定
    斜率要等約 40 分鐘才確定，所以正式環境是「先暫定、40 分鐘後確認」
"""
import numpy as np
import pandas as pd

from clothes_predict.data import DATA_DIR, HX711_FAIL_BELOW, SESSIONS, list_files, load

HANG_JUMP = 10_000      # counts；抹布濕重約 +25k，手碰約 ±5k
HOLD_MIN = 5
SETTLE = 3
STABLE_IQR = 5_000
EVENT_GAP = 10
TOUCH_JUMP = 8_000
WET_SLOPE = -1_000      # counts/h，掛上後 30 分鐘斜率比這個更負 → 濕衣服

files = [p for p in list_files() if "0101_20261115-0811" not in p.name]  # 重疊的檔案跳過
for path in files:
    df = load(path)
    df.loc[df["hx711_raw"] < HX711_FAIL_BELOW, "hx711_raw"] = np.nan
    m = df.resample("1min").median().dropna(subset=["hx711_raw"])
    w, touch = m["hx711_raw"].to_numpy(), m["touch_raw"].to_numpy()
    print(f"== {path.name}")
    cands = []
    for k in range(2, len(w) - SETTLE - HOLD_MIN):  # 檔案開頭不足 5 分鐘也比
        before = np.median(w[max(0, k - HOLD_MIN):k])
        after = w[k + SETTLE:k + SETTLE + HOLD_MIN]
        jump = np.median(after) - before
        q75, q25 = np.percentile(after, [75, 25])
        if abs(jump) > HANG_JUMP and q75 - q25 < STABLE_IQR:
            cands.append((k, jump))
    events = []
    for k, jump in cands:   # 同一群只留最大的
        if events and k - events[-1][0] <= EVENT_GAP:
            if abs(jump) > abs(events[-1][1]):
                events[-1] = (k, jump)
        else:
            events.append((k, jump))
    out = []
    for k, jump in events:
        touched = np.nanmax(touch[max(0, k - 3):k + SETTLE + 1]) - np.median(touch[max(0, k - HOLD_MIN):k]) > TOUCH_JUMP
        seg = w[k + 10:k + 40]
        slope = np.polyfit(np.arange(len(seg)) / 60, seg, 1)[0] if len(seg) > 10 else np.nan
        if slope < WET_SLOPE:
            kind = "開始晾"
        else:
            kind = "收下" if jump < 0 else "掛上乾衣/不確定"
        extra = f" 30分斜率 {slope:+.0f}/h"
        out.append((m.index[k], kind, jump))
        print(f"   {m.index[k]:%m-%d %H:%M} {kind:8} {jump:+8.0f}  碰觸={'是' if touched else '否'}{extra}")
    events = out
    manual = [s for s in SESSIONS if s["file"] == path.name]
    for s in manual:
        hangs = [e for e in events if e[1] == "開始晾"]
        if hangs:
            dt = min((abs((e[0] - pd.Timestamp(s["start"])).total_seconds()) / 60, e[0]) for e in hangs)
            print(f"   人工 {s['id']} start {s['start'][5:]} → 最近的偵測差 {dt[0]:.0f} 分鐘")
