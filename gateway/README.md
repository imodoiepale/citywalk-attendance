# Citywalk biometric gateway

Receives terminal traffic on a Hostinger VPS, normalizes attendance scans,
spools them to persistent disk, and writes them to Supabase.

```text
EN-K190FTW / Cams API
        │
        │ HTTP(S), WebSocket, or raw TCP
        ▼
Hostinger VPS: Caddy → gateway → durable spool
                                  │
                                  ├─ ingest_biometric_events() → events → punches
                                  └─ sanitized raw archive → device_raw_payloads
```

The event and archive queues are independent. An archive failure cannot block
attendance, and a Supabase outage leaves scans on the VPS until it recovers.

## The two server-URL modes are different

| Mode | Where the URL is configured | URL |
|---|---|---|
| EN-K190FTW native FkWeb | On the physical terminal | `http://VPS_IP/` initially, or `https://biometric.example.com/` if that firmware supports TLS |
| Cams Web API v3 | Cams **API Monitor**, not the terminal | `https://biometric.example.com/callbacks/cams` |

The Cams documentation describes a paid cloud protocol engine. It does not
document the EN-K190FTW's native `FkWeb` protocol and does not make that device
a Cams-native device automatically. A non-Cams device needs Cams confirmation,
activation, and usually Hybrid Push/protocol support before the API Monitor
callback path can work.

This gateway supports both:

- Native FkWeb capture remains tolerant because the exact EN-K190FTW payload is
  not yet captured from a real scan.
- `/callbacks/cams` implements the documented `RealTime.PunchLog`, validates
  `AuthToken`, optionally decrypts AES-256-ECB callbacks, and always returns
  `{"status":"done"}` after a valid callback has been accepted.

## What is known about the actual EN-K190FTW

The prior session scanned the terminal at `192.168.1.150`:

- Ports `5005` and `8090` are open.
- Port `8090` is a Boost.Beast JSON service, not a browser interface.
- Port `5005` accepts TCP but is not HTTP.
- The port `8090` command body is still undocumented; read-only probing did not
  identify it.

The remaining native-protocol step is therefore a real push capture. Ask the
supplier for the EN-K190FTW HTTP/API document and the exact FkWeb server-URL
format in parallel.

## Local setup

```bash
cd gateway
npm ci
cp .env.example .env
cp devices.example.yaml devices.yaml
npm test
npm run typecheck
npm start
```

Required `.env` values for the default direct-to-Supabase path:

```dotenv
SINK=supabase
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GATEWAY_HTTP_PORT=8080
STRICT_SERIALS=true
ARCHIVE_RAW=true
TZ=Africa/Nairobi
GATEWAY_ADDRESS=:80
```

The service-role value is a root-equivalent secret. Store it only in the VPS
application environment. Never place it in Git, a terminal setting, a URL, or
chat. `SINK=app` is the alternative when the gateway host should not have it.

`devices.yaml` must contain the same serial and vendor as the Supabase device:

```yaml
devices:
  - serial: ENS2025079
    label: HQ main entrance
    vendor: ebkn
    mode: listen
    timezone: Africa/Nairobi
    direction: null
```

Docker Manager uses `DEVICES_YAML` instead of a bind-mounted file; the supplied
Hostinger Compose definition already contains this device.

## Supabase configuration

Apply `supabase/migrations/20260822000001_gateway_direct_ingest.sql` before the
gateway goes live. Use the Supabase CLI from a linked project or paste the file
into the dashboard SQL editor.

Then create/edit the device in the app:

| Field | Value |
|---|---|
| Serial | `ENS2025079` |
| Protocol vendor | `EBKN / EN-K190` |
| Model | `EN-K190FTW` |
| Port | `5005` |
| Purpose | Attendance |
| Branch | The physical Citywalk branch |
| Direction | Both, unless the reader is physically IN-only or OUT-only |

Map each terminal enrollment number using vendor **EBKN / EN-K190**. Enrollment
numbers are vendor-scoped; user `7` on EBKN must not resolve to user `7` on a
ZKTeco fleet.

Until the migration exists, event delivery remains in the VPS spool and logs
`ingest_biometric_events not found`; it is delayed, not discarded.

## Deploy as a Hostinger Docker application

The simplest hPanel route after these files are committed and pushed:

1. Open **VPS → Manage → Docker Manager → Compose → Compose from URL**.
2. Use project name `citywalk-biometric-gateway`.
3. Use this Compose URL:

   ```text
   https://raw.githubusercontent.com/imodoiepale/citywalk-attendance/codex/hostinger-biometric-gateway/gateway/docker-compose.hostinger.yml
   ```

4. Add these application environment values in Hostinger:

   | Variable | Initial value |
   |---|---|
   | `SUPABASE_URL` | The project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | The service-role key |
   | `GATEWAY_ADDRESS` | `:80` for initial raw-IP HTTP capture |
   | `DEVICE_SERIAL` | `ENS2025079` |
   | `DEVICE_VENDOR` | `ebkn` |
   | `DEVICE_LABEL` | `HQ main entrance` |
   | `DEVICE_DIRECTION` | `null` |
   | `TZ` | `Africa/Nairobi` |

5. Deploy. The remote Git build context fetches `gateway/` from the repository;
   the spool and Caddy state use named persistent volumes.
6. In both the Hostinger managed firewall and Ubuntu firewall, allow inbound
   TCP `22`, `80`, and `443`. Do not expose `8080`, `5005`, `8090`, Postgres,
   or Supabase credentials.

