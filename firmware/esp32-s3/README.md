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
& firmware/esp32-s3/tools/idf.ps1 -p COM7 flash monitor
```

工具將程式複製到 `C:\esp\ntnu-iot-firmware` 編譯，以避開 ESP-IDF 對中文路徑的限制。可用環境變數 NTNU_IDF_BUILD_DIR 指定另一個英文路徑。若未啟用環境，會嘗試這台開發機的 ESP-IDF 6.1 activation script；其他電腦請先開 ESP-IDF PowerShell。

## 看數值

USB log 每秒顯示 HX711、ADS1115、touch raw 值。Wi-Fi/MQTT 連線成功後開啟 `http://<server-IP>:8088` 即可看 DB 最新值與歷史曲線。

不需要按歸零、乾布 baseline 或校正；目前就是觀察讀值如何變化。缺少感測器或讀取失敗會傳 null。斷線自動重連，只傳新讀值，不補送離線期間資料。
