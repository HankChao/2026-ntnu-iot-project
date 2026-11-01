# ESP32-S3 原始資料韌體

硬體：ESP32-S3-N16R8；框架：ESP-IDF 6.1。

## 接線

| 模組 | 模組腳位 | ESP32-S3 |
| --- | --- | --- |
| HX711 | VCC / GND | 3V3 / GND |
| HX711 | DT / SCK | GPIO4 / GPIO5 |
| ADS1115 | VDD / GND | 3V3 / GND |
| ADS1115 | SDA / SCL | GPIO8 / GPIO9 |
| ADS1115 | ADDR | GND（0x48） |
| ADS1115 | A0 | 分壓交會點 |
| touch 電極 | 感測線 | GPIO10 |

ADS1115 分壓：`3V3 → 10kΩ → A0 → 布料兩電極 → GND`。所有模組共地。A1/A2/A3/ALRT 不接。Touch 電極沿用隔著絕緣膠帶接觸布料的方式。

ADS1115 使用 ±4.096 V PGA、128 SPS、單端 A0；送出的仍是 ADC 計數。GPIO10 touch 使用 ESP32-S3 硬體讀值；不換算成 pF。HX711 不套用校正係數或歸零。

## 設定與編譯

1. 複製 `main/app_config.example.h` 為 `main/app_config.h`。
2. 編輯其中 APP_WIFI_SSID、APP_WIFI_PASSWORD、APP_MQTT_HOST、APP_MQTT_PORT、APP_MQTT_USERNAME、APP_MQTT_PASSWORD。
3. MQTT host 填執行 Docker 電腦的區域網路 IP，帳密與根目錄 .env 一致。

### 遠端 MQTT TLS

使用遠端 broker 時，host 填網域名稱（不含 `https://`），並依服務設定 port 與帳密。例如目前展示服務：

```c
#define APP_MQTT_HOST "iot.hamichi.tw"
#define APP_MQTT_PORT 8883
#define APP_MQTT_TLS  1
#define APP_MQTT_TOPIC "clothes/raw"
```

帳密只填在本機 `app_config.h`。TLS 會使用 ESP-IDF CA bundle 驗證憑證與主機名稱，連線前透過 SNTP 校時；Wi-Fi 必須能連外並使用 NTP。校時只供憑證驗證，MQTT payload 仍只有三個 raw 欄位，沒有裝置時間。

本機非 TLS broker 使用 `APP_MQTT_TLS 0` 與 port 1883。韌體一次只送到設定的 broker；改送遠端後，本機 Docker broker 不會自動收到副本。

SSID 留空時只做 USB raw 監看。實際設定檔不提交 Git。

在已啟用 ESP-IDF 6.1 的 terminal，進入此資料夾：

```sh
idf.py set-target esp32s3
idf.py build
idf.py -p COM7 flash monitor
```

COM7 改成實際連接埠，Linux/macOS 改為對應 serial device。序列埠 115200，Ctrl+] 離開 monitor。

### Windows 中文路徑

在 repository 根目錄執行：

```powershell
& firmware/esp32-s3/tools/idf.ps1 build
& firmware/esp32-s3/tools/idf.ps1 -IdfArgs @('-p', 'COM7', 'flash', 'monitor')
```

工具將程式複製到 `C:\esp\ntnu-iot-firmware` 編譯，以避開 ESP-IDF 對中文路徑的限制。可用環境變數 NTNU_IDF_BUILD_DIR 指定另一個英文路徑。若未啟用環境，會嘗試這台開發機的 ESP-IDF 6.1 activation script；其他電腦請先開 ESP-IDF PowerShell。

## 看數值

USB log 每秒顯示 HX711、ADS1115、touch raw 值。Wi-Fi/MQTT 連線成功後開啟 `http://<server-IP>:8088` 即可看 DB 最新值與歷史曲線。

不需要按歸零、乾布 baseline 或校正；目前就是觀察讀值如何變化。缺少感測器或讀取失敗會傳 null。斷線自動重連，只傳新讀值，不補送離線期間資料。

遠端 broker 的接收驗證可在 repository 根目錄執行 `python tools/mqtt_tls_monitor.py`。這個工具會從本機韌體設定讀取帳密，以系統信任的 CA 驗證 TLS，訂閱同一 topic 後顯示最多五筆資料；不發送測試讀值。
