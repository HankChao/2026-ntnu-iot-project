#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include <ctype.h>
#include <math.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "driver/usb_serial_jtag.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_crt_bundle.h"
#include "esp_http_server.h"
#include "mqtt_client.h"
#include "nvs.h"
#include "cJSON.h"
#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "app_config.h"
#include "network_setup.h"

#ifndef APP_MQTT_TLS
#define APP_MQTT_TLS 0
#endif
#ifndef APP_SNTP_SERVER
#define APP_SNTP_SERVER "pool.ntp.org"
#endif
#ifndef APP_SETUP_AP_PASSWORD
#define APP_SETUP_AP_PASSWORD "12345678"
#endif
// WPA2-PSK passphrase: 8-63 characters.
_Static_assert(sizeof(APP_SETUP_AP_PASSWORD) >= 9 && sizeof(APP_SETUP_AP_PASSWORD) <= 64,
    "APP_SETUP_AP_PASSWORD must be 8-63 characters");

#define WIFI_UP BIT0
#define MQTT_UP BIT1
#define CLOCK_OK BIT2
#define WIFI_DOWN BIT3
#define CANCEL BIT4
#define VERSION 1
#define SETUP_PIN GPIO_NUM_0

typedef struct {
    uint32_t version;
    char ssid[33], wifi_password[65];
    char host[129], username[65], mqtt_password[129], topic[129];
    uint16_t port;
    uint8_t tls;
} settings_t;
typedef enum { OPEN_SETUP, CLOSE_SETUP, TEST_SETTINGS } command_kind_t;
typedef struct { command_kind_t kind; settings_t settings; } command_t;

static settings_t active;
static EventGroupHandle_t events;
static SemaphoreHandle_t state_lock, mqtt_lock, wifi_lock;
static QueueHandle_t commands;
static esp_mqtt_client_handle_t client;
static esp_netif_t *sta_netif;
static httpd_handle_t server;
static bool ap_open, testing, allow_publish, reconnect_wifi, portal_paused_sta;
static int last_reason;
static char phase[24] = "connecting", message[192] = "正在連線";
static char ap_ssid[33], ap_password[64], csrf[33];
static int64_t close_at, ap_expire_at;

extern const unsigned char portal_start[] asm("_binary_setup_portal_html_start");
extern const unsigned char portal_end[] asm("_binary_setup_portal_html_end");

static void status_set(const char *stage, const char *msg)
{
    xSemaphoreTake(state_lock, portMAX_DELAY);
    snprintf(phase, sizeof(phase), "%s", stage);
    snprintf(message, sizeof(message), "%s", msg);
    xSemaphoreGive(state_lock);
    printf("NET %s: %s\n", stage, msg);
}

static esp_err_t save_settings(const settings_t *cfg)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open("clothes_net", NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(handle, "settings", cfg, sizeof(*cfg));
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}

static bool valid_strings(const settings_t *s)
{
    return s->version == VERSION && memchr(s->ssid, 0, sizeof(s->ssid)) &&
        memchr(s->wifi_password, 0, sizeof(s->wifi_password)) &&
        memchr(s->host, 0, sizeof(s->host)) && memchr(s->username, 0, sizeof(s->username)) &&
        memchr(s->mqtt_password, 0, sizeof(s->mqtt_password)) && memchr(s->topic, 0, sizeof(s->topic)) &&
        s->ssid[0] && s->host[0] && s->topic[0] && s->port && s->tls <= 1;
}

