"""Hardware setup API checks. Temporarily joins the ESP32 AP, then restores Wi-Fi.

Run with an interpreter with pyserial (for example the ESP-IDF Python environment).
Only --mode success persists new settings. No fake MQTT telemetry is published.
"""
import argparse
import json
import re
import subprocess
import tempfile
import time
import threading
import urllib.error
import urllib.request
from pathlib import Path
from xml.sax.saxutils import escape
import serial

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = 'http://192.168.4.1'
TOKEN = ''
AP_SSID = ''


def run(*args):
    return subprocess.run(list(args), capture_output=True, text=True, errors='replace', timeout=12, check=True).stdout


def api(path, body=None, token=None, timeout=3):
    headers = {}
    if body is not None:
        headers = {'Content-Type': 'application/json', 'X-Setup-Token': TOKEN if token is None else token}
    request = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    with OPENER.open(request, timeout=timeout) as response:
        data = response.read()
        return response.status, json.loads(data) if path != '/' else data.decode()


def expect_error(path, body, code, token=None):
    try:
        api(path, body, token)
    except urllib.error.HTTPError as error:
        assert error.code == code, (path, error.code)
        return
    raise AssertionError(f'Expected HTTP {code}: {path}')


def rejoin_ap():
    # The setup AP follows the STA channel (single radio), so Windows drops off the AP
    # when the board joins a network on another channel. Rejoin like a phone would.
    current = run('netsh', 'wlan', 'show', 'interfaces')
    if not re.search(r'^\s*SSID\s*:\s*' + re.escape(AP_SSID) + r'\s*$', current, re.M):
        print('Rejoining setup AP:', run('netsh', 'wlan', 'connect', 'name=' + AP_SSID).strip(), flush=True)


def wait_status(expected, seconds):
    end = time.monotonic() + seconds
    latest = None
    last_rejoin = time.monotonic()
    while time.monotonic() < end:
        try:
            status = api('/api/status')[1]
            if status != latest:
                print('STATUS', status['phase'], status['message'], 'ip=' + status['ip'], flush=True)
            latest = status
            if latest['phase'] in expected:
                return latest
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if AP_SSID and time.monotonic() - last_rejoin > 5:
                try:
                    rejoin_ap()
                except subprocess.SubprocessError:
                    pass
                last_rejoin = time.monotonic()
        time.sleep(.5)
    raise AssertionError('Timed out; last status: ' + str(latest))


