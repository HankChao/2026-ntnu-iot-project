# 智慧衣夾（2026 NTNU IoT）開發指南

ESP32 智慧衣夾 → MQTT → 後端加上收到時間 → PostgreSQL → 網頁。以 [MAPS-server](docs/MAPS-UPSTREAM.md) 為基礎，原本的 MAPS 空氣盒子功能也保留在同一個系統裡。

使用者偏好：**用繁體中文回覆**。

## 架構

| 目錄 | 內容 |
| --- | --- |
| `app/` | 後端：Bun + Hono + `Bun.sql`（PostgreSQL）+ mqtt.js。入口 `app/src/index.ts` |
| `app/src/clothes/` | 衣夾資料：`validation.ts`（MQTT 內容檢查）、`ingest.ts`、`store.ts`（建表、查詢、CSV、空氣盒子對應）、`drying.ts`（衣夾設定、衣物庫、晾衣）、`prediction.ts`（乾燥預測）、`demo.ts`（示範資料內容、`make seed`、重設） |
| `app/src/settings/` | 全站設定 `app_settings`（key → JSON，白名單在 `SETTING_DEFS`） |
| `app/src/routes/` | API，掛在 `/api/v1`。衣夾相關的在 `clothes.ts`、`drying.ts`，全站設定在 `settings.ts` |
| `app/src/mqtt/subscriber.ts` | 訂閱 `MAPS/+/sensor`、`MAPS/+/status`、`MAPS/+/online`、`clothes/raw` |
| `app/tests/` | `bun test`，不需要資料庫（沒資料庫時應該回 503） |
| `db/init.sql`、`db/migrations/` | MAPS 的資料表；衣夾的表（`clothes_raw`、`clips`、`garments`、`drying_sessions`、`app_settings`）由 `ensure*Schema()` 在啟動時自動建立 |
| `web/` | 前端：Vue 3 + Vite + Chart.js，用 nginx 提供，`/api` 和 `/ws` 轉到 app |
| `firmware/esp32-s3/` | ESP-IDF 6.1 韌體：只會定時發佈原始值（兩次之間深度睡眠），**沒有訂閱任何 topic，也沒有歸零或校正功能** |
| `mosquitto/` | MQTT broker 設定；`conf.d/`、`certs/` 給選用的 8883 TLS（`scripts/setup.sh tls`） |
| `scripts/setup.sh`、`setup.ps1` | 建立 `.env`、產生密碼、印出裝置設定、TLS、`check` 檢查被拒絕的裝置。說明在 `docs/MQTT.md` |
| `tools/` | 整合測試（`smoke_*.py`，設定只讀 `tools/config.json`）與 MQTT/設定頁驗證工具，見 `tools/README.md` |

### MQTT 約定（衣夾）
- topic `clothes/raw`，**約每分鐘一筆**（有人碰衣夾時每 10 秒），QoS 1，`retain=false`；兩次回報之間 ESP32 深度睡眠，`hx711_raw` 是 10 次讀值的中位數
- 超過 3 分鐘沒收到才算資料中斷：後端 `CLIP_STALE_MS`，`/latest` 會回 `stale` 與 `stale_after_ms`，前端照這個值顯示，不要自己寫死秒數
- 內容 `{"hx711_raw":int|null,"ads1115_raw":int|null,"touch_raw":int|null}`，只接受這三個欄位；讀取失敗傳 `null`
- ESP32 不傳時間，**時間由後端收到訊息時加上**（UTC）
- retained 訊息要拒絕，避免舊資料被當成新的

### 衣夾 API（`/api/v1/clothes`）
- 原始資料：`GET /latest`、`GET /history?start&end&limit`（最多 24 小時，長範圍取平均 `bucket_seconds`）、`GET /export?start&end`（CSV，最多 7 天）、`GET /airboxes`。都可以帶 `?clip=`（預設 `c1`）或 `?airbox=`。
- 配對的空氣盒子：`?airbox=` → `clips.airbox_id` → `CLOTHES_AIRBOX_ID` → 最近回報的盒子。`/airboxes` 的 `default_id` 就是這支衣夾實際用的盒子。
- **ID 與名稱**：衣夾、衣物、晾衣的 id 都是 PostgreSQL 產生的 UUID（`gen_random_uuid()`），程式不自己產生 id，人只填名稱。路徑上的 id 不是 UUID 回 404，body 裡的回 400。
  - 名稱在真資料之間不能重複、在示範資料之間也不能重複（真的和示範的可以同名），忽略大小寫和頭尾空白，存的時候會先 trim。重複回 409。
  - 空氣盒子的 id 維持 MAC（盒子用它發 MQTT），但名稱 `display_name` 也不能重複。
