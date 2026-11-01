#include <stdio.h>
#include <assert.h>
#include <stdlib.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <string.h>
#include <math.h>
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/touch_sens.h"
#include "driver/usb_serial_jtag.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_crt_bundle.h"
#include "mqtt_client.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "app_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#ifndef APP_MQTT_TLS
#define APP_MQTT_TLS 0
#endif
#ifndef APP_SNTP_SERVER
#define APP_SNTP_SERVER "pool.ntp.org"
#endif

#define DT GPIO_NUM_4
#define SCK GPIO_NUM_5
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static i2c_master_dev_handle_t ads;
static touch_sensor_handle_t touch_sensor;
static touch_channel_handle_t touch_channel;

static void touch_init(void)
{
    touch_sensor_sample_config_t sample = TOUCH_SENSOR_V2_DEFAULT_SAMPLE_CONFIG(
        500, TOUCH_VOLT_LIM_L_0V5, TOUCH_VOLT_LIM_H_2V2);
    touch_sensor_config_t config = TOUCH_SENSOR_DEFAULT_BASIC_CONFIG(1, &sample);
    ESP_ERROR_CHECK(touch_sensor_new_controller(&config, &touch_sensor));
    touch_channel_config_t channel = {
        .active_thresh = {2000},
        .charge_speed = TOUCH_CHARGE_SPEED_7,
        .init_charge_volt = TOUCH_INIT_CHARGE_VOLT_DEFAULT,
    };
    // On ESP32-S3 touch channel 10 maps to GPIO10.
    ESP_ERROR_CHECK(touch_sensor_new_channel(touch_sensor, 10, &channel, &touch_channel));
    ESP_ERROR_CHECK(touch_sensor_enable(touch_sensor));
    for (int i = 0; i < 3; i++)
        ESP_ERROR_CHECK(touch_sensor_trigger_oneshot_scanning(touch_sensor, 1000));
}

static esp_err_t touch_average(double *value, int samples)
{
    double sum = 0;
    for (int i = 0; i < samples; i++) {
        esp_err_t err = touch_sensor_trigger_oneshot_scanning(touch_sensor, 100);
        if (err != ESP_OK) return err;
        uint32_t raw;
        err = touch_channel_read_data(touch_channel, TOUCH_CHAN_DATA_TYPE_RAW, &raw);
        if (err != ESP_OK) return err;
        if (raw == 0 || raw >= 0x3fffff) return ESP_ERR_INVALID_RESPONSE;
        sum += raw;
    }
    *value = sum / samples;
    return ESP_OK;
}

static void ads_init(void)
{
    i2c_master_bus_handle_t bus;
    i2c_master_bus_config_t config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = GPIO_NUM_8,
        .scl_io_num = GPIO_NUM_9,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };
    ESP_ERROR_CHECK(i2c_new_master_bus(&config, &bus));
    i2c_device_config_t device = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = 0x48,
        .scl_speed_hz = 100000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &device, &ads));
}

static esp_err_t ads_read(int16_t *raw)
{
    // OS=start, MUX=A0-GND, PGA=+/-4.096V, single-shot, 128 SPS, comparator off.
    const uint8_t start[] = { 1, 0xc3, 0x83 };
    esp_err_t err = i2c_master_transmit(ads, start, sizeof(start), 100);
    if (err != ESP_OK) return err;
    int64_t deadline = esp_timer_get_time() + 150000;
    uint8_t reg = 1, bytes[2];
    do {
        vTaskDelay(pdMS_TO_TICKS(10));
        err = i2c_master_transmit_receive(ads, &reg, 1, bytes, 2, 100);
        if (err != ESP_OK) return err;
        if (bytes[0] & 0x80) break;
        if (esp_timer_get_time() >= deadline) return ESP_ERR_TIMEOUT;
    } while (true);
    reg = 0;
    err = i2c_master_transmit_receive(ads, &reg, 1, bytes, 2, 100);
    if (err == ESP_OK) *raw = (int16_t)(((uint16_t)bytes[0] << 8) | bytes[1]);
    return err;
}

static void output(const char *fmt, ...)
{
    char buffer[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);
    usb_serial_jtag_write_bytes(buffer, strlen(buffer), pdMS_TO_TICKS(100));
}

