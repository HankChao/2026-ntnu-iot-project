#pragma once

// ===== Initial defaults only; saved phone setup in NVS takes precedence =====
// Use 2.4 GHz Wi-Fi. Blank settings + no saved NVS => phone setup hotspot.
// After boot hold GPIO0 for 3 seconds; connect to Clothes-Setup-xxxx and open 192.168.4.1.
// The unique hotspot password is printed over USB (115200); USB command: setup + Enter.
#define APP_WIFI_SSID       ""
#define APP_WIFI_PASSWORD   ""

// Broker IP/hostname reachable FROM the ESP32, not localhost or Docker's mosquitto.
#define APP_MQTT_HOST       ""
#define APP_MQTT_PORT       1883
#define APP_MQTT_TLS        0  // Set 1 for TLS (normally port 8883); CA bundle + hostname verified.
#define APP_MQTT_USERNAME   ""  // Empty = no username
#define APP_MQTT_PASSWORD   ""
#define APP_MQTT_TOPIC      "clothes/raw"

// TLS needs network time to validate the broker certificate. No time is added to payloads.
#define APP_SNTP_SERVER     "pool.ntp.org"
// No historical replay, QoS 0, retain=false.
#define APP_SAMPLE_PERIOD_MS 1000