static void load_settings(void)
{
    // app_config.h is only a migration/default source. Saved NVS settings win.
    active = (settings_t){.version=VERSION, .port=APP_MQTT_PORT, .tls=APP_MQTT_TLS};
    snprintf(active.ssid, sizeof(active.ssid), "%s", APP_WIFI_SSID);
    snprintf(active.wifi_password, sizeof(active.wifi_password), "%s", APP_WIFI_PASSWORD);
    snprintf(active.host, sizeof(active.host), "%s", APP_MQTT_HOST);
    snprintf(active.username, sizeof(active.username), "%s", APP_MQTT_USERNAME);
    snprintf(active.mqtt_password, sizeof(active.mqtt_password), "%s", APP_MQTT_PASSWORD);
    snprintf(active.topic, sizeof(active.topic), "%s", APP_MQTT_TOPIC);
    nvs_handle_t handle;
    if (nvs_open("clothes_net", NVS_READONLY, &handle) == ESP_OK) {
        settings_t saved = {0};
        size_t size = sizeof(saved);
        if (nvs_get_blob(handle, "settings", &saved, &size) == ESP_OK &&
                size == sizeof(saved) && valid_strings(&saved)) active = saved;
        nvs_close(handle);
    }
    uint8_t mac[6];
    ESP_ERROR_CHECK(esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP));
    snprintf(ap_ssid, sizeof(ap_ssid), "Clothes-Setup-%02X%02X", mac[4], mac[5]);
    snprintf(ap_password, sizeof(ap_password), "%s", APP_SETUP_AP_PASSWORD);
}

static void time_synced(struct timeval *tv)
{
    xEventGroupSetBits(events, CLOCK_OK);
    printf("NET time synchronized\n");
}

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        if (reconnect_wifi) esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *event = data;
        last_reason = event->reason;
        xEventGroupClearBits(events, WIFI_UP | MQTT_UP);
        xEventGroupSetBits(events, WIFI_DOWN);
        if (reconnect_wifi) esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = data;
        xEventGroupClearBits(events, WIFI_DOWN);
        xEventGroupSetBits(events, WIFI_UP);
        wifi_ap_record_t ap_info;
        if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK)
            printf("NET Wi-Fi IP: " IPSTR " (channel %u, RSSI %d dBm)\n", IP2STR(&event->ip_info.ip),
                ap_info.primary, ap_info.rssi);
        else printf("NET Wi-Fi IP: " IPSTR "\n", IP2STR(&event->ip_info.ip));
        // Restart SNTP on every new IP until synced: a request sent on a previous network
        // (or lost on a weak link) must not leave the clock waiting for lwIP's backoff.
        if (!(xEventGroupGetBits(events) & CLOCK_OK)) esp_netif_sntp_start();
    }
}

static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_mqtt_event_handle_t event = data;
    if (event->client != client) return;
    if (id == MQTT_EVENT_CONNECTED) {
        xEventGroupSetBits(events, MQTT_UP);
        printf("NET MQTT connected\n");
    } else if (id == MQTT_EVENT_DISCONNECTED || id == MQTT_EVENT_ERROR) {
        xEventGroupClearBits(events, MQTT_UP);
        if (id==MQTT_EVENT_ERROR && event->error_handle) {
            printf("NET MQTT transport error: esp=0x%x tls=0x%x verify=0x%x socket=%d heap=%lu\n",
                event->error_handle->esp_tls_last_esp_err, -event->error_handle->esp_tls_stack_err,
                event->error_handle->esp_tls_cert_verify_flags, event->error_handle->esp_transport_sock_errno,
                (unsigned long)esp_get_free_heap_size());
        }
    }
}

static void mqtt_stop(void)
{
    xSemaphoreTake(state_lock, portMAX_DELAY); allow_publish = false; xSemaphoreGive(state_lock);
    xSemaphoreTake(mqtt_lock, portMAX_DELAY);
    if (client) {
        esp_mqtt_client_stop(client);
        esp_mqtt_client_destroy(client);
        client = NULL;
    }
    xEventGroupClearBits(events, MQTT_UP);
    xSemaphoreGive(mqtt_lock);
}