static bool read_raw(int32_t *result)
{
    int64_t deadline = esp_timer_get_time() + 150000;
    while (gpio_get_level(DT)) {
        if (esp_timer_get_time() > deadline) return false;
        vTaskDelay(1);
    }
    uint32_t bits = 0;
    // Keep clock high pulses short: an interrupt must not accidentally power down HX711.
    portENTER_CRITICAL(&mux);
    for (int i = 0; i < 24; i++) {
        gpio_set_level(SCK, 1);
        esp_rom_delay_us(1);
        bits = (bits << 1) | gpio_get_level(DT);
        gpio_set_level(SCK, 0);
        esp_rom_delay_us(1);
    }
    // Pulse 25 selects channel A, gain 128 for the next conversion.
    gpio_set_level(SCK, 1);
    esp_rom_delay_us(1);
    gpio_set_level(SCK, 0);
    portEXIT_CRITICAL(&mux);
    *result = (bits & 0x800000) ? (int32_t)(bits | 0xff000000) : (int32_t)bits;
    return true;
}

#define WIFI_UP BIT0
#define MQTT_UP BIT1
static EventGroupHandle_t connection;
static esp_mqtt_client_handle_t mqtt;
static QueueHandle_t pending;
typedef struct {
    char json[160];
    int64_t sampled_us;
} packet_t;

static void network_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(connection, WIFI_UP | MQTT_UP);
        xQueueReset(pending);
        // Reconnect attempts are paced by ESP Wi-Fi's scan/auth attempt.
        esp_wifi_connect();
        output("NET Wi-Fi disconnected; reconnecting\r\n");
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(connection, WIFI_UP);
        output("NET Wi-Fi connected; IP acquired\r\n");
    }
}

static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (id == MQTT_EVENT_CONNECTED) {
        xQueueReset(pending);
        xEventGroupSetBits(connection, MQTT_UP);
        output("NET MQTT connected; topic=%s\r\n", APP_MQTT_TOPIC);
    } else if (id == MQTT_EVENT_DISCONNECTED) {
        xEventGroupClearBits(connection, MQTT_UP);
        xQueueReset(pending);
        output("NET MQTT disconnected; new samples only after reconnect\r\n");
    } else if (id == MQTT_EVENT_ERROR) {
        output("NET MQTT error; check broker address/port/authentication\r\n");
    }
}

static void publish_task(void *arg)
{
    packet_t packet;
    for (;;) {
        if (xQueueReceive(pending, &packet, portMAX_DELAY) != pdTRUE) continue;
        if (!(xEventGroupGetBits(connection) & MQTT_UP)) continue;
        if (esp_timer_get_time() - packet.sampled_us > APP_SAMPLE_PERIOD_MS * 1000LL) continue;
        // QoS 0 avoids MQTT retransmission/outbox replay. Never enqueue offline records.
        int result = esp_mqtt_client_publish(mqtt, APP_MQTT_TOPIC, packet.json, 0, 0, 0);
        if (result < 0) output("NET publish failed; record discarded\r\n");
    }
}

static void mqtt_start_task(void *arg)
{
    xEventGroupWaitBits(connection, WIFI_UP, pdFALSE, pdTRUE, portMAX_DELAY);
#if APP_MQTT_TLS
    // Certificate validity requires a real clock, even though telemetry has no timestamp.
    esp_sntp_config_t time_config = ESP_NETIF_SNTP_DEFAULT_CONFIG(APP_SNTP_SERVER);
    ESP_ERROR_CHECK(esp_netif_sntp_init(&time_config));
    while (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(30000)) != ESP_OK) {
        output("NET waiting for network time; TLS verification remains enabled\r\n");
    }
    output("NET time synchronized; starting verified MQTT TLS\r\n");
#endif
    ESP_ERROR_CHECK(esp_mqtt_client_start(mqtt));
    vTaskDelete(NULL);
}

