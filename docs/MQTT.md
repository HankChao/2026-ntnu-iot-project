# MQTT 設定指南

這份文件說明本專案的 MQTT broker（Mosquitto）怎麼設定帳密、有哪些 topic、怎麼開 TLS，以及 ESP32 智慧衣夾和 MAPS 盒子要怎麼填才連得上。

## 1. 架構

```
ESP32 衣夾 ──MQTT 1883 / TLS 8883──┐
                                   ├─► mosquitto ◄──mqtt://mosquitto:1883── app (Bun) ── PostgreSQL
MAPS 盒子  ──MQTT 1883 / TLS 8883──┘   (Docker 內網)
```

- broker 只有**一組帳號**：`.env` 的 `MQTT_USERNAME` / `MQTT_PASSWORD`。app、ESP32、MAPS 盒子**全部用同一組**。
- 如果某台裝置填了別組帳密，broker 會拒絕連線，log 出現 `not authorised`，那台裝置的資料就完全收不到。
- `allow_anonymous false`，沒有 ACL：登入後可以讀寫所有 topic。

## 2. 帳密在哪裡設定

只需要改 `.env`，其他地方都是從它來的：

1. `.env` 的 `MQTT_USERNAME`、`MQTT_PASSWORD`
2. `docker-compose.yml` 把這兩個值當環境變數傳給 mosquitto 和 app 容器
3. mosquitto 啟動時，`mosquitto/start.sh` 用 `mosquitto_passwd -c` 在容器內產生 `/tmp/ntnu-mqtt-passwd`。每次啟動都會重建，裡面只有這一個帳號
4. app 用同一組帳密連 `mqtt://mosquitto:1883`，所以 app 一定連得上
5. 裝置端要手動填同一組帳密：ESP32 填在 `firmware/esp32-s3/main/app_config.h`，MAPS 盒子填在 `/home/pi/maps6/maps6.yaml`

改完 `.env` 必須 **recreate** 容器才會生效，單純 `restart` 拿不到新的環境變數：

```bash
docker compose up -d --force-recreate mosquitto app
```

## 3. 快速設定

Windows（PowerShell）：

```powershell
.\scripts\setup.ps1                 # 建立 .env、產生密碼，印出裝置要填的設定
docker compose up -d --build
.\scripts\setup.ps1 check           # 確認 broker 接受 .env 的帳密
```

macOS / Linux：

```bash
./scripts/setup.sh
docker compose up -d --build
./scripts/setup.sh check
```

腳本行為：

- **`.env` 不存在時**：從 `.env.example` 複製一份，再產生 `MQTT_PASSWORD`（可自行輸入，按 Enter 則隨機產生）、`SESSION_SECRET`、`POSTGRES_PASSWORD`。
- **`.env` 已存在時**：不覆寫任何既有值，只補上缺少的欄位。
- **`POSTGRES_PASSWORD` 只在第一次建立 `.env` 時產生。** PostgreSQL 只在 volume 第一次建立時讀取這個密碼，之後改 `.env` 不會改到資料庫。

| 指令 | 用途 |
|---|---|
| `setup.ps1` / `setup.sh` | 初始化或補齊 `.env` |
| `setup.ps1 -RotateMqtt` / `setup.sh --rotate-mqtt` | 換一組新的 MQTT 密碼 |
| `setup.ps1 -MqttPassword PW` / `setup.sh --mqtt-password PW` | 指定 MQTT 密碼 |
| `setup.ps1 show` / `setup.sh show` | 只印出 ESP32 與盒子的設定 |
| `setup.ps1 check [-Watch 15]` / `setup.sh check [--watch 15]` | 檢查登入、列出被拒絕的連線，並可即時觀察 topic |
| `setup.ps1 tls ...` / `setup.sh tls ...` | 啟用 / 停用 TLS，見第 6 節 |

密碼不可包含空白或 `$ " ' \` \ #` 這些字元，因為它們會破壞 `.env`、YAML 或 C 字串的解析。

## 4. 裝置端設定

`setup` 和 `show` 會印出可以直接貼上的內容。broker 位址要填**這台電腦的區網 IP**，不能填 localhost。

### ESP32（`firmware/esp32-s3/main/app_config.h`，改完重新燒錄）

```c
#define APP_MQTT_HOST       "192.168.1.100"
#define APP_MQTT_PORT       1883
#define APP_MQTT_TLS        0               // 韌體有此選項時才需要
#define APP_MQTT_USERNAME   "clothos"          // = .env MQTT_USERNAME
#define APP_MQTT_PASSWORD   "..."           // = .env MQTT_PASSWORD
#define APP_MQTT_TOPIC      "clothes/raw"   // = .env CLOTHES_MQTT_TOPIC
```