def main():
    global TOKEN, AP_SSID
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', default='COM7')
    parser.add_argument('--mode', choices=['inspect', 'cancel', 'fail', 'mqtt-fail', 'success', 'persist'], default='inspect')
    parser.add_argument('--ssid', default='Dorm2_Male')
    opts = parser.parse_args()
    interface = run('netsh', 'wlan', 'show', 'interfaces')
    profile = re.search(r'^\s*Profile\s*:\s*(.+)$', interface, re.M)
    if not profile:
        raise RuntimeError('Connect Windows to a saved Wi-Fi profile before running this test.')
    original_profile = profile[1].strip()
    info_path = Path(tempfile.gettempdir()) / 'ntnu-setup-test.json'
    info = json.loads(info_path.read_text()) if info_path.exists() else None
    port = serial.Serial(opts.port, 115200, timeout=.5)
    port.write(b'setup\n')
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        line = port.readline().decode('utf-8', errors='replace')
        match = re.search(r'SETUP SSID=(\S+) PASSWORD=(\S+)', line)
        if match:
            info = {'ssid': match[1], 'password': match[2]}
            info_path.write_text(json.dumps(info))
            break
    if not info:
        raise AssertionError('No setup AP credentials received from USB.')
    AP_SSID = info['ssid']
    print('Setup AP:', info['ssid'], '(password not printed)', flush=True)
    stopped = threading.Event()
    def drain_console():
        with (Path(__file__).resolve().parents[1] / 'firmware-setup-test.log').open('w', encoding='utf-8') as log:
            while not stopped.is_set():
                try:
                    line = port.readline().decode('utf-8', errors='replace')
                except serial.SerialException:
                    break
                log.write(line); log.flush()
    observer = threading.Thread(target=drain_console, daemon=True)
    observer.start()

    profile_xml = f'''<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
<name>{escape(info['ssid'])}</name><SSIDConfig><SSID><name>{escape(info['ssid'])}</name></SSID></SSIDConfig>
<connectionType>ESS</connectionType><connectionMode>manual</connectionMode>
<MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>{escape(info['password'])}</keyMaterial></sharedKey>
</security></MSM></WLANProfile>'''
    with tempfile.NamedTemporaryFile(suffix='.xml', delete=False, mode='w', encoding='utf-8') as temp:
        temp.write(profile_xml)
        xml_path = Path(temp.name)
    try:
        run('netsh', 'wlan', 'add', 'profile', 'filename=' + str(xml_path), 'user=current')
    finally:
        xml_path.unlink(missing_ok=True)
    try:
        print(run('netsh', 'wlan', 'connect', 'name=' + info['ssid']).strip(), flush=True)
        deadline = time.monotonic() + 25
        last_connect = time.monotonic()
        while True:
            try:
                config = api('/api/config')[1]
                break
            except (urllib.error.URLError, TimeoutError):
                if time.monotonic() > deadline:
                    print(run('netsh', 'wlan', 'show', 'interfaces'), flush=True)
                    raise
                if time.monotonic()-last_connect > 5:
                    current = run('netsh', 'wlan', 'show', 'interfaces')
                    if not re.search(r'^\s*SSID\s*:\s*' + re.escape(info['ssid']) + r'\s*$', current, re.M):
                        print(run('netsh', 'wlan', 'connect', 'name=' + info['ssid']).strip(), flush=True)
                    last_connect = time.monotonic()
                time.sleep(.5)
        TOKEN = config['token']
        assert 'wifi_password' not in config and 'mqtt_password' not in config
        assert 'password' not in config and 'ap_password' not in config
        assert '為衣夾連上網路' in api('/')[1]
        print('PASS: setup page reachable; stored secrets are not returned', flush=True)
        trial = {
            'ssid': config['ssid'], 'open': not config['wifi_password_saved'],
            'wifi_password': '', 'keep_wifi_password': config['wifi_password_saved'],
            'host': config['host'], 'port': config['port'], 'tls': config['tls'],
            'username': config['username'], 'topic': config['topic'],
            'keep_mqtt_password': True, 'mqtt_password': '',
        }
        expect_error('/api/connect', trial, 403, 'incorrect-token')
        expect_error('/api/connect', dict(trial, port=70000), 400)
        expect_error('/api/connect', dict(trial, ssid='Different-SSID', open=False, keep_wifi_password=True), 400)
        print('PASS: invalid token, invalid port and unsafe password reuse rejected', flush=True)
        if opts.mode == 'inspect':
            _, scans = api('/api/scan', timeout=15)
            assert isinstance(scans['networks'], list)
            print('PASS: Wi-Fi scan returned', len(scans['networks']), 'networks', flush=True)
        elif opts.mode in ['cancel', 'fail', 'mqtt-fail']:
            if opts.mode == 'mqtt-fail':
                trial['host'] = 'broker.invalid'
            else:
                trial.update(ssid='Clothes-Test-Not-Here', open=True, keep_wifi_password=False)
            assert api('/api/connect', trial)[0] == 202
            if opts.mode == 'cancel':
                wait_status({'testing_wifi'}, 5)
                api('/api/cancel', {})
            result = wait_status({'failed'}, 30)
            after = api('/api/config')[1]
            for key in ['ssid', 'host', 'port', 'topic', 'username', 'tls']:
                assert config[key] == after[key], key
            print('PASS:', opts.mode, 'keeps previous settings; status:', result['phase'], flush=True)
        elif opts.mode == 'success':
            trial.update(ssid=opts.ssid, open=True, keep_wifi_password=False)
            assert api('/api/connect', trial)[0] == 202
            # Firmware worst case: Wi-Fi 20 s + SNTP 30 s + MQTT 20 s.
            result = wait_status({'success', 'failed'}, 90)
            assert result['phase'] == 'success', result
            assert result['wifi_connected'] and result['mqtt_connected']
            assert api('/api/config')[1]['ssid'] == opts.ssid
            print('PASS: Wi-Fi and MQTT connected; settings committed to NVS', flush=True)
        elif opts.mode == 'persist':
            assert config['ssid'] == opts.ssid, config['ssid']
            print('PASS: saved Wi-Fi recovered after reboot:', config['ssid'], flush=True)
        if opts.mode != 'success':
            api('/api/close', {}, timeout=8)
    finally:
        # Restore connectivity even if an assertion or HTTP request fails.
        try:
            api('/api/cancel', {})
        except Exception:
            pass
        run('netsh', 'wlan', 'connect', 'name=' + original_profile)
        time.sleep(3)
        print('Restored Windows Wi-Fi profile:', original_profile, flush=True)
        stopped.set(); observer.join(2); port.close()


if __name__ == '__main__':
    main()