static esp_err_t mqtt_start(const settings_t *cfg)
{
    struct addrinfo hints={.ai_family=AF_INET,.ai_socktype=SOCK_STREAM}, *resolved=NULL;
    if (getaddrinfo(cfg->host,NULL,&hints,&resolved)==0 && resolved) {
        char addr[INET_ADDRSTRLEN];
        inet_ntop(AF_INET,&((struct sockaddr_in *)resolved->ai_addr)->sin_addr,addr,sizeof(addr));
        printf("NET MQTT destination: %s:%u (%s), TLS=%u\n",cfg->host,cfg->port,addr,cfg->tls);
        freeaddrinfo(resolved);
    }
    esp_mqtt_client_config_t config = {
        .broker.address.hostname=cfg->host,
        .broker.address.port=cfg->port,
        .broker.address.transport=cfg->tls ? MQTT_TRANSPORT_OVER_SSL : MQTT_TRANSPORT_OVER_TCP,
        .credentials.username=cfg->username[0] ? cfg->username : NULL,
        .credentials.authentication.password=cfg->username[0] ? cfg->mqtt_password : NULL,
        .session.keepalive=30,
        .network.timeout_ms=10000,
        .network.reconnect_timeout_ms=3000,
    };
    if (cfg->tls) config.broker.verification.crt_bundle_attach=esp_crt_bundle_attach;
    xSemaphoreTake(mqtt_lock, portMAX_DELAY);
    client = esp_mqtt_client_init(&config);
    esp_err_t err = client ? esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID, mqtt_event, NULL) : ESP_ERR_NO_MEM;
    if (err == ESP_OK) err = esp_mqtt_client_start(client);
    if (err != ESP_OK && client) { esp_mqtt_client_destroy(client); client=NULL; }
    xSemaphoreGive(mqtt_lock);
    return err;
}

bool network_ready(void)
{
    xSemaphoreTake(state_lock, portMAX_DELAY);
    bool ready = allow_publish && !testing;
    xSemaphoreGive(state_lock);
    return ready && ((xEventGroupGetBits(events) & (WIFI_UP | MQTT_UP)) == (WIFI_UP | MQTT_UP));
}

void network_publish(const char *json, int64_t sampled_us)
{
    if (!network_ready() || esp_timer_get_time()-sampled_us > APP_SAMPLE_PERIOD_MS*1000LL) return;
    xSemaphoreTake(mqtt_lock, portMAX_DELAY);
    if (client && network_ready()) {
        esp_mqtt_client_publish(client, active.topic, json, 0, 0, 0);
    }
    xSemaphoreGive(mqtt_lock);
}

static void apply_sta_config(const settings_t *cfg)
{
    wifi_config_t wifi = {0};
    memcpy(wifi.sta.ssid, cfg->ssid, strlen(cfg->ssid));
    memcpy(wifi.sta.password, cfg->wifi_password, strlen(cfg->wifi_password));
    // Campus/dorm SSIDs have many BSSIDs. Fast scan joins the first one found (lowest
    // channel), which may be a distant AP; scan all channels and pick the strongest.
    wifi.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    wifi.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    wifi.sta.failure_retry_cnt = 2;
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi));
}

static void switch_wifi(const settings_t *cfg, bool connect)
{
    reconnect_wifi = false;
    xEventGroupClearBits(events, WIFI_DOWN | WIFI_UP | MQTT_UP);
    if (esp_wifi_disconnect() == ESP_OK) {
        xEventGroupWaitBits(events, WIFI_DOWN, pdFALSE, pdTRUE, pdMS_TO_TICKS(1500));
    }
    apply_sta_config(cfg);
    last_reason = 0;
    reconnect_wifi = cfg->ssid[0] != 0 && connect;
    if (reconnect_wifi) esp_wifi_connect();
}

static bool wait_bits(EventBits_t required, unsigned seconds)
{
    int64_t end = esp_timer_get_time() + seconds*1000000LL;
    while (esp_timer_get_time() < end) {
        EventBits_t bits = xEventGroupGetBits(events);
        if (bits & CANCEL) return false;
        if ((bits & required) == required) return true;
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    return false;
}

static bool request_is_ap(httpd_req_t *req)
{
    struct sockaddr_storage address;
    socklen_t size = sizeof(address);
    uint32_t ipv4=0;
    if (getsockname(httpd_req_to_sockfd(req), (struct sockaddr *)&address, &size)==0) {
        if (address.ss_family==AF_INET) ipv4=((struct sockaddr_in *)&address)->sin_addr.s_addr;
#if CONFIG_LWIP_IPV6
        else if (address.ss_family==AF_INET6) {
            struct sockaddr_in6 *v6=(struct sockaddr_in6 *)&address;
            if (IN6_IS_ADDR_V4MAPPED(&v6->sin6_addr)) memcpy(&ipv4,&v6->sin6_addr.s6_addr[12],sizeof(ipv4));
        }
#endif
    }
    if (ipv4 != inet_addr("192.168.4.1")) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Connect to the setup Wi-Fi first");
        return false;
    }
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "X-Frame-Options", "DENY");
    httpd_resp_set_hdr(req, "Referrer-Policy", "no-referrer");
    return true;
}

