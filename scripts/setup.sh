#!/usr/bin/env bash
# MQTT / .env setup helper. See docs/MQTT.md for the full guide.
# The same script is used in MAPS-server and its forks: it detects whether the
# broker reads a committed passwd file (mosquitto/passwd) or generates one at
# start-up (mosquitto/start.sh), and whether ESP32 firmware lives in the repo.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
ENV_EXAMPLE=".env.example"
CERT_DIR="mosquitto/certs"
TLS_CONF="mosquitto/conf.d/tls.conf"
MOSQUITTO_IMAGE="eclipse-mosquitto:2"

if [ -f mosquitto/start.sh ]; then PASSWD_MODE="generated"; else PASSWD_MODE="file"; fi
if [ -d firmware ]; then HAS_ESP32=1; else HAS_ESP32=0; fi
# Firmware with APP_MQTT_TLS verifies the broker against public CAs + hostname only.
ESP32_CONFIG_EXAMPLE="firmware/esp32-s3/main/app_config.example.h"
if [ "$HAS_ESP32" = 1 ] && grep -q 'APP_MQTT_TLS' "$ESP32_CONFIG_EXAMPLE" 2>/dev/null; then ESP32_TLS=1; else ESP32_TLS=0; fi

usage() {
  cat <<'EOF'
Usage:
  scripts/setup.sh [init] [--mqtt-password PW] [--rotate-mqtt]
      Create .env (or fill missing values), generate secrets, sync the
      MQTT password file, then print what to put on each device.
  scripts/setup.sh show
      Print the MQTT settings for MAPS boxes (and ESP32) from the current .env.
  scripts/setup.sh tls --self-signed --host HOST[,HOST...] [--keep-lan-plain|--no-lan-plain]
  scripts/setup.sh tls --cert FULLCHAIN.pem --key PRIVKEY.pem [--ca CA.pem] [--host HOST] [...]
  scripts/setup.sh tls --disable
      Enable / disable the TLS listener on 8883.
  scripts/setup.sh check [--watch SECONDS]
      Verify the broker accepts the .env credentials, show auth failures
      from the broker log, and optionally print live MAPS/# and clothes/# traffic.
EOF
}

