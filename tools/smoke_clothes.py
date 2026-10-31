"""Exercise the actual MQTT -> PostgreSQL -> HTTP path on a LOCAL TEST stack.

Run after docker compose up -d --build, with no real sensor publishing.
Creates test records and restarts the app to check persistence. No data is deleted.
"""
import json
import os
import subprocess
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = os.environ.get('TEST_BASE_URL', 'http://localhost:8088')
TOPIC = os.environ.get('CLOTHES_MQTT_TOPIC', 'clothes/raw')


def api(path):
    with urllib.request.urlopen(BASE + '/api/v1/clothes/' + path, timeout=8) as response:
        return json.load(response)


def publish(payload):
    subprocess.run(['docker', 'compose', 'exec', '-T', 'mosquitto', 'sh', '-c',
                    'mosquitto_pub -h localhost -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" -t "$1" -s',
                    'smoke', TOPIC], input=payload, text=True, check=True, capture_output=True)


def wait_for(predicate, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(0.3)
    raise AssertionError('Timed out waiting for expected state')


wait_for(lambda: api('latest')['mqtt_connected'])
before = api('latest')['data']
before_id = before['id'] if before else None
started = datetime.now(timezone.utc)
expected = {'hx711_raw': -12345, 'ads1115_raw': 0, 'touch_raw': 31875}
publish(json.dumps(expected))
row = wait_for(lambda: (r if (r := api('latest')['data']) and r['id'] != before_id else None))
assert all(row[key] == value for key, value in expected.items()), row
received = datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))
assert started <= received <= datetime.now(timezone.utc), row
print('PASS: raw values and server receive timestamp persisted')

publish('{"hx711_raw":"bad","ads1115_raw":0,"touch_raw":1}')
time.sleep(1)
assert api('latest')['data']['id'] == row['id']
print('PASS: malformed payload rejected')

publish('{"hx711_raw":null,"ads1115_raw":7799,"touch_raw":null}')
null_row = wait_for(lambda: (r if (r := api('latest')['data']) and r['id'] != row['id'] else None))
assert null_row['hx711_raw'] is None and null_row['touch_raw'] is None
history = api('history')
assert any(r['id'] == row['id'] for r in history['records'])
assert any(r['id'] == null_row['id'] for r in history['records'])
limited = api('history?limit=1')
assert len(limited['records']) == 1 and limited['truncated']
assert limited['records'][0]['id'] == null_row['id']
print('PASS: null retained, history and limit correct')

subprocess.run(['docker', 'compose', 'restart', 'app'], check=True, capture_output=True)
wait_for(lambda: api('latest')['mqtt_connected'])
assert api('latest')['data']['id'] == null_row['id']
print('PASS: app restart preserves PostgreSQL readings')

wait_for(lambda: api('latest')['stale'], seconds=15)
print('PASS: stale after ten seconds without a new measurement')
print('All integration checks passed (test readings remain in this local database).')