static bool authorize_change(httpd_req_t *req)
{
    if (!request_is_ap(req)) return false;
    char token[40];
    if (httpd_req_get_hdr_value_str(req, "X-Setup-Token", token, sizeof(token)) != ESP_OK || strcmp(token, csrf)) {
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Invalid setup token");
        return false;
    }
    return true;
}

static esp_err_t send_json(httpd_req_t *req, cJSON *json)
{
    char *body = json ? cJSON_PrintUnformatted(json) : NULL;
    if (json) cJSON_Delete(json);
    if (!body) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Out of memory");
    httpd_resp_set_type(req, "application/json; charset=utf-8");
    esp_err_t err = httpd_resp_sendstr(req, body);
    free(body); return err;
}

static esp_err_t root_get(httpd_req_t *req)
{
    if (!request_is_ap(req)) return ESP_OK;
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, (const char *)portal_start, portal_end-portal_start);
}

static esp_err_t config_get(httpd_req_t *req)
{
    if (!request_is_ap(req)) return ESP_OK;
    cJSON *json=cJSON_CreateObject();
    xSemaphoreTake(state_lock, portMAX_DELAY);
    cJSON_AddStringToObject(json,"ssid",active.ssid);
    cJSON_AddBoolToObject(json,"wifi_password_saved",active.wifi_password[0]);
    cJSON_AddStringToObject(json,"host",active.host);
    cJSON_AddStringToObject(json,"username",active.username);
    cJSON_AddStringToObject(json,"topic",active.topic);
    cJSON_AddNumberToObject(json,"port",active.port);
    cJSON_AddBoolToObject(json,"tls",active.tls);
    cJSON_AddBoolToObject(json,"mqtt_password_saved",active.mqtt_password[0]);
    cJSON_AddStringToObject(json,"token",csrf);
    xSemaphoreGive(state_lock);
    return send_json(req,json);
}

static esp_err_t status_get(httpd_req_t *req)
{
    if (!request_is_ap(req)) return ESP_OK;
    cJSON *json=cJSON_CreateObject();
    xSemaphoreTake(state_lock, portMAX_DELAY);
    cJSON_AddStringToObject(json,"phase",phase);
    cJSON_AddStringToObject(json,"message",message);
    cJSON_AddBoolToObject(json,"testing",testing);
    xSemaphoreGive(state_lock);
    EventBits_t bits=xEventGroupGetBits(events);
    cJSON_AddBoolToObject(json,"wifi_connected",bits&WIFI_UP);
    cJSON_AddBoolToObject(json,"mqtt_connected",bits&MQTT_UP);
    cJSON_AddNumberToObject(json,"wifi_reason",last_reason);
    esp_netif_ip_info_t ip;
    char ip_text[20]="";
    if ((bits&WIFI_UP) && esp_netif_get_ip_info(sta_netif,&ip)==ESP_OK)
        snprintf(ip_text,sizeof(ip_text),IPSTR,IP2STR(&ip.ip));
    cJSON_AddStringToObject(json,"ip",ip_text);
    return send_json(req,json);
}

