// Over-the-air update.
// The server leaves a retained command on "clothes/<id>/ota" (<id> = this board's MAC):
//   {"sha":"<64 hex, ELF SHA-256 of the image>","size":N,"port":P,"path":"/api/...?token=..."}
// The image is fetched with plain HTTP from the MQTT host on that port. The board reports on
// "clothes/<id>/fw": {"version","sha","state":"running"|"downloading"|"failed","progress","target","detail"}.
// A new image that cannot deliver one report before its first deep sleep is rolled back by the
// bootloader (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_app_desc.h"
#include "esp_http_client.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "nvs.h"
#include "cJSON.h"
#include "network_setup.h"
#include "ota_update.h"

#define MAX_TRIES 3      // downloads of one image before giving up on it
#define ACK_MS 1500
#define CHUNK 4096

static void hex_sha(const uint8_t *raw, char out[65])
{
    for (int i = 0; i < 32; i++) sprintf(out + i * 2, "%02x", raw[i]);
}

static void report(const char *state, const char *target, int progress, const char *detail, bool retain)
{
    const esp_app_desc_t *app = esp_app_get_description();
    char sha[65], json[320];
    hex_sha(app->app_elf_sha256, sha);
    int used = snprintf(json, sizeof(json), "{\"version\":\"%s\",\"sha\":\"%s\",\"state\":\"%s\"", app->version, sha, state);
    if (target) used += snprintf(json + used, sizeof(json) - used, ",\"target\":\"%s\",\"progress\":%d", target, progress);
    if (detail) used += snprintf(json + used, sizeof(json) - used, ",\"detail\":\"%s\"", detail);
    snprintf(json + used, sizeof(json) - used, "}");
    network_publish_to("/fw", json, retain, ACK_MS);
}

// Forget the retry count once the server has withdrawn the command, so a later rollout of the
// same image starts fresh. Writes flash only if there is something to erase.
static void forget_tries(void)
{
    nvs_handle_t nvs;
    uint8_t tries;
    if (nvs_open("ota", NVS_READWRITE, &nvs) != ESP_OK) return;
    if (nvs_get_u8(nvs, "tries", &tries) == ESP_OK) { nvs_erase_all(nvs); nvs_commit(nvs); }
    nvs_close(nvs);
}

// How many times this image has been tried; kept in NVS because a rollback restarts the board.
static uint8_t tries_for(const char *sha, bool add)
{
    nvs_handle_t nvs;
    char saved[17] = "";
    size_t size = sizeof(saved);
    uint8_t tries = 0;
    if (nvs_open("ota", NVS_READWRITE, &nvs) != ESP_OK) return 0;
    if (nvs_get_str(nvs, "sha", saved, &size) != ESP_OK || strncmp(saved, sha, 16)) tries = 0;
    else nvs_get_u8(nvs, "tries", &tries);
    if (add) {
        snprintf(saved, sizeof(saved), "%.16s", sha);
        nvs_set_str(nvs, "sha", saved);
        nvs_set_u8(nvs, "tries", ++tries);
        nvs_commit(nvs);
    }
    nvs_close(nvs);
    return tries;
}

