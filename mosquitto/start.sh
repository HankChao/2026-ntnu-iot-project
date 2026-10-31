#!/bin/sh
set -eu
: "${MQTT_USERNAME:?MQTT_USERNAME is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"
mosquitto_passwd -b -c /tmp/ntnu-mqtt-passwd "$MQTT_USERNAME" "$MQTT_PASSWORD"
chown mosquitto:mosquitto /tmp/ntnu-mqtt-passwd
chmod 600 /tmp/ntnu-mqtt-passwd
exec mosquitto -c /mosquitto/config/mosquitto.conf
