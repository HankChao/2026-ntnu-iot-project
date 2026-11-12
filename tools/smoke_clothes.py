"""Exercise the actual MQTT -> PostgreSQL -> HTTP path for clothes/raw on a TEST stack.

Run after docker compose up -d --build, with no real sensor publishing.
Creates test records and (with local_stack) restarts the app to check persistence.
No data is deleted. Server URL, broker and credentials come from tools/config.json.
"""
import json
import subprocess
import time
from datetime import datetime, timedelta, timezone

from smoke_common import api, load_config, publish, wait_for

config = load_config()
TOPIC = config['topics']['clothes']


def latest():
    return api(config, 'clothes/latest')


wait_for(lambda: latest()['mqtt_connected'])
before = latest()['data']
before_id = before['id'] if before else None
# Remote servers may have a slightly different clock than this machine.
started = datetime.now(timezone.utc) - timedelta(seconds=0 if config['local_stack'] else 30)
expected = {'hx711_raw': -12345, 'ads1115_raw': 0, 'touch_raw': 31875}
publish(config, TOPIC, json.dumps(expected))
row = wait_for(lambda: (r if (r := latest()['data']) and r['id'] != before_id else None))
assert all(row[key] == value for key, value in expected.items()), row
received = datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))
assert started <= received <= datetime.now(timezone.utc) + timedelta(seconds=30), row
print('PASS: raw values and server receive timestamp persisted')

publish(config, TOPIC, '{"hx711_raw":"bad","ads1115_raw":0,"touch_raw":1}')
time.sleep(1)
assert latest()['data']['id'] == row['id']
print('PASS: malformed payload rejected')

publish(config, TOPIC, '{"hx711_raw":null,"ads1115_raw":7799,"touch_raw":null}')
null_row = wait_for(lambda: (r if (r := latest()['data']) and r['id'] != row['id'] else None))
assert null_row['hx711_raw'] is None and null_row['touch_raw'] is None
history = api(config, 'clothes/history')
assert any(r['id'] == row['id'] for r in history['records'])
assert any(r['id'] == null_row['id'] for r in history['records'])
limited = api(config, 'clothes/history?limit=1')
assert len(limited['records']) == 1 and limited['truncated']
assert limited['records'][0]['id'] == null_row['id']
print('PASS: null retained, history and limit correct')

if config['local_stack']:
    subprocess.run(['docker', 'compose', 'restart', 'app'], check=True, capture_output=True)
    wait_for(lambda: latest()['mqtt_connected'])
    assert latest()['data']['id'] == null_row['id']
    print('PASS: app restart preserves PostgreSQL readings')
else:
    print('SKIP: app restart check (local_stack is false)')

wait_for(lambda: latest()['stale'], seconds=15)
print('PASS: stale after ten seconds without a new measurement')
print('All clothes checks passed (test readings remain in this database).')