ESP32 要用 TLS（8883），需要同時符合兩個條件：

- **韌體要支援 `APP_MQTT_TLS`**：目前在 `feat/mqtt-tls` / `feat/wifi-setup-portal` branch，還沒合進 main。
- **broker 要用有網域、由公開 CA 簽發的憑證**（例如 Let's Encrypt）：韌體用 ESP-IDF 內建的公開 CA 清單驗證憑證，也會比對主機名稱。

TLS 設定方式（`APP_MQTT_HOST` 填憑證上的網域，不能填 IP）：

```c
#define APP_MQTT_HOST       "iot.example.org"
#define APP_MQTT_PORT       8883
#define APP_MQTT_TLS        1
```

ESP32 會先用 SNTP 校時再驗證憑證，所以 Wi-Fi 必須能連外。**自簽 CA 的憑證 ESP32 無法驗證**，用自簽時 ESP32 只能在區網連 1883。

`setup` / `show` 會依韌體是否支援 TLS、目前用哪種憑證，自動印出正確的 ESP32 設定。

### MAPS 盒子（`/home/pi/maps6/maps6.yaml`，改完 `sudo systemctl restart maps6d`）

```yaml
upload:
  mqtt:
    broker: "192.168.1.100"
    port: 1883                  # TLS 時為 8883
    username: "clothos"         # = .env MQTT_USERNAME
    password: "..."             # = .env MQTT_PASSWORD
    topic_prefix: "MAPS"        # server 只訂閱 MAPS/...，不要改
    use_tls: false
    ca_file: ""                 # 自簽 TLS 才需要，見第 6 節
    server_url: "http://192.168.1.100:8088"   # 補傳用，要用 WEB_PORT
```

`APP_PORT`（3000）只綁在 127.0.0.1，外面連不到，所以 `server_url` 必須用 `WEB_PORT`（nginx 會把 `/api/` 轉給 app）。

## 5. Topic 一覽

| Topic | 方向 | QoS | Retain | 內容 |
|---|---|---|---|---|
| `clothes/raw`（`CLOTHES_MQTT_TOPIC`） | ESP32 → server | 0 | 否 | 衣夾原始讀值，每秒一筆 |
| `MAPS/<id>/sensor` | 盒子 → server | 1 | 否 | 感測資料，預設每 60 秒一筆 |
| `MAPS/<id>/status` | 盒子 → server | 1 | 是 | 運行狀態，預設每 300 秒一筆 |
| `MAPS/<id>/online` | 盒子 → server | 1 | 是 | 連上時送 `true`；斷線時由 LWT（遺囑訊息）或正常關閉送 `false` |
| `MAPS/<id>/command` | server → 盒子 | 1 | 只有 `set_config` 會 retain | 遠端指令 |

`<id>` 是盒子的 device ID，也是盒子的 MQTT client ID。app 訂閱 `MAPS/+/sensor`、`MAPS/+/status`、`MAPS/+/online` 和 `clothes/raw`。