- 衣夾設定：`GET /clips`、`PATCH /clips/:id`（`name`、`airbox_id`、`predict_method`）、`DELETE /clips/:id`（只能刪示範衣夾）。`clips.topic` 標記哪支衣夾收哪個 MQTT topic：`topic = CLOTHES_MQTT_TOPIC` 的真衣夾就是實際的衣夾（啟動時沒有就建立「衣夾-01」），程式用 `rawClipId()` 找它，不要寫死 id。
- 衣物庫：`GET/POST /garments`（可帶 `is_demo`）、`PATCH /garments/:id`。
- 晾衣：`GET /sessions/active`、`POST /sessions`（`garment_id` 或新的 `garment` 擇一）、`PATCH /sessions/:id/garment`、`POST /sessions/:id/end`（`dry`／`early`／`cancel`，cancel 會刪掉）、`GET /sessions?start&end&limit`（已結束的紀錄和 `total`）。
- 預測（`prediction.ts`）：這件衣物過去 `dry` 紀錄的平均，沒有紀錄用材質預設值 `BASE_MINUTES`（要和 `web/src/constants/garments.ts` 一致）。
- **示範資料**：和真資料存在同一組表（`clips`、`garments`、`drying_sessions`），以 `is_demo = true` 標記。
  - 列表 API 預設**不回傳**示範資料，要帶 `?demo=include`；每一筆都有 `is_demo`。
  - 複合 FK `(clip_id, is_demo)`、`(garment_id, is_demo)` 保證一筆晾衣和它的衣夾、衣物同為真或同為示範；混用時 API 回 400。
  - 示範資料不會在啟動時寫入，要執行 `make seed`（已經有就略過）；`POST /demo/reset` 只重建示範資料。衣夾-01 不會有示範資料。示範資料（`demo.ts`）用名稱互相參照，id 由資料庫產生。
- 錯誤：呼叫端的錯誤用 `HttpError` 回 400／404／409，資料庫問題回 503。

### 全站設定（`/api/v1/settings`）
`GET`、`PATCH`。目前只有 `demo_data`（預設 `true`），未知 key 回 400。寫 JSONB 時參數要用 `${JSON.stringify(v)}::text::jsonb`：直接 `::jsonb` 的話 Bun 會再編碼一次，存成 JSON 字串。

## 指令

用 `Makefile`（`make help` 列出全部）。Windows 沒有 make，對應的 docker compose 指令在 README 的「Makefile 指令一覽」。

```bash
make setup       # 第一次：建立 .env、產生 MQTT 密碼，印出 ESP32 與 MAPS 盒子要填的設定
make up          # 正式模式，全部在 Docker：http://localhost:8088（會 --build）
make dev         # 開發模式：後端在 Docker 熱重載 + 本機 Vite：http://localhost:5173
make down        # 停止容器（只停不刪）
make logs        # 追蹤 app 日誌；make logs s=postgres
make test        # 後端 bun test + 前端 build
make typecheck   # 前端型別檢查（vue-tsc 2.2 + TypeScript 5.8）
make sim         # 沒板子時送模擬衣夾資料（SIM_COUNT=10 可改筆數）
make seed        # 寫入示範資料（衣夾-02～08、衣物、晾衣紀錄）；已經有就略過
make check       # MQTT 帳密是否正確、哪些裝置被拒絕
make smoke       # 整合測試，需要 tools/config.json，會寫入測試資料
```

改完前端要看正式模式的畫面，記得 `make up`（或 `docker compose up -d --build web`）；只 `docker compose up -d` 會沿用舊 image。

## 規則

- **不得用假資料冒充真資料**。資料庫讀不到就回 503，不能改用記憶體資料或預設值假裝成功。示範資料一律以 `is_demo` 標記、API 預設排除，畫面上要加「示範」標籤（`components/clothes/DemoTag.vue`），統計只算真資料；用到示範資料的頁面，底部一定要註明。
- **時間一律由後端加**，顯示時用台北時間。
- 資料表用 `CREATE TABLE IF NOT EXISTS` 寫在啟動時會跑的 `ensure*Schema()` 裡，新舊資料庫都能用；同時在 `db/migrations/` 放一份 SQL。
- **不要執行 `docker compose down -v`**，會刪掉資料庫 volume。
- `.env` 不進 git。**`MQTT_USERNAME`／`MQTT_PASSWORD` 一定要在 `.env` 設定**（範本帳號 `clothes`），程式裡沒有預設帳密，少了 compose 和 app 都會拒絕啟動。broker 只有這一組帳號，ESP32 和 MAPS 盒子要用同一組；帳密、topic、TLS 見 `docs/MQTT.md`。`CLOTHES_AIRBOX_ID` 可指定衣夾預設配對的空氣盒子，`CLOTHES_MQTT_TOPIC` 可改衣夾 topic（預設 `clothes/raw`）。

## 前端架構（`web/src`）