static const char *download(const char *url, int size, const char *sha)
{
    const esp_partition_t *slot = esp_ota_get_next_update_partition(NULL);
    if (!slot) return "no update slot (flash the OTA partition table over USB once)";
    if (size <= 0 || size > (int)slot->size) return "image does not fit the update slot";
    esp_http_client_config_t config = { .url = url, .timeout_ms = 10000, .buffer_size = CHUNK };
    esp_http_client_handle_t http = esp_http_client_init(&config);
    if (!http) return "out of memory";
    const char *error = NULL;
    esp_ota_handle_t ota = 0;
    char *buffer = malloc(CHUNK);
    int total = 0, shown = 0;
    if (!buffer) error = "out of memory";
    else if (esp_http_client_open(http, 0) != ESP_OK) error = "cannot reach the server";
    else if (esp_http_client_fetch_headers(http) < 0 || esp_http_client_get_status_code(http) != 200) error = "server refused the download";
    else if (esp_ota_begin(slot, OTA_WITH_SEQUENTIAL_WRITES, &ota) != ESP_OK) error = "cannot open the update slot";
    while (!error) {
        int got = esp_http_client_read(http, buffer, CHUNK);
        if (got < 0) { error = "download interrupted"; break; }
        if (got == 0) {
            if (esp_http_client_is_complete_data_received(http)) break;
            error = "download interrupted"; break;
        }
        if (total + got > size || esp_ota_write(ota, buffer, got) != ESP_OK) { error = "cannot write the image"; break; }
        total += got;
        int percent = (int)((int64_t)total * 100 / size);
        if (percent >= shown + 20) {
            shown = percent - percent % 20;
            printf("OTA %d%%\n", shown);
            report("downloading", sha, shown < 95 ? shown : 95, NULL, false);
        }
    }
    free(buffer);
    esp_http_client_close(http);
    esp_http_client_cleanup(http);
    if (!error && total != size) error = "download incomplete";
    if (error) { if (ota) esp_ota_abort(ota); return error; }
    if (esp_ota_end(ota) != ESP_OK) return "image failed verification";  // checks the image's own SHA-256
    esp_app_desc_t fresh;
    char fresh_sha[65];
    if (esp_ota_get_partition_description(slot, &fresh) != ESP_OK) return "image failed verification";
    hex_sha(fresh.app_elf_sha256, fresh_sha);
    if (strcmp(fresh_sha, sha)) return "image is not the one requested";
    if (esp_ota_set_boot_partition(slot) != ESP_OK) return "cannot switch to the new image";
    return NULL;
}

static void check_command(void)
{
    char command[400], sha[65], mine[65], url[400];
    int found = network_ota_command(command, sizeof(command), 1000);
    if (found == 0) forget_tries();
    if (found <= 0) return;
    cJSON *json = cJSON_Parse(command);
    cJSON *sha_item = cJSON_GetObjectItem(json, "sha"), *path = cJSON_GetObjectItem(json, "path");
    cJSON *host_item = cJSON_GetObjectItem(json, "host");
    cJSON *port = cJSON_GetObjectItem(json, "port"), *size = cJSON_GetObjectItem(json, "size");
    const char *host = cJSON_IsString(host_item) ? host_item->valuestring : network_host();
    size_t host_len = strlen(host);
    bool valid_host = host_len > 0 && host_len <= 128;
    for (size_t i = 0; valid_host && i < host_len; i++) {
        char ch = host[i];
        valid_host = (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
                     (ch >= '0' && ch <= '9') || ch == '.' || ch == '-';
    }
    bool ok = cJSON_IsString(sha_item) && strlen(sha_item->valuestring) == 64 && cJSON_IsString(path) &&
              path->valuestring[0] == '/' && cJSON_IsNumber(port) && cJSON_IsNumber(size) && valid_host;
    int bytes = ok ? size->valueint : 0;
    if (ok) {
        snprintf(sha, sizeof(sha), "%s", sha_item->valuestring);
        ok = snprintf(url, sizeof(url), "http://%s:%d%s", host, port->valueint, path->valuestring) < (int)sizeof(url);
    }
    cJSON_Delete(json);
    if (!ok) { printf("OTA command ignored (malformed)\n"); return; }
    hex_sha(esp_app_get_description()->app_elf_sha256, mine);
    if (!strcmp(sha, mine)) { report("running", NULL, 0, NULL, true); return; }  // lets the server close the job
    if (tries_for(sha, false) >= MAX_TRIES) return;  // already reported as failed
    uint8_t attempt = tries_for(sha, true);
    printf("OTA update to %.12s (attempt %u of %d, %d bytes)\n", sha, attempt, MAX_TRIES, bytes);
    report("downloading", sha, 0, NULL, false);
    const char *error = download(url, bytes, sha);
    if (!error) {
        printf("OTA image written, restarting into it\n");
        report("downloading", sha, 100, NULL, false);
        network_prepare_sleep();  // clean MQTT/Wi-Fi shutdown
        esp_restart();
    }
    printf("OTA failed: %s\n", error);
    if (attempt >= MAX_TRIES) report("failed", sha, 0, error, false);
}

void ota_after_report(bool cold_boot)
{
    static bool announced;
    if (cold_boot && !announced) {
        announced = true;
        // This image booted, joined the network and delivered a report: keep it.
        esp_ota_mark_app_valid_cancel_rollback();
        report("running", NULL, 0, NULL, true);
        const esp_app_desc_t *app = esp_app_get_description();
        printf("OTA running version %s\n", app->version);
    }
    check_command();
}