info() { printf '\033[32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- .env helpers
env_has() { [ -f "$ENV_FILE" ] && grep -qE "^$1=" "$ENV_FILE"; }

env_get() {
  [ -f "$ENV_FILE" ] || return 0
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# env_set KEY VALUE: replace the KEY line in place, or append it.
env_set() {
  local tmp
  tmp="$(mktemp)"
  K="$1" V="$2" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
    index($0, k "=") == 1 { if (!done) { print k "=" v; done = 1 } ; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

random_secret() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-24}" || true
}

# Characters that break docker compose interpolation, YAML or C strings.
validate_password() {
  case "$1" in
    "") die "Password must not be empty." ;;
    *[[:space:]\$\"\'\`\\\#]*) die "Password must not contain spaces or any of: \$ \" ' \` \\ #" ;;
  esac
}

lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  echo "${ip:-<this-computer-LAN-IP>}"
}

compose() { docker compose "$@"; }

default_user() {
  local u
  u="$({ grep -E '^MQTT_USERNAME=' "$ENV_EXAMPLE" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-)"
  echo "${u:-maps}"
}

# ------------------------------------------------------------ passwd (server)
write_passwd_file() {
  [ "$PASSWD_MODE" = "file" ] || return 0
  command -v docker >/dev/null 2>&1 || die "docker is required to generate mosquitto/passwd"
  local user pass tmp
  user="$(env_get MQTT_USERNAME)"; user="${user:-$(default_user)}"
  pass="$(env_get MQTT_PASSWORD)"
  tmp="$(mktemp)"
  MQTT_U="$user" MQTT_P="$pass" docker run --rm -e MQTT_U -e MQTT_P --entrypoint sh "$MOSQUITTO_IMAGE" -c \
    'mosquitto_passwd -b -c /tmp/passwd "$MQTT_U" "$MQTT_P" >/dev/null && cat /tmp/passwd' >"$tmp" \
    || { rm -f "$tmp"; die "mosquitto_passwd failed"; }
  mv "$tmp" mosquitto/passwd
  chmod 644 mosquitto/passwd
  info "Regenerated mosquitto/passwd for user '$user'"
}

# ----------------------------------------------------------------------- init
cmd_init() {
  local mqtt_pw="" rotate=0 created=0 mqtt_changed=0 explicit=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --mqtt-password) mqtt_pw="${2:-}"; explicit=1; shift 2 ;;
      --rotate-mqtt) rotate=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option for init: $1" ;;
    esac
  done

  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ENV_EXAMPLE" ] || die "$ENV_EXAMPLE not found"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    created=1
    info "Created .env from .env.example"
  else
    # Never overwrite existing values; only add keys the example has and .env lacks.
    local key line
    while IFS= read -r line; do
      case "$line" in ''|\#*) continue ;; esac
      key="${line%%=*}"
      if ! env_has "$key"; then
        printf '%s\n' "$line" >>"$ENV_FILE"
        info "Added missing $key to .env"
      fi
    done <"$ENV_EXAMPLE"
  fi

  # MQTT password: explicit value > rotate > keep existing > prompt/random.
  local current
  current="$(env_get MQTT_PASSWORD)"
  if [ -n "$mqtt_pw" ]; then
    validate_password "$mqtt_pw"
  elif [ "$rotate" = 1 ] || [ -z "$current" ] || { [ "$created" = 1 ] && [ "$current" = "iisnrl" ]; }; then
    if [ -t 0 ]; then
      read -r -p "MQTT password for user '$(env_get MQTT_USERNAME)' (Enter = random): " mqtt_pw
    fi
    if [ -n "$mqtt_pw" ]; then validate_password "$mqtt_pw"; else mqtt_pw="$(random_secret 20)"; fi
  fi
  if [ -n "$mqtt_pw" ] && [ "$mqtt_pw" != "$current" ]; then
    env_set MQTT_PASSWORD "$mqtt_pw"
    mqtt_changed=1
    info "MQTT_PASSWORD set"
  fi

  if [ "$created" = 1 ]; then
    local s
    s="$(env_get SESSION_SECRET)"
    if [ -z "$s" ] || [ "$s" = "maps6_super_secret_session_key" ]; then
      env_set SESSION_SECRET "$(random_secret 40)"
      info "SESSION_SECRET generated"
    fi
    # Only on a fresh .env: the password is baked into the postgres volume on first start.
    local pg_old pg_new url
    pg_old="$(env_get POSTGRES_PASSWORD)"
    if [ -z "$pg_old" ] || [ "$pg_old" = "maps6_secret" ]; then
      pg_new="$(random_secret 24)"
      env_set POSTGRES_PASSWORD "$pg_new"
      url="$(env_get DATABASE_URL)"
      if [ -n "$url" ] && [ -n "$pg_old" ]; then
        env_set DATABASE_URL "${url/:$pg_old@/:$pg_new@}"
      fi
      info "POSTGRES_PASSWORD generated (only applies before the postgres volume is first created)"
    fi
  else
    if [ "$(env_get POSTGRES_PASSWORD)" = "maps6_secret" ]; then
      warn "POSTGRES_PASSWORD is still the example default. Changing it now does not change an existing database volume."
    fi
  fi

  if [ "$PASSWD_MODE" = "file" ] && { [ "$mqtt_changed" = 1 ] || [ "$explicit" = 1 ] || [ ! -s mosquitto/passwd ]; }; then
    write_passwd_file
  fi

  cmd_show
  echo
  if [ "$mqtt_changed" = 1 ] || [ "$created" = 1 ]; then
    info "Apply with: docker compose up -d --force-recreate mosquitto app"
    if [ "$mqtt_changed" = 1 ] && [ "$created" = 0 ]; then
      warn "The MQTT password changed: update every device (MAPS boxes, ESP32) with the new value."
    fi
  fi
}

# ----------------------------------------------------------------------- show
tls_enabled() { [ -f "$TLS_CONF" ]; }
tls_has_ca() { tls_enabled && grep -q '^cafile' "$TLS_CONF"; }