- **主題**：`styles/main.css` 定義深色（預設）和亮色兩組 token（`--bg --sf --tx --ac --wa …`），舊的 `--color-*` 也對應到同一組 token，所以空氣盒子頁面也會跟著換色。SVG 和 Chart.js 需要實際色碼時用 `composables/useTheme.ts` 的 `palette`；兩邊的色碼要保持一致。
- **真實資料**：`composables/useClothesData.ts`。module 層級的共用狀態，`useClothesLive()`／`useClothesHistory()` 只在有頁面使用時才輪詢。衣夾-01 配對的空氣盒子從 `/clips` 讀，改的時候 `PATCH /clips/c1`，伺服器存好才更新畫面（`setClipAirbox`）。各衣夾的預測方式走 `useClothesMock` 的 `setMethod`。
- **全站設定**：`composables/useSettings.ts`。localStorage `clothes-settings-cache` 只用來讓第一次畫面一致，伺服器回應後以伺服器為準。
- **衣夾 id**：實際衣夾的 UUID 從 `/clips` 取得（`!is_demo` 而且有 `topic`），不要寫死。示範衣夾的外觀（`DEMO_LOOK`）用名稱對應。新增、編輯衣物時，同類已有同名會先在表單提示（`garmentNameTaken`）。
- **衣夾、衣物、晾衣、紀錄**：`composables/useDrying.ts` 從 API 載入（示範開啟時帶 `?demo=include`），頁面開著時每 30 秒更新，每一筆都有 `demo`。寫入都送到伺服器，成功後重新載入；失敗時畫面不變並顯示錯誤（`actionError`）。localStorage 的 `clothes-demo-v1`、`clothes-local-v1` 已不再使用。
- **`composables/useClothesMock.ts`**：頁面讀資料的入口（`state.garments/sessions/records` 等），底下是 `useDrying.ts`。只有「不是紀錄」的示範內容留在前端：示範衣夾的外觀（晶片、IP、訊號、故障）、示範天氣、示範剩餘水分曲線、各感測法的示範誤差。
- **真假依衣夾分**：衣夾-01 只能晾真的衣物，示範衣夾只能晾示範衣物（開始晾衣、更換衣物都照這個過濾）。衣夾-01 的預計乾燥時間用伺服器的 `predicted_min`，剩餘水分還沒有，顯示 `NONE`；示範天氣的下雨提醒只套用在示範的晾衣。
- **示範資料開關**：設定頁的「示範資料」（存在伺服器的 `demo_data`，所有瀏覽器一樣；伺服器存好才切換，失敗會顯示錯誤）。開啟時真的和示範的混在一起顯示並加標籤；關閉時只有真的。晾衣紀錄頁的統計只算真的。
- **總覽版面規則**（`views/OverviewView.vue`）：
  - 桌機（寬 ≥ 901px、高 ≥ 600px）「往下查看更多」以上固定在一個畫面內；字級、間距用 `clamp(rem, vh, rem)` 隨高度縮放，太高的面板在右欄內捲動。
  - **切換衣物時版面不能跳**：每一格固定單行、固定行高；沒資料時用同樣大小顯示 `NONE`／`無數據`，不要換成不同字級的說明文字，空的提示行也要保留位置。新增欄位時照這個做。
  - 衣物名稱等長文字用 `…` 截斷（`title` 顯示全名），不要讓按鈕被擠到下一排。
  - 空氣盒子超過 1 小時沒更新顯示「無數據」；衣服輪播到頭就停，不會繞回另一邊。
- **字級一律用 rem**，不要寫死 px（Chart.js 的 canvas 字和 SVG 的 `font-size` 屬性例外）。
- 頁面：`/` 總覽、`/start` 開始晾衣、`/devices` 設備狀況（含空氣盒子清單）、`/clips/:id` 衣夾詳細、`/sessions` 晾衣紀錄、`/devices/:id` 空氣盒子詳細、`/history` 空氣歷史、`/settings`。`/air` 和 `/login` 會轉址。
- 前端沒有登入功能。後端的 `/api/v1/auth` 還在，但前端沒用到。

## 容易踩的坑

- `web/package.json` 鎖的 `vue-tsc` 1.8 跟現在的 TypeScript 不相容，跑了會直接報錯；`bun run build` 沒用到它。型別檢查用 `make typecheck`（另外裝 `vue-tsc@2.2` + `typescript@5.8`）。
- 本機 5432 可能被其他專案佔用，可以臨時改 port：`POSTGRES_PORT=5433 docker compose up -d`（不用改 `.env`）。
- `tools/*.py` 會產生 `tools/__pycache__/`（已在 `.gitignore`），不要 commit。
- `smoke_*.py` 會寫入測試資料而且不會刪除；`smoke_maps.py` 建立的 `SMOKE-TEST-01` 會出現在空氣盒子選單裡。只在測試用的資料庫跑。
- `tools/smoke_clothes.py` 還沒跟上兩個改動：資料中斷門檻已改成 3 分鐘（腳本還等 15 秒），`history?limit=` 改成時間分段平均（腳本還檢查 `truncated`）。要用之前先改這兩項。
- 衣夾-01 沒在送資料時顯示離線，「開始晾衣」不能選它。沒有板子時先 `make sim`。
- 舊資料庫的衣夾、衣物、晾衣如果還是文字 id（`c1`、`g_xxx`），app 啟動時會自動轉成 UUID（`convertTextIds()`，只跑一次，關聯和衣夾-01 的設定都保留）。
- Bun SQL 傳字串參數給 uuid 欄位時，查詢裡要寫 `${id}::uuid`。
- 示範開關開著卻沒有任何示範資料：還沒執行過 `make seed`（或到晾衣紀錄頁按「建立示範資料」）。
