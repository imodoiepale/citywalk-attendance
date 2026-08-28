#!/usr/bin/env bash
#
# Provision one client's gateway on this host.
#
#   ./deploy/install.sh --client acme \
#       --supabase-url https://xxxx.supabase.co \
#       --hostname gateway.acme.example.com \
#       --serial ENS2025079 --branch hq
#
# Renders .env, devices.yaml and destinations.yaml into deploy/clients/<slug>/,
# picks host ports that do not collide with clients already installed here, and
# brings the stack up under its own Compose project.
#
# Deliberately NOT a `curl … | bash` one-liner. This writes a service-role key
# and a biometric encryption key to disk and starts a container; piping a remote
# script into a root shell to save one step is not a trade worth making.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENTS_DIR="$HERE/clients"

CLIENT=""
SUPABASE_URL=""
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
HOSTNAME_ARG=""
TZ_ARG="Africa/Nairobi"
SERIALS=()
BRANCH="hq"
VENDOR="fkweb"
START=1

die() { printf '\nerror: %s\n\n' "$1" >&2; exit 1; }
note() { printf '  %s\n' "$1"; }

usage() {
  # The header comment block, minus the shebang, up to the first line of code.
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
  cat <<'EOF'
Options
  --client SLUG           Required. Lowercase name; identifies the stack and its volumes.
  --supabase-url URL      Required. The client's Supabase project URL.
  --supabase-key KEY      Service-role key. Falls back to $SUPABASE_SERVICE_ROLE_KEY.
                          Prefer the environment variable so it stays out of shell history.
  --hostname HOST         Public hostname for the HTTP/WebSocket side, via Traefik.
  --serial SERIAL         Device serial. Repeatable.
  --branch NAME           Branch tag for the devices listed. Default: hq
  --vendor NAME           Device family: fkweb | cloud | zkteco | ebkn | cams. Default: fkweb
  --tz ZONE               IANA timezone. Default: Africa/Nairobi
  --no-start              Render the files but do not run docker compose.
  -h, --help              This message.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --client)       CLIENT="${2:-}"; shift 2 ;;
    --supabase-url) SUPABASE_URL="${2:-}"; shift 2 ;;
    --supabase-key) SUPABASE_KEY="${2:-}"; shift 2 ;;
    --hostname)     HOSTNAME_ARG="${2:-}"; shift 2 ;;
    --serial)       SERIALS+=("${2:-}"); shift 2 ;;
    --branch)       BRANCH="${2:-}"; shift 2 ;;
    --vendor)       VENDOR="${2:-}"; shift 2 ;;
    --tz)           TZ_ARG="${2:-}"; shift 2 ;;
    --no-start)     START=0; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

# ── validate ──────────────────────────────────────────────────────────────────

[ -n "$CLIENT" ] || die "--client is required"
printf '%s' "$CLIENT" | grep -Eq '^[a-z0-9][a-z0-9-]{0,31}$' \
  || die "--client must be lowercase letters, digits and dashes (it names volumes and containers)"

[ -n "$SUPABASE_URL" ] || die "--supabase-url is required"
printf '%s' "$SUPABASE_URL" | grep -Eq '^https://' \
  || die "--supabase-url must be https"

[ -n "$SUPABASE_KEY" ] || die \
  "no service-role key. Pass --supabase-key, or better: export SUPABASE_SERVICE_ROLE_KEY=... first"
[ "${#SUPABASE_KEY}" -ge 40 ] || die \
  "that service-role key looks too short — is it the anon key? The anon key cannot write attendance."

[ "${#SERIALS[@]}" -gt 0 ] || die "at least one --serial is required"

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is not available"

DEST="$CLIENTS_DIR/$CLIENT"
if [ -d "$DEST" ]; then
  die "$DEST already exists. Edit it and re-run 'docker compose up -d', or remove it first."
fi

# ── choose ports ──────────────────────────────────────────────────────────────
# Each client gets a slot; slot N shifts every published port by N. Existing
# client directories are counted, so installing a second client on the same VPS
# does not collide with the first.

mkdir -p "$CLIENTS_DIR"
SLOT="$(find "$CLIENTS_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