For SSH deployment instead, clone the repository, create `gateway/.env` and
`gateway/devices.yaml`, then run `docker compose up -d --build` from `gateway/`.

### Domain and TLS

For the initial native capture:

```dotenv
GATEWAY_ADDRESS=:80
```

and use:

```text
Server-Client Mode: FkWeb
Web Server URL: http://VPS_IP/
```

After an A record such as `biometric.example.com` points to the VPS:

- Set `GATEWAY_ADDRESS=biometric.example.com` for automatic HTTPS.
- Use `https://biometric.example.com/` on the terminal only if real testing
  confirms its firmware supports HTTPS.
- If it supports a hostname but only HTTP, set
  `GATEWAY_ADDRESS=http://biometric.example.com` and use the HTTP URL.

Never port-forward the terminal's `5005` to the internet. The terminal makes an
outbound connection to the VPS; nobody on the internet needs inbound access to
the reader.

If the full Next.js application is later moved to this VPS, put it on a separate
hostname behind the same reverse proxy. Do not deploy a second project that
also binds host ports 80/443; use Hostinger's shared Traefik pattern or extend
this proxy configuration.

## Cams Web API v3 configuration

Only use this after Cams confirms and activates this exact device/service tag.

Hostinger environment:

```dotenv
CAMS_AUTH_TOKEN=VALUE_FROM_CAMS_API_MONITOR
# Optional additional service-tag tokens:
CAMS_AUTH_TOKENS=
# Optional, exactly 32 UTF-8 bytes and identical to API Monitor Security Key:
CAMS_SECURITY_KEY=
```

Cams API Monitor:

```text
Callback URL: https://biometric.example.com/callbacks/cams
AuthToken: same value as CAMS_AUTH_TOKEN
Security Key: blank, or exactly the same value as CAMS_SECURITY_KEY
```

The RESTful server-to-device URL, `stgid`, and AuthToken also come from the Cams
API Monitor. They are outbound Cams command settings and are not the callback
URL. This gateway currently implements attendance callbacks, not all destructive
user/template management operations.

## Endpoints

| Method | Path | Result |
|---|---|---|
| `POST` | Any non-control path | Native/generic device push |
| `POST` | `/callbacks/cams` | Token-validated Cams callback; returns `{"status":"done"}` |
| `POST` | `/iclock/cdata?...` | ZKTeco ADMS; returns `OK` |
| `WS` | Any path | Parses frames and returns `OK` |
| `GET` | `/healthz` | Public liveness, `{"status":"ok"}` |
| `GET` | `/status` | Queue/device diagnostics; blocked by public Caddy |

Read private status on the VPS:

```bash
docker compose exec gateway node -e "fetch('http://127.0.0.1:8080/status').then(r=>r.json()).then(console.log)"
```

## Test the complete path

### 1. Container and proxy

```bash
curl -i http://VPS_IP/healthz
docker compose ps
docker compose logs --tail=100 gateway
```

Expected: HTTP 200, both containers healthy/running, no credential or migration
errors.

### 2. Synthetic native scan

From inside the gateway container:

```bash
node src/probe/simulate.ts --pin 1027
```

For a Cams-format callback, with `CAMS_AUTH_TOKEN` configured:

```bash
node src/probe/simulate.ts --vendor cams --pin 1027
```

### 3. Cams acknowledgment and token rejection

Post the sample from the Cams docs to `/callbacks/cams`, replacing only the
serial, user, timestamp, and token. A correct token must return:

```json
{"status":"done"}
```

A wrong token must return HTTP 401 and must not create an event.

### 4. Verify Supabase

```sql
select received_at, device_serial, vendor, parsed_event_count, path
from public.device_raw_payloads
order by received_at desc
limit 20;

select received_at, device_serial, external_user_id, scanned_at, status, error
from public.biometric_events
order by received_at desc
limit 20;

select user_id, clock_in_at, clock_out_at, method
from public.punches
order by created_at desc
limit 20;
```

Success means one raw archive row, one biometric event, and—after the enrollment
is mapped—one applied punch. Sending the same device/user/timestamp twice must
increase the duplicate count without creating a second punch.

### 5. Real terminal scan

1. Photograph the terminal's current network/server screens.
2. Set FkWeb and the VPS HTTP URL.
3. Scan one known finger/face/card.
4. Check gateway logs and the three queries above.
5. If the request arrived but parsed zero events, keep the archived payload and
   add it as a parser fixture. If no request arrived, test DNS/gateway/firewall
   and capture with Wireshark before changing parser code.

For LAN discovery/capture, run `npm run capture` and try the documented local
formats (`http://192.168.1.237:8080/`, no-scheme host/port, WebSocket, then
LogClient). Restore the photographed values afterward.

## Privacy and operations

Known AuthTokens, passwords, photos, and biometric template `Data` fields are
redacted before the raw archive is written. Unknown binary payloads are capped
at 64 KiB for diagnosis. Disable `ARCHIVE_RAW` after bring-up if the archive is
not required by policy.

Useful operations:

```bash
docker compose logs -f gateway
docker compose restart gateway
docker compose exec gateway ls /var/lib/smart-sentinel/spool/events
```

Prune old parsed diagnostics according to Citywalk's retention policy:

```sql
delete from public.device_raw_payloads
where parsed_event_count > 0
  and received_at < now() - interval '90 days';
```
