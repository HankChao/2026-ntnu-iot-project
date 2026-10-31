# 2026 NTNU IoT：智慧衣夾

以 [soraimahiro/MAPS-server](https://github.com/soraimahiro/MAPS-server) 為基礎，加入單一智慧衣夾的原始資料收集與顯示。上游說明保留於 [docs/MAPS-UPSTREAM.md](docs/MAPS-UPSTREAM.md)。

目前只做：**ESP32 → MQTT → server 加收到時間 → PostgreSQL → 網頁數值與曲線**。
不需要先設定乾布基準、歸零或校正；目前不換算重量、電阻、電容，也不預測乾燥時間。

## 啟動網站

需要 Docker Desktop（啟動 Linux containers）。在 repository 根目錄執行：

```powershell
Copy-Item .env.example .env
# 視需要編輯 .env 的 MQTT_USERNAME、MQTT_PASSWORD 與連接埠
# .env 不會上傳 GitHub
docker compose up -d --build
```

- 智慧衣夾：http://localhost:8088
- 原有空氣盒子：http://localhost:8088/air
- MQTT：這台電腦的區域網路 IP，預設 port 1883
- 展示預設 MQTT 帳密：`maps` / `iisnrl`，ESP32 設定必須一致。
- 換展示場地：修改 ESP32 的 Wi-Fi 與 broker IP，重新燒錄。電腦與 ESP32 需能互通，使用 2.4 GHz Wi-Fi；防火牆需允許 TCP 1883。ESP32 的 broker 不能填 localhost。

這版沿用上游展示用認證機制，適合受信任的本機展示網路；尚未完成公開網際網路部署所需的認證與 TLS。

## ESP32 快速設定

程式位於 [firmware/esp32-s3](firmware/esp32-s3)，使用 **ESP-IDF 6.1**，不是 Arduino sketch。

將 `main/app_config.example.h` 複製成 `main/app_config.h`，集中填入 Wi-Fi 名稱、密碼、MQTT IP、port、帳密。實際設定檔已加入 gitignore。
完整接線、編譯與燒錄步驟見 [韌體操作說明](firmware/esp32-s3/README.md)。

## MQTT 約定

Topic：`clothes/raw`。每秒一筆，QoS 0、retain=false，斷線不補傳歷史資料。

```json
{"hx711_raw":86042,"ads1115_raw":7799,"touch_raw":31875}
```

| 欄位 | 內容 |
| --- | --- |
| hx711_raw | HX711 原始有號計數，不是 g |
| ads1115_raw | ADS1115 A0 原始有號 ADC 計數，不是 V 或 Ω |
| touch_raw | ESP32-S3 GPIO10 touch 原始計數，不是 pF |

讀取失敗的欄位傳 `null`，不能以 0 假裝讀取成功。ESP32 不傳時間，server 在收到訊息時加上 UTC timestamp。只接受這三個欄位、合法整數範圍或 null。

這版針對一個夾子，請勿讓多個真實裝置或模擬器同時發佈到同一個 topic。

## 網頁與資料庫

首頁顯示三個原始值、server 收到時間、最近 5/15/60 分鐘曲線。超過 10 秒沒新資料會提示；null 與資料中斷會讓曲線斷開。

資料存在獨立 `clothes_raw` 表；server 啟動時自動建立表與索引，也附上 `db/migrations/001_clothes_raw.sql`。原有空氣資料表與 MQTT topics 保留。

- `GET /api/v1/clothes/latest`：最新一筆、資料年齡、MQTT 狀態。
- `GET /api/v1/clothes/history?start=<ISO時間>&end=<ISO時間>&limit=5000`：時間範圍內資料，按時間遞增；最多查 24 小時、5000 筆，超出時回傳 truncated。
- DB 無法讀取時回傳 503，不以假資料或記憶體資料冒充成功。

PostgreSQL 使用 Docker volume，重新啟動會保留資料。不要執行 `docker compose down -v`，那會刪除本專案的資料 volume。

## 沒有板子時測試

以下會寫入**模擬資料**，只在展示用資料庫執行，開始正式實驗前停止模擬器並使用獨立資料庫。

```powershell
docker compose exec -T -e SIM_COUNT=60 app bun scripts/publish-clothes.ts
```

發送 60 筆後自動結束；首頁應出現三條曲線。這不是硬體實測。

```powershell
docker compose exec -T app bun test
python tools/smoke_clothes.py
```

smoke 測試會寫測試讀值、重啟本專案 app，驗證 MQTT、DB、API、重啟保存及斷線提示。請在沒有真實 ESP32 發送的展示環境執行。測試資料會保留。

## 專案結構

- `firmware/esp32-s3/`：感測器與 MQTT 韌體
- `app/src/clothes/`：驗證、存檔與接收處理
- `app/src/routes/clothes.ts`：查詢 API
- `web/src/views/ClothesView.vue`：raw data 儀表板
- `db/migrations/`：資料表
- `tools/smoke_clothes.py`：Docker 整合驗證

後續如需校正、材質或乾燥預測，可由 server 使用保存的 raw data 加上實驗標註實作。