static esp_err_t scan_get(httpd_req_t *req)
{
    if (!request_is_ap(req)) return ESP_OK;
    xSemaphoreTake(state_lock, portMAX_DELAY); bool busy=testing; xSemaphoreGive(state_lock);
    if (busy || xSemaphoreTake(wifi_lock,0)!=pdTRUE) { httpd_resp_set_status(req,"409 Conflict"); return httpd_resp_sendstr(req,"Connection test in progress"); }
    bool paused=!(xEventGroupGetBits(events)&WIFI_UP) && reconnect_wifi;
    if (paused) {
        reconnect_wifi=false;
        xEventGroupClearBits(events,WIFI_DOWN);
        if (esp_wifi_disconnect()==ESP_OK) xEventGroupWaitBits(events,WIFI_DOWN,pdFALSE,pdTRUE,pdMS_TO_TICKS(1000));
    }
    wifi_scan_config_t scan={.show_hidden=true};
    esp_err_t err=esp_wifi_scan_start(&scan,true);
    if (err!=ESP_OK) {
        if (paused) { reconnect_wifi=true; esp_wifi_connect(); }
        xSemaphoreGive(wifi_lock); httpd_resp_set_status(req,"409 Conflict"); return httpd_resp_sendstr(req,"Wi-Fi busy; try again shortly");
    }
    uint16_t count=24;
    wifi_ap_record_t *records=calloc(count,sizeof(*records));
    if (!records) {
        esp_wifi_clear_ap_list(); if (paused) { reconnect_wifi=true; esp_wifi_connect(); }
        xSemaphoreGive(wifi_lock); return httpd_resp_send_err(req,HTTPD_500_INTERNAL_SERVER_ERROR,"Out of memory");
    }
    err=esp_wifi_scan_get_ap_records(&count,records);
    cJSON *json=cJSON_CreateObject(), *array=cJSON_AddArrayToObject(json,"networks");
    for (int i=0;err==ESP_OK && i<count;i++) {
        if (!records[i].ssid[0]) continue;
        cJSON *item=cJSON_CreateObject();
        cJSON_AddStringToObject(item,"ssid",(char *)records[i].ssid);
        cJSON_AddNumberToObject(item,"rssi",records[i].rssi);
        cJSON_AddBoolToObject(item,"open",records[i].authmode==WIFI_AUTH_OPEN);
        cJSON_AddItemToArray(array,item);
    }
    free(records);
    if (paused) { reconnect_wifi=true; esp_wifi_connect(); }
    xSemaphoreGive(wifi_lock);
    return send_json(req,json);
}

static bool json_string(cJSON *json,const char *key,char *dest,size_t size)
{
    cJSON *item=cJSON_GetObjectItemCaseSensitive(json,key);
    if (!cJSON_IsString(item) || strlen(item->valuestring)>=size) return false;
    // Embedded U+0000 must not silently shorten credentials or bypass validation.
    snprintf(dest,size,"%s",item->valuestring); return true;
}

static bool parse_settings(cJSON *json, settings_t *candidate, char *error, size_t size)
{
    xSemaphoreTake(state_lock,portMAX_DELAY); *candidate=active; xSemaphoreGive(state_lock);
    settings_t *c=candidate;
    char old_ssid[33]; snprintf(old_ssid,sizeof(old_ssid),"%s",c->ssid);
    if (!json_string(json,"ssid",c->ssid,sizeof(c->ssid)) || !c->ssid[0]) goto invalid;
    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json,"open"))) c->wifi_password[0]=0;
    else if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json,"keep_wifi_password"))) {
        if (strcmp(old_ssid,c->ssid) || !c->wifi_password[0]) goto invalid;
    } else if (!json_string(json,"wifi_password",c->wifi_password,sizeof(c->wifi_password)) || !c->wifi_password[0]) goto invalid;
    size_t length=strlen(c->wifi_password);
    if (length && length<8) goto invalid;
    if (length==64) for (int i=0;i<64;i++) if (!isxdigit((unsigned char)c->wifi_password[i])) goto invalid;
    if (!json_string(json,"host",c->host,sizeof(c->host)) || !c->host[0] ||
            !json_string(json,"username",c->username,sizeof(c->username)) ||
            !json_string(json,"topic",c->topic,sizeof(c->topic)) || !c->topic[0]) goto invalid;
    for (const char *p=c->host;*p;p++) if (!(isalnum((unsigned char)*p) || *p=='.' || *p=='-')) goto invalid;
    if (strchr(c->topic,'#') || strchr(c->topic,'+')) goto invalid;
    cJSON *port=cJSON_GetObjectItemCaseSensitive(json,"port"), *tls=cJSON_GetObjectItemCaseSensitive(json,"tls");
    if (!cJSON_IsNumber(port) || !isfinite(port->valuedouble) || port->valuedouble<1 ||
            port->valuedouble>65535 || floor(port->valuedouble)!=port->valuedouble || !cJSON_IsBool(tls)) goto invalid;
    c->port=(uint16_t)port->valueint; c->tls=cJSON_IsTrue(tls);
    if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json,"keep_mqtt_password")) &&
            !json_string(json,"mqtt_password",c->mqtt_password,sizeof(c->mqtt_password))) goto invalid;
    return true;
