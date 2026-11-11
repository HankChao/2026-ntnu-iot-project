#pragma once
#include <stdbool.h>
#include <stdint.h>

void network_setup_init(void);
bool network_ready(void);
void network_publish(const char *json, int64_t sampled_us);