port_free() {
  # Refuse a port something is already bound to, whether or not we put it there.
  ! (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1 ") \
  && ! (command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q ":$1 ")
}

pick() {
  local base="$1" candidate
  candidate=$((base + SLOT))
  while ! port_free "$candidate"; do
    candidate=$((candidate + 1))
    [ "$candidate" -lt $((base + 200)) ] || die "no free port near $base"
  done
  printf '%s' "$candidate"
}

HTTP_PORT="$(pick 8080)"
FKWEB_PORT="$(pick 5005)"
CLOUD_PORT="$(pick 7788)"
GATEWAY_HOSTNAME="${HOSTNAME_ARG:-$CLIENT.local}"

# ── render ────────────────────────────────────────────────────────────────────

mkdir -p "$DEST"
# Before anything secret is written.
chmod 700 "$DEST"

TEMPLATE_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>/dev/null \
  || openssl rand -base64 32)"
[ -n "$TEMPLATE_KEY" ] || die "could not generate a template key (need node or openssl)"

umask 077
cat > "$DEST/.env" <<EOF
# Generated by deploy/install.sh for client "$CLIENT".
# Contains two root-equivalent secrets. Never commit this file.

CLIENT_SLUG=$CLIENT
GATEWAY_HOSTNAME=$GATEWAY_HOSTNAME

SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_KEY

# Sealed-template key. Losing this makes every stored credential unreadable and
# the estate has to be re-enrolled. Back it up somewhere you would back up a
# root password.
BIOMETRIC_TEMPLATE_KEY=$TEMPLATE_KEY
BIOMETRIC_TEMPLATE_KEYS_PREVIOUS=

GATEWAY_TCP_PORTS=5005
GATEWAY_CLOUD_PORT=7788
COMMAND_POLL_MS=2000

TZ=$TZ_ARG
LOG_LEVEL=info
STRICT_SERIALS=true
ARCHIVE_RAW=true

# Published host ports for this client.
HTTP_PORT=$HTTP_PORT
FKWEB_PORT=$FKWEB_PORT
CLOUD_PORT=$CLOUD_PORT
EOF
chmod 600 "$DEST/.env"

{
  echo "# Devices for $CLIENT. Serial must match biometric_devices.serial_no exactly."
  echo "devices:"
  for serial in "${SERIALS[@]}"; do
    cat <<EOF
  - serial: $serial
    label: $serial
    vendor: $VENDOR
    mode: listen
    port: 5005
    timezone: $TZ_ARG
    branch: $BRANCH
    direction: null
EOF
  done
} > "$DEST/devices.yaml"

cat > "$DEST/destinations.yaml" <<'EOF'
# Where scans go. Each destination gets its own durable queue, so a third-party
# endpoint being down cannot delay a punch reaching Supabase.
destinations:
  - id: supabase-primary
    type: supabase
EOF

cp "$HERE/docker-compose.client.yml" "$DEST/docker-compose.yml"

# ── launch ────────────────────────────────────────────────────────────────────

printf '\nProvisioned %s\n\n' "$CLIENT"
note "directory      $DEST"
note "http/ws        $HTTP_PORT  (Traefik → $GATEWAY_HOSTNAME)"
note "fkweb tcp      $FKWEB_PORT"
note "cloud tcp      $CLOUD_PORT"
note "devices        ${SERIALS[*]}"
printf '\n'

if [ "$START" -eq 0 ]; then
  note "not started (--no-start). Run: cd $DEST && docker compose up -d --build"
  exit 0
fi

( cd "$DEST" && docker compose -p "$CLIENT" up -d --build )

printf '\nNext:\n'
note "1. Apply the migrations to $SUPABASE_URL (supabase/migrations/, in order)."
note "2. Open inbound TCP $FKWEB_PORT and $CLOUD_PORT in the host and cloud firewalls."
note "3. On each terminal set the server address to this host:$FKWEB_PORT (FkWeb)"
note "   or host:$CLOUD_PORT (cloud mode, if the model offers it)."
note "4. Verify:  curl -s http://127.0.0.1:$HTTP_PORT/healthz"
note "5. Back up BIOMETRIC_TEMPLATE_KEY from $DEST/.env"
printf '\n'