invalid:
    snprintf(error,size,"請檢查 Wi-Fi 名稱／密碼、MQTT 網域、port（1–65535）與 topic。新網路須填密碼或勾選無密碼。");
    return false;
}

static esp_err_t connect_post(httpd_req_t *req)
{
    if (!authorize_change(req)) return ESP_OK;
    if (req->content_len<=0 || req->content_len>2048)
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid request size");
    char type[64];
    if (httpd_req_get_hdr_value_str(req,"Content-Type",type,sizeof(type))!=ESP_OK ||
            strncmp(type,"application/json",16)) return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"JSON required");
    char *body=calloc(1,req->content_len+1);
    if (!body) return httpd_resp_send_err(req,HTTPD_500_INTERNAL_SERVER_ERROR,"Out of memory");
    int received=0;
    while (received<req->content_len) {
        int got=httpd_req_recv(req,body+received,req->content_len-received);
        if (got<=0) { free(body); return ESP_FAIL; }
        received+=got;
    }
    cJSON *json=cJSON_ParseWithLengthOpts(body,req->content_len+1,NULL,true);
    command_t command={.kind=TEST_SETTINGS}; char error[256];
    bool valid=cJSON_IsObject(json) && !memchr(body,0,req->content_len) &&
        !strstr(body,"\\u0000") && parse_settings(json,&command.settings,error,sizeof(error));
    cJSON_Delete(json); memset(body,0,req->content_len); free(body);
    if (!valid) return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid Wi-Fi/MQTT settings");
    xSemaphoreTake(state_lock,portMAX_DELAY);
    if (testing) {
        xSemaphoreGive(state_lock); httpd_resp_set_status(req,"409 Conflict"); return httpd_resp_sendstr(req,"Test already running");
    }
    testing=true; close_at=0; ap_expire_at=esp_timer_get_time()+600000000LL;
    xEventGroupClearBits(events,CANCEL);
    if (xQueueSend(commands,&command,0)!=pdTRUE) {
        testing=false; xSemaphoreGive(state_lock);
        httpd_resp_set_status(req,"503 Service Unavailable");
        return httpd_resp_sendstr(req,"Busy");
    }
    xSemaphoreGive(state_lock);
    httpd_resp_set_status(req,"202 Accepted");
    return httpd_resp_sendstr(req,"{\"accepted\":true}");
}

static esp_err_t cancel_post(httpd_req_t *req)
{
    if (!authorize_change(req)) return ESP_OK;
    xEventGroupSetBits(events,CANCEL);
    return httpd_resp_sendstr(req,"{\"accepted\":true}");
}

static esp_err_t close_post(httpd_req_t *req)
{
    if (!authorize_change(req)) return ESP_OK;
    xSemaphoreTake(state_lock,portMAX_DELAY);
    if (!testing) close_at=esp_timer_get_time()+2000000;
    bool busy=testing;
    xSemaphoreGive(state_lock);
    if (busy) httpd_resp_set_status(req,"409 Conflict");
    return httpd_resp_sendstr(req,busy ? "Cancel the test first" : "{\"closing\":true}");
}