cmd_show() {
  [ -f "$ENV_FILE" ] || die ".env not found. Run scripts/setup.sh first."
  local user pass port tls_port web_port ip plain_bind tls_host topic
  user="$(env_get MQTT_USERNAME)"; user="${user:-$(default_user)}"
  pass="$(env_get MQTT_PASSWORD)"
  port="$(env_get MQTT_PORT)"; port="${port:-1883}"
  tls_port="$(env_get MQTT_TLS_PORT)"; tls_port="${tls_port:-8883}"
  web_port="$(env_get WEB_PORT)"
  [ -n "$web_port" ] || { [ "$HAS_ESP32" = 1 ] && web_port=8088 || web_port=8080; }
  plain_bind="$(env_get MQTT_PLAIN_BIND)"; plain_bind="${plain_bind:-0.0.0.0}"
  tls_host="$(env_get MQTT_TLS_HOST)"
  topic="$(env_get CLOTHES_MQTT_TOPIC)"; topic="${topic:-clothes/raw}"
  ip="$(lan_ip)"

  echo
  info "MAPS box: /home/pi/maps6/maps6.yaml  (then: sudo systemctl restart maps6d)"
  if tls_enabled; then
    local broker="${tls_host:-$ip}"
    cat <<EOF
upload:
  mqtt:
    broker: "${broker}"
    port: ${tls_port}
    username: "${user}"
    password: "${pass}"
    topic_prefix: "MAPS"
    use_tls: true
EOF
    if tls_has_ca; then
      echo "    ca_file: \"/home/pi/maps6/mqtt-ca.crt\"   # copy ${CERT_DIR}/ca.crt here"
    else
      echo "    ca_file: \"\"                            # public CA (e.g. Let's Encrypt)"
    fi
  else
    cat <<EOF
upload:
  mqtt:
    broker: "${ip}"
    port: ${port}
    username: "${user}"
    password: "${pass}"
    topic_prefix: "MAPS"
    use_tls: false
EOF
  fi
  echo "    server_url: \"http://${ip}:${web_port}\"   # must be reachable from the box"

  if tls_has_ca; then
    echo
    info "Copy the CA to each box:  scp ${CERT_DIR}/ca.crt pi@<BOX_IP>:/home/pi/maps6/mqtt-ca.crt"
  fi

  if [ "$HAS_ESP32" = 1 ]; then
    echo
    if [ "$ESP32_TLS" = 1 ] && tls_enabled && ! tls_has_ca; then
      info "ESP32: firmware/esp32-s3/main/app_config.h or the phone setup page (TLS)"
      cat <<EOF
#define APP_MQTT_HOST       "${tls_host:-<domain on the certificate>}"
#define APP_MQTT_PORT       ${tls_port}
#define APP_MQTT_TLS        1
#define APP_MQTT_USERNAME   "${user}"
#define APP_MQTT_PASSWORD   "${pass}"
#define APP_MQTT_TOPIC      "${topic}"
EOF
    else
      info "ESP32: firmware/esp32-s3/main/app_config.h  (plain MQTT on the LAN)"
      echo "#define APP_MQTT_HOST       \"${ip}\""
      echo "#define APP_MQTT_PORT       ${port}"
      if [ "$ESP32_TLS" = 1 ]; then echo "#define APP_MQTT_TLS        0"; fi
      cat <<EOF
#define APP_MQTT_USERNAME   "${user}"
#define APP_MQTT_PASSWORD   "${pass}"
#define APP_MQTT_TOPIC      "${topic}"
EOF
      if tls_has_ca; then
        warn "The ESP32 only trusts public CAs, so it cannot use this self-signed certificate; keep it on plain MQTT in the LAN."
      elif tls_enabled; then
        warn "This firmware has no APP_MQTT_TLS support, so the ESP32 stays on plain MQTT in the LAN."
      fi
      if [ "$plain_bind" = "127.0.0.1" ]; then
        warn "MQTT_PLAIN_BIND=127.0.0.1: port ${port} is closed to the LAN, so the ESP32 cannot connect. Re-run 'scripts/setup.sh tls ... --keep-lan-plain'."
      fi
    fi
  fi
}

# ------------------------------------------------------------------------ tls
openssl_run() {
  if command -v openssl >/dev/null 2>&1; then
    (cd "$CERT_DIR" && openssl "$@")
  else
    docker run --rm -v "$ROOT/$CERT_DIR:/work" -w /work alpine/openssl "$@"
  fi
}