`clothes/raw` 的格式見 [README 的 MQTT 約定](../README.md#mqtt-約定)。MAPS 的 payload 範例：

```jsonc
// MAPS/<id>/sensor
{"device_id":"...","app":"MAPS6","version":"8.0.0","timestamp":"2026-11-12T01:00:00Z",
 "sensor":{"temp":25.1,"humi":60.2,"co2":450,"tvoc":12,"pm25_ae":8,"pm10_ae":12, "...": "...", "cpu_temp":48.3}}

// MAPS/<id>/online
{"online":true,"timestamp":"..."}
```

server 收到盒子的 `online` 或 `status` 後，才會把盒子登錄到 `devices` 表。在那之前收到的 `sensor` 會因為外鍵限制寫不進資料庫。

`MAPS/<id>/command` 的格式是 `{"action": "...", "timestamp": "...", "params": {...}}`：

| action | params | 說明 |
|---|---|---|
| `set_config` | `{"config":{"sensor_interval":60,"status_interval":300,"backfill_time":"02:00"}}` | 修改上傳間隔與補傳時間 |
| `set_module` | `{"name":"oled","enabled":false}` | 開關模組 |
| `trigger_backfill` | `{"dates":["2026-11-01"]}`（可省略） | 立即補傳 |
| `trigger_co2_cal` / `trigger_pms_reset` / `reboot` | – | 校正、重置感測器、重新開機 |

## 6. TLS 與 port forwarding（8883）

要讓外網的 ESP32 或 MAPS 盒子透過 router 的 port forwarding 連進來時，請開 TLS，router **只轉發 8883**。開啟後 broker 會多一個 8883 TLS listener，帳密和 1883 相同。

1883 要不要繼續對區網開放，腳本會自動判斷：

| 情況 | 預設 | ESP32 怎麼連 |
|---|---|---|
| 公開 CA 憑證，且韌體支援 `APP_MQTT_TLS` | 1883 只綁 127.0.0.1 | TLS 8883，填網域 |
| 自簽 CA，或韌體不支援 TLS | 1883 保持對區網開放 | 區網 1883 |

需要時可以用 `--keep-lan-plain` / `--no-lan-plain`（PowerShell：`-KeepLanPlain` / `-NoLanPlain`）手動指定。

憑證有兩種選擇：

| | 公開網域 + Let's Encrypt | 自簽 CA |
|---|---|---|
| 需要 | 網域或 DDNS 指向對外 IP | 不需要網域，可以直接用 IP |
| 盒子設定 | `use_tls: true`、`ca_file: ""` | `use_tls: true`、`ca_file`，並把 CA 複製到每台盒子 |
| ESP32 | 可以（`APP_MQTT_TLS 1`，填網域） | **不行**，只能用區網 1883 |
| 續期 | 約 90 天，需要定期更新 | server 憑證 825 天、CA 10 年 |

自簽 CA（`-TlsHost` / `--host` 填盒子連線時使用的對外 IP 或網域，可用逗號分隔多個）：

```powershell
.\scripts\setup.ps1 tls -SelfSigned -TlsHost 203.0.113.10
docker compose up -d --force-recreate mosquitto
```

```bash
./scripts/setup.sh tls --self-signed --host 203.0.113.10
docker compose up -d --force-recreate mosquitto
scp mosquitto/certs/ca.crt pi@<BOX_IP>:/home/pi/maps6/mqtt-ca.crt
```

已有憑證時（例如 Let's Encrypt，可以用 certbot 取得）：

```bash
./scripts/setup.sh tls --cert fullchain.pem --key privkey.pem --host maps.example.org
docker compose up -d --force-recreate mosquitto
```

停用 TLS：`setup.ps1 tls -Disable` / `setup.sh tls --disable`，接著 recreate mosquitto。

注意事項：

- `mosquitto/certs/` 和 `mosquitto/conf.d/*.conf` 都已加入 gitignore，不會被 commit。`ca.key` 請自行妥善保管。
- 盒子的系統時間必須正確，否則 TLS 驗證會失敗。
- 補傳（`server_url`）走的是 HTTP，不在 TLS 範圍內。如果 HTTP 也要開到外網，需要另外設定 HTTPS 反向代理。
- 無論哪種情況，router 都**不要**轉發 1883。

## 7. 換密碼

```bash
./scripts/setup.sh --rotate-mqtt
docker compose up -d --force-recreate mosquitto app
./scripts/setup.sh show        # 把新設定填到每台 ESP32（重新燒錄）和盒子
```

## 8. 疑難排解

| 症狀 | 原因 / 處理 |
|---|---|
| 只收得到 clothes，收不到 MAPS（或反過來） | 收不到的那邊帳密和 `.env` 不同。執行 `check`，看被拒絕連線的來源 IP，再把那台裝置改成 `.env` 的帳密 |
| `check` 顯示 `login ... FAILED` | broker 還在用舊的 `.env`，執行 `docker compose up -d --force-recreate mosquitto app` |
| 改了 `.env` 沒有生效 | 同上：`restart` 不會重新讀取 `.env` |
| 盒子連得上，但沒有資料 | 確認 `topic_prefix` 是 `MAPS`。用 `check --watch 30` 觀察是否有訊息 |
| 補傳失敗 | `server_url` 要用 `WEB_PORT`（預設 8088），不能用 3000 |
| ESP32 連不上（1883） | broker 要填區網 IP，不能填 localhost；要用 2.4 GHz Wi-Fi；防火牆要允許 TCP 1883；`MQTT_PLAIN_BIND` 必須是 `0.0.0.0` |
| ESP32 連不上（TLS 8883） | `APP_MQTT_HOST` 要填憑證上的網域，不能填 IP；憑證必須由公開 CA 簽發；Wi-Fi 要能連到 NTP 校時 |
| 啟動時 port 被占用 | 修改 `.env` 的 `MQTT_PORT` / `MQTT_TLS_PORT` / `WEB_PORT` |
| TLS 連線出現 `certificate signed by unknown authority` | 自簽 CA 時盒子沒設定 `ca_file` |
| TLS 連線出現 `certificate is valid for ..., not ...` | 盒子的 `broker` 不在憑證的 host 清單裡，請重新簽發 |