static void network_init(void)
{
    if (!strlen(APP_WIFI_SSID) || !strlen(APP_MQTT_HOST)) {
        output("NET disabled: fill main/app_config.h Wi-Fi SSID and MQTT host, then upload\r\n");
        return;
    }
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *netif = esp_netif_create_default_wifi_sta();
    assert(netif);
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, network_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, network_event, NULL));
    wifi_config_t wifi = {0};
    _Static_assert(sizeof(APP_WIFI_SSID) <= 33, "Wi-Fi SSID exceeds 32 bytes");
    _Static_assert(sizeof(APP_WIFI_PASSWORD) <= 65, "Wi-Fi password exceeds 64 bytes");
    memcpy(wifi.sta.ssid, APP_WIFI_SSID, sizeof(APP_WIFI_SSID)-1);
    memcpy(wifi.sta.password, APP_WIFI_PASSWORD, sizeof(APP_WIFI_PASSWORD)-1);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));

    const esp_mqtt_client_config_t config = {
        .broker.address.hostname = APP_MQTT_HOST,
        .broker.address.port = APP_MQTT_PORT,
        .broker.address.transport = APP_MQTT_TLS ? MQTT_TRANSPORT_OVER_SSL : MQTT_TRANSPORT_OVER_TCP,
#if APP_MQTT_TLS
        .broker.verification.crt_bundle_attach = esp_crt_bundle_attach,
#endif
        .credentials.username = strlen(APP_MQTT_USERNAME) ? APP_MQTT_USERNAME : NULL,
        .credentials.authentication.password = strlen(APP_MQTT_USERNAME) ? APP_MQTT_PASSWORD : NULL,
        .session.keepalive = 30,
        .network.timeout_ms = 10000,
        .network.reconnect_timeout_ms = 3000,
    };
    mqtt = esp_mqtt_client_init(&config);
    assert(mqtt);
    ESP_ERROR_CHECK(esp_mqtt_client_register_event(mqtt, ESP_EVENT_ANY_ID, mqtt_event, NULL));
    BaseType_t created = xTaskCreate(publish_task, "raw_publish", 4096, NULL, 4, NULL);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreate(mqtt_start_task, "mqtt_start", 4096, NULL, 4, NULL);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(esp_wifi_start());
}

void app_main(void)
{
    usb_serial_jtag_driver_config_t usb = { .tx_buffer_size=2048, .rx_buffer_size=256 };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));
    ESP_ERROR_CHECK(nvs_flash_init());
    connection = xEventGroupCreate();
    pending = xQueueCreate(1, sizeof(packet_t));
    assert(connection && pending);
    ads_init();
    touch_init();
    gpio_config_t input = {.pin_bit_mask=1ULL << DT, .mode=GPIO_MODE_INPUT,
                           .pull_up_en=GPIO_PULLUP_ENABLE};
    gpio_config_t clock = {.pin_bit_mask=1ULL << SCK, .mode=GPIO_MODE_OUTPUT};
    ESP_ERROR_CHECK(gpio_config(&input));
    ESP_ERROR_CHECK(gpio_config(&clock));
    gpio_set_level(SCK, 0);
    output("\r\nRAW telemetry: HX711 GPIO4/5, ADS SDA8/SCL9, touch GPIO10\r\n");
    network_init();
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        packet_t packet = {.sampled_us=esp_timer_get_time()};
        int32_t hx;
        int16_t adc;
        double touch;
        char hx_text[24]="null", ads_text[24]="null", touch_text[24]="null";
        if (read_raw(&hx) && hx != 8388607 && hx != -8388608)
            snprintf(hx_text, sizeof(hx_text), "%ld", (long)hx);
        if (ads_read(&adc) == ESP_OK && adc != INT16_MAX && adc != INT16_MIN)
            snprintf(ads_text, sizeof(ads_text), "%d", adc);
        if (touch_average(&touch, 1) == ESP_OK)
            snprintf(touch_text, sizeof(touch_text), "%.0f", touch);
        snprintf(packet.json, sizeof(packet.json),
                 "{\"hx711_raw\":%s,\"ads1115_raw\":%s,\"touch_raw\":%s}",
                 hx_text, ads_text, touch_text);
        output("%s\r\n", packet.json);
        if (xEventGroupGetBits(connection) & MQTT_UP) xQueueOverwrite(pending, &packet);
        // Fixed cadence, no burst/catch-up after a slow or failed measurement.
        if (xTaskDelayUntil(&last, pdMS_TO_TICKS(APP_SAMPLE_PERIOD_MS)) == pdFALSE) {
            last = xTaskGetTickCount();
            vTaskDelay(1);
        }
    }
}
