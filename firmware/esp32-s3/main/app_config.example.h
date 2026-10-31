#pragma once

// ===== Quick setup: edit these values, then build and upload =====
// Use a 2.4 GHz Wi-Fi network. Empty SSID = USB raw monitoring only.
#define APP_WIFI_SSID       ""
#define APP_WIFI_PASSWORD   ""

// Broker IP/hostname reachable FROM the ESP32, not localhost or Docker's mosquitto.
#define APP_MQTT_HOST       ""
#define APP_MQTT_PORT       1883
#define APP_MQTT_USERNAME   ""  // Empty = no username
#define APP_MQTT_PASSWORD   ""
#define APP_MQTT_TOPIC      "clothes/raw"

// Plain MQTT for a local demo network. No historical replay, QoS 0, retain=false.
#define APP_SAMPLE_PERIOD_MS 1000