static void open_setup(void)
{
    if (ap_open) {
        printf("SETUP SSID=%s PASSWORD=%s URL=http://192.168.4.1\n",ap_ssid,ap_password);
        return;
    }
    // Stop repeated scans for an unavailable old network while the phone configures Wi-Fi.
    portal_paused_sta=!(xEventGroupGetBits(events)&WIFI_UP);
    if (portal_paused_sta) { reconnect_wifi=false; esp_wifi_disconnect(); }
    uint32_t random[4]; esp_fill_random(random,sizeof(random));
    snprintf(csrf,sizeof(csrf),"%08lx%08lx%08lx%08lx",(unsigned long)random[0],(unsigned long)random[1],(unsigned long)random[2],(unsigned long)random[3]);
    wifi_config_t ap={0};
    assert(strlen(ap_ssid)<=sizeof(ap.ap.ssid));
    memcpy(ap.ap.ssid,ap_ssid,strlen(ap_ssid));
    ap.ap.ssid_len=strlen(ap_ssid); ap.ap.channel=1; ap.ap.max_connection=3;
    snprintf((char *)ap.ap.password,sizeof(ap.ap.password),"%s",ap_password);
    ap.ap.authmode=WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP,&ap));
    httpd_config_t config=HTTPD_DEFAULT_CONFIG();
    config.stack_size=8192; config.max_uri_handlers=8; config.lru_purge_enable=true;
    ESP_ERROR_CHECK(httpd_start(&server,&config));
    httpd_uri_t handlers[]={
        {.uri="/",.method=HTTP_GET,.handler=root_get},
        {.uri="/api/config",.method=HTTP_GET,.handler=config_get},
        {.uri="/api/status",.method=HTTP_GET,.handler=status_get},
        {.uri="/api/scan",.method=HTTP_GET,.handler=scan_get},
        {.uri="/api/connect",.method=HTTP_POST,.handler=connect_post},
        {.uri="/api/cancel",.method=HTTP_POST,.handler=cancel_post},
        {.uri="/api/close",.method=HTTP_POST,.handler=close_post},
    };
    for (size_t i=0;i<sizeof(handlers)/sizeof(handlers[0]);i++) ESP_ERROR_CHECK(httpd_register_uri_handler(server,&handlers[i]));
    ap_open=true; ap_expire_at=esp_timer_get_time()+600000000LL;
    status_set("setup","請用手機連接設定熱點，開啟 http://192.168.4.1");
    // Printed only over the physical USB console, never returned by the web API.
    printf("SETUP SSID=%s PASSWORD=%s URL=http://192.168.4.1\n",ap_ssid,ap_password);
}

static void close_setup(void)
{
    if (!ap_open) return;
    httpd_stop(server); server=NULL;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ap_open=false; close_at=0;
    if (portal_paused_sta && active.ssid[0]) { reconnect_wifi=true; esp_wifi_connect(); }
    portal_paused_sta=false;
    printf("NET setup hotspot closed\n");
}

static void run_test(const settings_t *candidate)
{
    xSemaphoreTake(wifi_lock,portMAX_DELAY);
    bool previous_connected=(xEventGroupGetBits(events)&WIFI_UP)!=0;
    const char *failure="連線已取消，舊設定已保留。";
    mqtt_stop();
    status_set("testing_wifi","正在測試新 Wi-Fi（最多 20 秒）…");
    switch_wifi(candidate,true);
    if (!wait_bits(WIFI_UP,20)) { failure="Wi-Fi 連線失敗，請確認 2.4 GHz、名稱及密碼；舊設定已保留。"; goto failed; }
    if (candidate->tls) {
        status_set("testing_time","Wi-Fi 已連線，正在校時以驗證 TLS 憑證…");
        if (!wait_bits(WIFI_UP|CLOCK_OK,30)) { failure="無法校時，請確認網路可使用 NTP；舊設定已保留。"; goto failed; }
    }
    status_set("testing_mqtt","正在測試 MQTT 登入與伺服器憑證…");
    if (mqtt_start(candidate)!=ESP_OK || !wait_bits(WIFI_UP|MQTT_UP,20)) {
        failure="MQTT 無法連線，請檢查網域、port、TLS、帳密及網路登入；舊設定已保留。"; goto failed;
    }
    if (xEventGroupGetBits(events)&CANCEL) goto failed;
    if (save_settings(candidate)!=ESP_OK) { failure="設定儲存失敗，舊設定已保留。"; goto failed; }
    xSemaphoreTake(state_lock,portMAX_DELAY);
    active=*candidate; testing=false; allow_publish=true; portal_paused_sta=false;
    close_at=esp_timer_get_time()+8000000;
    xSemaphoreGive(state_lock);
    status_set("success","Wi-Fi 與 MQTT 已連線，設定已保存！8 秒後關閉設定熱點。");
    xSemaphoreGive(wifi_lock);
    return;
failed:
    if (xEventGroupGetBits(events)&CANCEL) failure="已取消測試，舊設定已保留。";
    mqtt_stop(); switch_wifi(&active,previous_connected || !ap_open);
    if (!previous_connected && ap_open) portal_paused_sta=true;
    xSemaphoreTake(state_lock,portMAX_DELAY); testing=false; xSemaphoreGive(state_lock);
    status_set("failed",failure);
    xSemaphoreGive(wifi_lock);
}

