"""Shared settings and a tiny stdlib MQTT publisher for the smoke tests.

All settings come from tools/config.json (gitignored; copy tools/config.example.json).
Nothing is read from .env, so the tests can target any server.
"""
import json
import socket
import ssl
import struct
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).resolve().parent / 'config.json'
REQUIRED = [
    'base_url', 'local_stack', 'mqtt.host', 'mqtt.port', 'mqtt.tls', 'mqtt.username', 'mqtt.password',
    'topics.clothes', 'topics.maps_prefix', 'maps_test_device',
]


def load_config():
    if not CONFIG_PATH.exists():
        raise SystemExit('tools/config.json not found: copy tools/config.example.json and fill it in')
    config = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    missing = []
    for key in REQUIRED:
        value = config
        for part in key.split('.'):
            value = value.get(part) if isinstance(value, dict) else None
        if value is None or value == '':
            missing.append(key)
    if missing:
        raise SystemExit('tools/config.json is missing: ' + ', '.join(missing))
    config['base_url'] = config['base_url'].rstrip('/')
    config['mqtt'].setdefault('ca_file', '')
    return config


def api(config, path, timeout=8):
    with urllib.request.urlopen(config['base_url'] + '/api/v1/' + path, timeout=timeout) as response:
        return json.load(response)


def _mqtt_string(value):
    encoded = value.encode('utf-8')
    return struct.pack('!H', len(encoded)) + encoded


def _packet(kind, body):
    remaining, size = len(body), bytearray()
    while True:
        digit, remaining = remaining % 128, remaining // 128
        size.append(digit | (128 if remaining else 0))
        if not remaining:
            return bytes([kind]) + size + body


def _exact(stream, count):
    data = b''
    while len(data) < count:
        block = stream.recv(count - len(data))
        if not block:
            raise ConnectionError('Broker closed the connection')
        data += block
    return data


def _receive(stream):
    kind = _exact(stream, 1)[0]
    size = 0
    for index in range(4):
        digit = _exact(stream, 1)[0]
        size += (digit & 127) * 128 ** index
        if not digit & 128:
            return kind, _exact(stream, size)
    raise ValueError('Invalid remaining length')


def publish(config, topic, payload, retain=False):
    """Publish one message with QoS 1 and wait for the broker's PUBACK."""
    mqtt = config['mqtt']
    tcp = socket.create_connection((mqtt['host'], int(mqtt['port'])), timeout=15)
    stream = tcp
    if mqtt['tls']:
        ca_file = mqtt.get('ca_file')
        context = ssl.create_default_context(cafile=str(ROOT / ca_file) if ca_file else None)
        stream = context.wrap_socket(tcp, server_hostname=mqtt['host'])
    try:
        body = _mqtt_string('MQTT') + bytes([4, 0xC2]) + struct.pack('!H', 30)
        body += _mqtt_string('smoke-' + uuid.uuid4().hex[:12])
        body += _mqtt_string(mqtt['username']) + _mqtt_string(mqtt['password'])
        stream.sendall(_packet(0x10, body))
        kind, response = _receive(stream)
        if kind != 0x20 or response[1:2] != b'\x00':
            raise RuntimeError('MQTT CONNECT rejected: check username/password (not printed)')
        data = payload if isinstance(payload, bytes) else payload.encode('utf-8')
        stream.sendall(_packet(0x32 | (1 if retain else 0), _mqtt_string(topic) + b'\x00\x01' + data))
        kind, response = _receive(stream)
        if kind >> 4 != 4:
            raise RuntimeError('No PUBACK for ' + topic)
        stream.sendall(b'\xe0\x00')
    finally:
        stream.close()


def wait_for(predicate, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.3)
    raise AssertionError('Timed out waiting for expected state')