make_self_signed() {
  local hosts="$1" san="" h first
  first="${hosts%%,*}"
  IFS=',' read -r -a list <<<"$hosts"
  for h in "${list[@]}"; do
    h="$(echo "$h" | tr -d '[:space:]')"
    [ -n "$h" ] || continue
    if [[ "$h" =~ ^[0-9.]+$ ]] || [[ "$h" == *:* ]]; then san="${san:+$san,}IP:$h"; else san="${san:+$san,}DNS:$h"; fi
  done
  [ -n "$san" ] || die "--host is required with --self-signed"

  if [ ! -f "$CERT_DIR/ca.key" ] || [ ! -f "$CERT_DIR/ca.crt" ]; then
    openssl_run req -x509 -new -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
      -subj "/CN=MAPS MQTT CA" >/dev/null 2>&1 || die "Failed to create CA"
    info "Created CA ${CERT_DIR}/ca.crt (keep ca.key private)"
  else
    info "Reusing existing CA ${CERT_DIR}/ca.crt"
  fi
  printf 'subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$san" >"$CERT_DIR/server.ext"
  openssl_run req -new -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$first" >/dev/null 2>&1 \
    || die "Failed to create server key"
  openssl_run x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 \
    -extfile server.ext >/dev/null 2>&1 || die "Failed to sign server certificate"
  rm -f "$CERT_DIR/server.csr" "$CERT_DIR/server.ext" "$CERT_DIR/ca.srl"
  info "Issued ${CERT_DIR}/server.crt for: $san"
}

cmd_tls() {
  local mode="" hosts="" cert="" key="" ca="" keep_plain=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --self-signed) mode="self"; shift ;;
      --cert) mode="${mode:-files}"; cert="${2:-}"; shift 2 ;;
      --key) key="${2:-}"; shift 2 ;;
      --ca) ca="${2:-}"; shift 2 ;;
      --host) hosts="${2:-}"; shift 2 ;;
      --keep-lan-plain) keep_plain=1; shift ;;
      --no-lan-plain) keep_plain=0; shift ;;
      --disable) mode="disable"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option for tls: $1" ;;
    esac
  done
  [ -f "$ENV_FILE" ] || die ".env not found. Run scripts/setup.sh first."
  mkdir -p "$CERT_DIR" mosquitto/conf.d
  # The ESP32 needs plain MQTT on the LAN unless its firmware can verify this certificate.
  if [ -z "$keep_plain" ]; then
    if [ "$HAS_ESP32" = 1 ] && { [ "$mode" = "self" ] || [ -n "$ca" ] || [ "$ESP32_TLS" = 0 ]; }; then
      keep_plain=1
    else
      keep_plain=0
    fi
  fi

  case "$mode" in
    disable)
      rm -f "$TLS_CONF"
      env_set MQTT_PLAIN_BIND 0.0.0.0
      info "TLS listener disabled; MQTT port $(env_get MQTT_PORT | grep . || echo 1883) is open to the LAN again."
      info "Apply with: docker compose up -d --force-recreate mosquitto"
      return
      ;;
    self)
      make_self_signed "$hosts"
      ;;
    files)
      [ -f "$cert" ] && [ -f "$key" ] || die "--cert and --key must point to existing files"
      cp "$cert" "$CERT_DIR/server.crt"
      cp "$key" "$CERT_DIR/server.key"
      if [ -n "$ca" ]; then cp "$ca" "$CERT_DIR/ca.crt"; else rm -f "$CERT_DIR/ca.crt"; fi
      info "Installed certificate into ${CERT_DIR}/"
      ;;
    *) usage; exit 1 ;;
  esac

  # The broker drops root before loading certificates, so they must be world-readable.
  chmod 644 "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
  if [ -f "$CERT_DIR/ca.crt" ]; then chmod 644 "$CERT_DIR/ca.crt"; fi
  if [ -f "$CERT_DIR/ca.key" ]; then chmod 600 "$CERT_DIR/ca.key"; fi

  {
    echo "# Generated by scripts/setup.sh tls. Delete this file to disable TLS."
    echo "listener 8883"
    if [ "$mode" = "self" ] || [ -n "$ca" ]; then echo "cafile /mosquitto/certs/ca.crt"; fi
    echo "certfile /mosquitto/certs/server.crt"
    echo "keyfile /mosquitto/certs/server.key"
  } >"$TLS_CONF"

  if [ -n "$hosts" ]; then env_set MQTT_TLS_HOST "${hosts%%,*}"; fi
  if [ "$keep_plain" = 1 ]; then
    env_set MQTT_PLAIN_BIND 0.0.0.0
    info "Plain MQTT stays open on the LAN (forward only port 8883 on the router)."
  else
    env_set MQTT_PLAIN_BIND 127.0.0.1
    info "Plain MQTT now only listens on 127.0.0.1; devices must use TLS on 8883."
  fi

  cmd_show
  echo
  info "Apply with: docker compose up -d --force-recreate mosquitto"
}