static void network_worker(void *arg)
{
    command_t command;
    for (;;) {
        if (xQueueReceive(commands,&command,pdMS_TO_TICKS(100))==pdTRUE) {
            if (command.kind==OPEN_SETUP) open_setup();
            else if (command.kind==CLOSE_SETUP) close_setup();
            else run_test(&command.settings);
            memset(&command,0,sizeof(command));
        }
        if (ap_open && !testing && ((close_at && esp_timer_get_time()>close_at) || esp_timer_get_time()>ap_expire_at)) close_setup();
        EventBits_t bits=xEventGroupGetBits(events);
        if (!testing && !client && valid_strings(&active) && (bits&WIFI_UP) && (!active.tls || (bits&CLOCK_OK))) {
            if (mqtt_start(&active)==ESP_OK) {
                xSemaphoreTake(state_lock,portMAX_DELAY); allow_publish=true; xSemaphoreGive(state_lock);
            }
        }
        if (!ap_open && network_ready() && strcmp(phase,"online")) status_set("online","Wi-Fi 與 MQTT 正常，每秒傳送原始資料。");
    }
}

static void button_worker(void *arg)
{
    gpio_config_t pin={.pin_bit_mask=1ULL<<SETUP_PIN,.mode=GPIO_MODE_INPUT,.pull_up_en=GPIO_PULLUP_ENABLE};
    ESP_ERROR_CHECK(gpio_config(&pin));
    bool released=false, fired=false;
    int64_t pressed_at=0;
    char input[16]={0}; size_t used=0;
    for (;;) {
        if (gpio_get_level(SETUP_PIN)) { released=true; pressed_at=0; fired=false; }
        else if (released && !fired) {
            if (!pressed_at) pressed_at=esp_timer_get_time();
            if (esp_timer_get_time()-pressed_at>=3000000) {
                command_t cmd={.kind=OPEN_SETUP}; xQueueSend(commands,&cmd,0); fired=true;
            }
        }
        char ch;
        while (usb_serial_jtag_read_bytes(&ch,1,0)==1) {
            if (ch=='\r' || ch=='\n') {
                if (!strcmp(input,"setup")) { command_t cmd={.kind=OPEN_SETUP}; xQueueSend(commands,&cmd,0); }
                input[0]=0; used=0;
            } else if (used<sizeof(input)-1) { input[used++]=ch; input[used]=0; }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

void network_setup_init(void)
{
    state_lock=xSemaphoreCreateMutex(); mqtt_lock=xSemaphoreCreateMutex(); wifi_lock=xSemaphoreCreateMutex();
    events=xEventGroupCreate(); commands=xQueueCreate(3,sizeof(command_t));
    assert(state_lock && mqtt_lock && wifi_lock && events && commands);
    load_settings();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    sta_netif=esp_netif_create_default_wifi_sta();
    assert(sta_netif && esp_netif_create_default_wifi_ap());
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
#if CONFIG_LWIP_SNTP_MAX_SERVERS >= 3
    esp_sntp_config_t sync=ESP_NETIF_SNTP_DEFAULT_CONFIG_MULTIPLE(3,
        ESP_SNTP_SERVER_LIST(APP_SNTP_SERVER,"time.google.com","time.cloudflare.com"));
#else
    esp_sntp_config_t sync=ESP_NETIF_SNTP_DEFAULT_CONFIG(APP_SNTP_SERVER);
#endif
    sync.start=false; sync.sync_cb=time_synced;
    ESP_ERROR_CHECK(esp_netif_sntp_init(&sync));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    reconnect_wifi=active.ssid[0]!=0;
    apply_sta_config(&active);
    ESP_ERROR_CHECK(esp_wifi_start());
    assert(xTaskCreate(network_worker,"network_setup",8192,NULL,4,NULL)==pdPASS);
    assert(xTaskCreate(button_worker,"setup_button",3072,NULL,3,NULL)==pdPASS);
    if (!valid_strings(&active)) { command_t cmd={.kind=OPEN_SETUP}; xQueueSend(commands,&cmd,0); }
    printf("NET Hold GPIO0 for 3 seconds after boot to configure; USB command: setup\n");
}
