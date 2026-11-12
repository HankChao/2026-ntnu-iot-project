# tools

這些都是**整合測試（smoke test）**，用來確認 MQTT → server → PostgreSQL → HTTP API 整條路徑正常。測試會寫入模擬資料，而且**不會刪除**，請只在測試或展示用的資料庫執行，也不要在真實裝置正在發送時執行。

| 腳本 | 測試內容 |
|---|---|
| `smoke_clothes.py` | `clothes/raw`：正常值、格式錯誤會被拒絕、null 值、history 與 limit、app 重啟後資料仍在（`local_stack` 時）、超過 10 秒沒資料會顯示 stale |
| `smoke_maps.py` | 模擬一台 MAPS 盒子依序送 `MAPS/<id>/online`、`status`、`sensor`，並檢查 `/api/v1/devices/<id>` 與 `/sensor/latest`、格式錯誤的 payload、`online=false` 時是否轉為離線 |
| `smoke_common.py` | 共用設定讀取，以及只用 Python 標準庫寫的 MQTT 發送（支援 TLS） |

只需要 Python 3.8 以上，不用另外安裝套件。

## 執行

```bash
cp tools/config.example.json tools/config.json   # 填入網址與帳密（Windows: Copy-Item）
docker compose up -d --build
python tools/smoke_clothes.py
python tools/smoke_maps.py
```

## 網址與帳密設定

所有設定都**只讀 `tools/config.json`**（已加入 gitignore），不會讀 `.env`。檔案不存在，或缺少必填欄位時，測試會直接停止並列出缺少的欄位。除了 `mqtt.ca_file`，其他欄位都是必填。

測本機時，`port`、`username`、`password` 要和 `.env` 的 `MQTT_PORT`、`MQTT_USERNAME`、`MQTT_PASSWORD` 一致，`base_url` 的 port 要和 `WEB_PORT` 一致。測遠端或 TLS 的範例：

```json
{
  "base_url": "https://iot.example.org",
  "local_stack": false,
  "mqtt": { "host": "iot.example.org", "port": 8883, "tls": true, "ca_file": "",
            "username": "clothes", "password": "..." },
  "topics": { "clothes": "clothes/raw", "maps_prefix": "MAPS" },
  "maps_test_device": "SMOKE-TEST-01"
}
```

| 欄位 | 說明 |
|---|---|
| `base_url` | 網站網址，API 走 `<base_url>/api/v1/...` |
| `local_stack` | `true` 才會在 repo 根目錄執行 `docker compose restart app`（docker compose 本身要用專案的 `.env`）；測遠端請設 `false` |
| `mqtt.host` / `port` | broker 位址；TLS 時 host 要填憑證上的名稱 |
| `mqtt.tls` / `ca_file` | 啟用 TLS；自簽憑證時 `ca_file` 填 `mosquitto/certs/ca.crt`，公開 CA 則留空 |
| `mqtt.username` / `password` | MQTT 帳密 |
| `topics.clothes` / `maps_prefix` | topic 設定（預設 `clothes/raw`、`MAPS`） |
| `maps_test_device` | 模擬盒子的 device ID，請不要和真實盒子重複 |