# ---------------------------------------------------------------------- check
cmd_check() {
  local watch=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --watch) watch="${2:-15}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option for check: $1" ;;
    esac
  done
  [ -f "$ENV_FILE" ] || die ".env not found. Run scripts/setup.sh first."
  local user pass ok=1
  user="$(env_get MQTT_USERNAME)"; user="${user:-$(default_user)}"
  pass="$(env_get MQTT_PASSWORD)"

  compose ps --status running --services 2>/dev/null | grep -qx mosquitto \
    || die "The mosquitto container is not running (docker compose up -d)."

  if compose exec -T -e MQTT_U="$user" -e MQTT_P="$pass" mosquitto sh -c \
      'mosquitto_sub -h localhost -p 1883 -u "$MQTT_U" -P "$MQTT_P" -t "\$SYS/broker/version" -C 1 -W 5' >/dev/null 2>&1; then
    info "Plain listener (1883): login as '$user' OK"
  else
    if [ "$PASSWD_MODE" = "file" ]; then
      warn "Plain listener (1883): login as '$user' FAILED. mosquitto/passwd does not match .env; run 'scripts/setup.sh --mqtt-password <current .env password>' and recreate mosquitto."
    else
      warn "Plain listener (1883): login as '$user' FAILED. Recreate the containers so the broker picks up .env: docker compose up -d --force-recreate mosquitto app"
    fi
    ok=0
  fi

  if tls_enabled; then
    local tls_args="--insecure"
    tls_has_ca && tls_args="--cafile /mosquitto/certs/ca.crt --insecure"
    if tls_has_ca && compose exec -T -e MQTT_U="$user" -e MQTT_P="$pass" mosquitto sh -c \
        "mosquitto_sub -h localhost -p 8883 $tls_args -u \"\$MQTT_U\" -P \"\$MQTT_P\" -t '\$SYS/broker/version' -C 1 -W 5" >/dev/null 2>&1; then
      info "TLS listener (8883): handshake and login OK"
    elif tls_has_ca; then
      warn "TLS listener (8883): connection FAILED (see: docker compose logs mosquitto)"
      ok=0
    else
      info "TLS listener (8883): enabled (public CA, not tested from inside the container)"
    fi
    if command -v openssl >/dev/null 2>&1; then
      info "Server certificate $(openssl x509 -in "$CERT_DIR/server.crt" -noout -enddate)"
    fi
  fi

  local denied
  denied="$(compose logs --since 24h mosquitto 2>/dev/null | grep -iE 'not authori[sz]ed|bad user name or password' | tail -n 5 || true)"
  if [ -n "$denied" ]; then
    warn "Rejected logins in the last 24h (device uses a different username/password):"
    echo "$denied"
  else
    info "No rejected logins in the broker log (last 24h)"
  fi

  if [ "$watch" != 0 ]; then
    info "Listening on MAPS/# and clothes/# for ${watch}s ..."
    compose exec -T -e MQTT_U="$user" -e MQTT_P="$pass" -e W="$watch" mosquitto sh -c \
      'mosquitto_sub -h localhost -p 1883 -u "$MQTT_U" -P "$MQTT_P" -t "MAPS/#" -t "clothes/#" -v -W "$W"' || true
  fi
  [ "$ok" = 1 ]
}

# ----------------------------------------------------------------------- main
cmd="${1:-init}"
case "$cmd" in
  init) shift || true; cmd_init "$@" ;;
  show) shift; cmd_show ;;
  tls) shift; cmd_tls "$@" ;;
  check) shift; cmd_check "$@" ;;
  -h|--help|help) usage ;;
  --*) cmd_init "$@" ;;
  *) usage; exit 1 ;;
esac
