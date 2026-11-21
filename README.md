# 2026 NTNU IoT：智慧衣夾

以 [soraimahiro/MAPS-server](https://github.com/soraimahiro/MAPS-server) 為基礎，加入單一智慧衣夾的原始資料收集與顯示。原本的 MAPS 空氣盒子功能保留在同一個系統裡，上游說明見 [docs/MAPS-UPSTREAM.md](docs/MAPS-UPSTREAM.md)。

目前只做：**ESP32 → MQTT → server 加收到時間 → PostgreSQL → 網頁數值與曲線**。
不需要先設定乾布基準、歸零或校正；目前不換算重量、電阻、電容，也不預測乾燥時間。

## 目錄

- [需要的軟體](#需要的軟體)
- [快速開始](#快速開始)
- [開發模式（即時更新）](#開發模式即時更新)
- [Makefile 指令一覽](#makefile-指令一覽)
- [測試](#測試)
- [ESP32 與 MQTT](#esp32-與-mqtt)
- [網頁、API 與資料庫](#網頁api-與資料庫)
- [專案結構](#專案結構)

## 需要的軟體

| 軟體 | 用途 |
| --- | --- |
| Docker Desktop（Linux containers） | 跑 mosquitto、PostgreSQL、後端、正式版前端 |
| [Bun](https://bun.sh) | 開發模式的前端（Vite）、`make test` 的前端 build |
| make | macOS / Linux 內建。Windows 沒有 make，改用下表的 docker compose 指令 |
| Python 3.8 以上 | 只有 smoke 整合測試需要，不用另外裝套件 |

## 快速開始

在 repository 根目錄執行：

```bash
make setup   # 第一次：建立 .env、產生 MQTT 密碼，並印出 ESP32 與 MAPS 盒子要填的設定
make up      # 啟動全部服務（正式模式）
make check   # 確認 MQTT 帳密正確、列出被拒絕的裝置
```

Windows（PowerShell）：

```powershell
.\scripts\setup.ps1
docker compose up -d --build
.\scripts\setup.ps1 check
```

啟動後：

- 智慧衣夾：http://localhost:8088
- 原有空氣盒子：http://localhost:8088/air
- MQTT：這台電腦的區域網路 IP，預設 port 1883

`.env` 不會上傳 GitHub。MQTT 帳號、密碼都必須在 `.env` 設定（範本帳號為 `clothes`），沒設定時服務不會啟動。**ESP32 與 MAPS 盒子都必須使用同一組帳密**，否則 broker 會拒絕連線。忘記要填什麼時，執行 `make show` 再印一次。

停止服務用 `make down`（只停容器，資料保留）。**不要執行 `docker compose down -v`**，那會刪除資料庫 volume。

## 開發模式（即時更新）

正式模式的前端是 build 好的靜態檔，由 nginx 提供；後端程式也是 build 進 image。改程式後要重新 build 才看得到。開發時改用：

```bash
make dev     # 網址 http://localhost:5173
```

`make dev` 會做這些事：

1. 停掉正式版的 `web` 容器（如果有在跑）。
2. 用 `docker-compose.yml` 疊加 [docker-compose.dev.yml](docker-compose.dev.yml) 啟動 mosquitto、PostgreSQL、app：
   - app 掛載 `app/src`、`app/scripts`、`app/tests`，並以 `bun --watch` 執行，**改後端檔案會自動重啟**。
   - 不啟動 nginx 的 `web` 容器。
3. 在本機跑 Vite（`web/`），**改前端檔案畫面會即時更新**。`/api`、`/ws` 由 Vite 轉到 `localhost:3000` 的 app。

注意：

- Ctrl-C 只會停掉 Vite，後端仍在 Docker 跑，要停請用 `make down`。
- 只想開後端、自己另外開前端時，用 `make dev-backend`，再到 `web/` 執行 `bun run dev`。
- 改了 `app/package.json` 的依賴時，`make dev` 每次都會重新 build image，會自動裝好。
- 5173 被佔用時，Vite 會自動改用下一個 port，以終端機印出的網址為準。
- 開發模式和正式模式共用同一個資料庫 volume，切換不會遺失資料。要回到正式模式，執行 `make up`。

Windows：

```powershell
docker compose stop web
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
cd web; bun install; bun run dev
```

## Makefile 指令一覽

執行 `make` 不加參數會列出所有指令。Windows 請直接執行右欄的指令。

| 指令 | 用途 | 對應指令（Windows） |
| --- | --- | --- |
| `make setup` | 第一次使用：建立 `.env`、產生 MQTT 密碼 | `.\scripts\setup.ps1` |
| `make show` | 印出 ESP32 與 MAPS 盒子要填的 MQTT 設定 | `.\scripts\setup.ps1 show` |
| `make check` | 確認 MQTT 帳密正確、列出被拒絕的裝置 | `.\scripts\setup.ps1 check` |
| `make up` | 正式模式：全部在 Docker，http://localhost:8088 | `docker compose up -d --build` |
| `make dev` | 開發模式：後端熱重載 + 本機 Vite，http://localhost:5173 | 見[開發模式](#開發模式即時更新) |
| `make dev-backend` | 只啟動開發模式的後端，不跑 Vite | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build` |
| `make down` | 停止所有容器（只停不刪，資料保留） | `docker compose stop` |
| `make restart` | 重啟 app | `docker compose restart app` |
| `make ps` | 容器狀態 | `docker compose ps` |
| `make logs` | 追蹤 app 日誌；`make logs s=postgres` 可換服務 | `docker compose logs -f app` |
| `make test` | 後端測試 + 前端 build | 下面兩列 |
| `make test-app` | 後端單元測試（不需要先啟動服務） | `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps -T app bun test` |
| `make test-web` | 確認前端能 build | `cd web; bun install; bun run build` |
| `make typecheck` | 前端型別檢查（vue-tsc 2.2 + TypeScript 5.8） | — |
| `make sim` | 送 60 筆模擬衣夾資料；`make sim SIM_COUNT=10` 可改筆數 | `docker compose exec -T -e SIM_COUNT=60 app bun scripts/publish-clothes.ts` |
| `make seed` | 寫入示範資料（衣夾-02～08、衣物、晾衣紀錄）；已經寫過就略過 | `docker compose exec -T app bun scripts/seed-demo.ts` |
| `make smoke` | 整合測試 MQTT → DB → API | `python tools/smoke_clothes.py`、`python tools/smoke_maps.py` |

`make typecheck` 第一次執行時會把工具裝到 `~/.cache/iot-server-typecheck`。不用 `web/package.json` 裡的 vue-tsc 1.8，因為它和現在的 TypeScript 不相容。

## 測試

### 單元測試

```bash
make test        # 後端 bun test + 前端 build
make typecheck   # 前端型別檢查
```

後端測試不需要資料庫，也不需要先啟動服務。

### 沒有板子時送模擬資料

以下會寫入**模擬資料**，只在展示用資料庫執行；開始正式實驗前停止模擬器並使用獨立資料庫。

```bash
make sim   # 需先 make up 或 make dev
```

發送 60 筆後自動結束，首頁應出現三條曲線。這不是硬體實測。

### 示範資料（衣夾-02～08、衣物、晾衣紀錄）

```bash
make seed  # 需先 make up 或 make dev；已經寫過就略過
```

示範資料和真資料存在同一組資料表，以 `is_demo = true` 標記：API 預設不回傳，設定頁開啟「示範資料」後才會一起顯示，並加上「示範」標籤。衣夾-01 是實際的衣夾，不會有示範資料。要重來請到晾衣紀錄頁按「重設示範資料」，只會重建示範資料，真資料不受影響。

### 整合測試（smoke test）

```bash
cp tools/config.example.json tools/config.json   # 第一次：填入網址與帳密（不會讀 .env）
make smoke                                        # 需先啟動服務
```

smoke 測試會寫入測試讀值，驗證 MQTT、DB、API；clothes 測試另外會重啟本專案 app，檢查重啟後資料仍保存，以及斷線提示。請在沒有真實裝置發送的展示環境執行，測試資料會保留。詳見 [tools/README.md](tools/README.md)。

## ESP32 與 MQTT

### ESP32 設定

程式位於 [firmware/esp32-s3](firmware/esp32-s3)，使用 **ESP-IDF 6.1**，不是 Arduino sketch。完整接線、編譯與燒錄步驟見[韌體操作說明](firmware/esp32-s3/README.md)。

- 首次燒錄後可用手機熱點配網；Wi-Fi 與 MQTT 設定會保存到板子的 NVS，斷電仍保留。
- 也可將 `main/app_config.example.h` 複製成 `main/app_config.h` 填入初始設定；已保存的 NVS 設定優先，`app_config.h` 已加入 gitignore。
- 換展示場地：開機後長按 ESP32 GPIO0 約 3 秒，手機連上設定熱點、開啟 `192.168.4.1` 即可換 Wi-Fi 與 MQTT，不需重新燒錄。
- 使用本機 broker 時，電腦與 ESP32 需能互通，防火牆需允許 TCP 1883；ESP32 的 broker 不能填 localhost。

### MQTT 約定（衣夾）

Topic：`clothes/raw`。約每分鐘一筆（有人碰衣夾時每 10 秒），QoS 1、retain=false，斷線不補傳歷史資料。每筆的 hx711_raw 是 10 次讀值的中位數，兩次回報之間 ESP32 深度睡眠。

```json
{"hx711_raw":86042,"ads1115_raw":7799,"touch_raw":31875}
```

| 欄位 | 內容 |
| --- | --- |
| hx711_raw | HX711 原始有號計數，不是 g |
| ads1115_raw | ADS1115 A0 原始有號 ADC 計數，不是 V 或 Ω |
| touch_raw | ESP32-S3 GPIO10 touch 原始計數，不是 pF |

- 讀取失敗的欄位傳 `null`，不能以 0 假裝讀取成功。
- ESP32 不傳時間，server 在收到訊息時加上 UTC timestamp。
- 只接受這三個欄位、合法整數範圍或 null。
- 這版針對一個夾子，請勿讓多個真實裝置或模擬器同時發佈到同一個 topic。

帳密流程、所有 topic（含 MAPS 空氣盒子）見 [docs/MQTT.md](docs/MQTT.md)。

### TLS 與外網連線

這版沿用上游展示用認證機制，適合受信任的本機展示網路。若需要讓外網裝置透過 port forwarding 連線，可以啟用 8883 TLS（見 [docs/MQTT.md](docs/MQTT.md#6-tls-與-port-forwarding8883)）。

- ESP32 只能驗證公開 CA（例如 Let's Encrypt）簽發的網域憑證；用自簽憑證時，ESP32 只能留在區網連 1883。
- 遠端 broker 可在韌體啟用 `APP_MQTT_TLS 1`、設定 port 8883，韌體會校時並驗證伺服器憑證。設定方式見韌體操作說明的「遠端 MQTT TLS」。
- 改送遠端後，請使用對應的遠端網站觀察資料；本機儀表板不會自動同步遠端資料。

## 網頁、API 與資料庫

### 網頁

首頁顯示三個原始值、server 收到時間與歷史曲線：可選最近 5 分鐘、15 分鐘、1 小時、6 小時、24 小時，或自訂開始／結束時間（台北時間，一次最多 24 小時；自訂範圍不自動更新）。超過 3 分鐘沒新資料會提示；null 與資料中斷會讓曲線斷開。

「匯出 CSV」區可手動填起訖時間，或在曲線上按住拖曳選取時段後直接下載。儀表板也能從下拉選單選擇目前連線中的空氣盒子（記在該瀏覽器）。

### 衣夾 API

| API | 說明 |
| --- | --- |
| `GET /api/v1/clothes/latest` | 最新一筆、資料年齡、MQTT 狀態 |
| `GET /api/v1/clothes/history?start=<ISO時間>&end=<ISO時間>&limit=5000` | 時間範圍內資料，按時間遞增；最多查 24 小時。資料超過 limit 筆時，改回傳每 `bucket_seconds` 秒的平均值，讓整段範圍都看得到（全為 null 的區間仍為 null） |
| `GET /api/v1/clothes/export?start=<ISO時間>&end=<ISO時間>` | 下載原始資料 CSV（不平均，UTF-8 含 BOM，Excel 可直接開）；start、end 皆必填，最長 7 天 |
| `GET /api/v1/clothes/airboxes` | 列出所有空氣盒子與是否連線（5 分鐘內有回報） |

- CSV 欄位：`time_taipei,timestamp_utc,hx711_raw,ads1115_raw,touch_raw,air_temp_c,air_humi_pct`，讀取失敗的值為空白。
- 空氣盒子溫溼度：`latest`、`history` 會附上 `air`；CSV 的 `air_temp_c`、`air_humi_pct` 取「該筆衣夾資料當下或之前、5 分鐘內最近一筆」空氣盒子讀值，超過 5 分鐘沒有讀值則留空。
- 預設配對最近有回報的空氣盒子；可用 `.env` 的 `CLOTHES_AIRBOX_ID` 指定，或在 API 加 `?airbox=<device_id>`。
- DB 無法讀取時回傳 503，不以假資料或記憶體資料冒充成功。

### 資料庫

- 衣夾資料存在獨立的 `clothes_raw` 表；server 啟動時自動建立表與索引，也附上 `db/migrations/001_clothes_raw.sql`。原有空氣資料表與 MQTT topics 保留。
- PostgreSQL 使用 Docker volume，重新啟動、切換開發／正式模式都會保留資料。
- 本機 5432 被其他程式佔用時，可臨時改 port：`POSTGRES_PORT=5433 make up`。

## 專案結構

| 路徑 | 內容 |
| --- | --- |
| `app/` | 後端：Bun + Hono + PostgreSQL + mqtt.js，入口 `app/src/index.ts` |
| `app/src/clothes/` | 衣夾資料的驗證、存檔與接收處理 |
| `app/src/routes/clothes.ts` | 衣夾查詢 API |
| `app/tests/` | 後端單元測試（`make test-app`） |
| `web/` | 前端：Vue 3 + Vite + Chart.js |
| `web/src/views/ClothesView.vue` | 衣夾 raw data 儀表板 |
| `db/` | 資料表定義與 migrations |
| `mosquitto/` | MQTT broker 設定 |
| `firmware/esp32-s3/` | 感測器與 MQTT 韌體 |
| `scripts/` | `setup.sh`／`setup.ps1`：建立 `.env`、MQTT 帳密、TLS |
| `tools/` | 整合測試與 MQTT／設定頁驗證工具，見 [tools/README.md](tools/README.md) |
| `docs/` | [MQTT 設定](docs/MQTT.md)、[上游說明](docs/MAPS-UPSTREAM.md) |
| `docker-compose.yml` | 正式模式 |
| `docker-compose.dev.yml` | 開發模式疊加檔 |
| `Makefile` | 常用指令 |

後續如需校正、材質或乾燥預測，可由 server 使用保存的 raw data 加上實驗標註實作。
