"""Read-only MQTT 3.1.1 TLS monitor; credentials stay in ignored firmware config."""
import argparse
import json
import re
import socket
import ssl
import struct
import time
import uuid
from pathlib import Path


def mqtt_string(value):
    encoded = value.encode('utf-8')
    return struct.pack('!H', len(encoded)) + encoded


def packet(kind, body):
    remaining = len(body)
    size = bytearray()
    while True:
        digit = remaining % 128
        remaining //= 128
        size.append(digit | (128 if remaining else 0))
        if not remaining:
            break
    return bytes([kind]) + size + body


def exact(stream, count):
    data = b''
    while len(data) < count:
        block = stream.recv(count - len(data))
        if not block:
            raise ConnectionError('Broker closed connection')
        data += block
    return data


def receive(stream):
    kind = exact(stream, 1)[0]
    size = 0
    for index in range(4):
        digit = exact(stream, 1)[0]
        size += (digit & 127) * 128**index
        if size > 65536:
            raise ValueError('Oversized packet')
        if not digit & 128:
            return kind, exact(stream, size)
    raise ValueError('Invalid remaining length')


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--seconds', type=int, default=30)
    args.add_argument('--count', type=int, default=5)
    opts = args.parse_args()
    config = (Path(__file__).resolve().parents[1] / 'firmware/esp32-s3/main/app_config.h').read_text(encoding='utf-8')

    def value(name):
        match = re.search(r'^#define\s+' + name + r'\s+"([^"\r\n]*)"', config, re.M)
        if not match:
            raise ValueError('Missing config field: ' + name)
        return match[1]

    host = value('APP_MQTT_HOST')
    port = int(re.search(r'^#define\s+APP_MQTT_PORT\s+(\d+)', config, re.M)[1])
    topic = value('APP_MQTT_TOPIC')
    with socket.create_connection((host, port), timeout=15) as tcp:
        with ssl.create_default_context().wrap_socket(tcp, server_hostname=host) as stream:
            client_id = 'ntnu-monitor-' + uuid.uuid4().hex[:12]
            body = mqtt_string('MQTT') + bytes([4, 0xC2]) + struct.pack('!H', 60)
            body += mqtt_string(client_id) + mqtt_string(value('APP_MQTT_USERNAME')) + mqtt_string(value('APP_MQTT_PASSWORD'))
            stream.sendall(packet(0x10, body))
            kind, response = receive(stream)
            if kind != 0x20 or response != b'\x00\x00':
                raise RuntimeError('MQTT CONNECT rejected (credentials are not printed)')
            print('PASS: TLS certificate/hostname verified; MQTT authentication accepted', flush=True)
            stream.sendall(packet(0x82, b'\x00\x01' + mqtt_string(topic) + b'\x00'))
            kind, response = receive(stream)
            if kind != 0x90 or response != b'\x00\x01\x00':
                raise RuntimeError('Subscription not granted for ' + topic)
            print('PASS: subscribed to ' + topic, flush=True)
            deadline = time.monotonic() + opts.seconds
            count = 0
            stream.settimeout(1)
            while time.monotonic() < deadline and count < opts.count:
                try:
                    kind, body = receive(stream)
                except socket.timeout:
                    continue
                if kind >> 4 != 3:
                    continue
                topic_size = struct.unpack('!H', body[:2])[0]
                name = body[2:2+topic_size].decode('utf-8')
                if name != topic:
                    continue
                payload = json.loads(body[2+topic_size:].decode('utf-8'))
                print(json.dumps(payload, ensure_ascii=False), flush=True)
                count += 1
            stream.sendall(b'\xe0\x00')
            print(f'Received {count} messages.', flush=True)


if __name__ == '__main__':
    main()
