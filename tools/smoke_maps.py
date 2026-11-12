"""Exercise the MAPS box MQTT topics -> PostgreSQL -> HTTP path on a TEST stack.

Simulates one box (maps_test_device in tools/config.json, default SMOKE-TEST-01)
publishing MAPS/<id>/online, status and sensor, then checks the device API.
Messages are not retained. The test device and its readings remain in the database.
"""
import json
import time
from datetime import datetime, timezone

from smoke_common import api, load_config, publish, wait_for

config = load_config()
DEVICE = config['maps_test_device']
PREFIX = config['topics']['maps_prefix'] + '/' + DEVICE


def now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def device():
    return api(config, 'devices/' + DEVICE)['device']


wait_for(lambda: api(config, 'system/health'))

# A real box announces itself before sending data; sensor rows need the device row.
publish(config, PREFIX + '/online', json.dumps({'online': True, 'timestamp': now()}))
wait_for(lambda: device()['online'] is True)
print('PASS: ' + PREFIX + '/online registered the device as online')

status = {
    'device_id': DEVICE, 'app': 'MAPS6', 'version': 'smoke-test', 'timestamp': now(),
    'uptime_sec': 42, 'network': {'ip': '192.0.2.10', 'type': 'wifi'},
    'mcu_firmware': 'smoke', 'modules': {'mqtt': True},
}
publish(config, PREFIX + '/status', json.dumps(status))
wait_for(lambda: device()['version'] == 'smoke-test')
print('PASS: ' + PREFIX + '/status updated the device record')

sent_at = now()
sensor = {'temp': 25.5, 'humi': 61.2, 'co2': 456, 'pm25_ae': 9, 'pm10_ae': 14}
publish(config, PREFIX + '/sensor', json.dumps({
    'device_id': DEVICE, 'app': 'MAPS6', 'version': 'smoke-test', 'timestamp': sent_at, 'sensor': sensor,
}))


def stored_reading():
    row = api(config, 'devices/' + DEVICE + '/sensor/latest')['data']
    stamp = datetime.fromisoformat(str(row['timestamp']).replace('Z', '+00:00'))
    return row if stamp == datetime.fromisoformat(sent_at.replace('Z', '+00:00')) else None


row = wait_for(stored_reading)
assert all(abs(float(row[key]) - value) < 0.01 for key, value in sensor.items()), row
print('PASS: ' + PREFIX + '/sensor persisted and readable via /devices/:id/sensor/latest')

publish(config, PREFIX + '/sensor', '{not json')
time.sleep(1)
assert api(config, 'system/health'), 'server unhealthy after malformed payload'
print('PASS: malformed sensor payload ignored')

publish(config, PREFIX + '/online', json.dumps({'online': False, 'timestamp': now()}))
wait_for(lambda: device()['online'] is False)
print('PASS: online=false marks the device offline')
print('All MAPS checks passed (device ' + DEVICE + ' remains in this database).')
