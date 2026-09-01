# Citywalk biometric gateway

Receives terminal traffic on a Hostinger VPS, normalizes attendance scans,
spools them to persistent disk, and fans them out to every configured
destination.

```text
EN-K190FTW (FkWeb, raw TCP 5005)   Cams API / ZKTeco ADMS (HTTPS)
        │                                    │
        └────────────────┬───────────────────┘
                         ▼
        Hostinger VPS: gateway → durable spool, one per destination
                         │
                         ├─ supabase   → ingest_biometric_events() → punches
                         ├─ app        → HMAC-signed webhook
                         ├─ webhook    → n8n / Zapier / partner HRMS / …
                         └─ raw archive → device_raw_payloads
```

Every queue is independent. An archive failure cannot block attendance, a
Supabase outage leaves scans on the VPS until it recovers, and a third-party
webhook that is down cannot delay a punch reaching Supabase.

## FkWeb: the native protocol, solved

The EN-K190FTW and its FK-family relatives speak a protocol the supplier never
documented. It is now implemented natively — **no Windows machine anywhere in
the path**. The specification, and the method used to derive it from the
vendor's own software, is in
[`attendance/docs/fkweb-protocol.md`](https://github.com/imodoiepale/attendance/blob/main/docs/fkweb-protocol.md).

The short version:

- The terminal is the **client**. It dials TCP `5005` on this gateway, writes one
  bare JSON object, waits for a JSON reply, and closes. It works from behind NAT
  and needs no inbound access to the terminal.
- The scan looks like this:
  ```json
  {"log_id":"4471","user_id":"1027","fk_device_id":"ENS2025079",
   "io_time":"20260827081530","verify_mode":"3","temperature":"36.60"}
  ```
  `io_time` is device-local wall clock with no zone, resolved against the
  device's `timezone` in `devices.yaml`.
- **The reply is the protocol.** The terminal treats a scan as undelivered until
  it hears back, and re-sends indefinitely otherwise:
  ```json
  {"log_id":"4471","result":"OK","mode":"nothing"}
  ```
  This is why passively sniffing port 5005 produced nothing usable — a listener
  that accepts bytes and says nothing looks exactly like no listener.

The gateway builds that reply only **after** the scan is durably spooled, and
deliberately stays silent for a serial that is not in `devices.yaml`: silence
makes the terminal retain and retry, so adding the serial recovers the whole
buffered window instead of losing it.

Set the device to `vendor: fkweb` in `devices.yaml`. The older `ebkn` parser
remains for readers on this family that push over HTTP instead of dialling the
socket; it has no acknowledgement and must not be used for FkWeb terminals.

### Terminal settings

```text
Server-Client Mode: FkWeb
Web Server URL:     <VPS IP>:5005
```

Raw TCP cannot go through Traefik — it is not HTTP — so the container publishes
5005 itself. `STRICT_SERIALS` is what stands between that port and anyone able
to reach it; keep it on and keep `devices.yaml` accurate.

## The cloud channel: two-way device management (TCP 7788)

FkWeb is push-only — the terminal talks, we listen. The **cloud protocol** is the
other half: the terminal dials in and *stays connected*, so commands go back
down the same socket. Because the device initiates, it works from the VPS
through NAT with nothing installed at the branch.

Spec: [`attendance/docs/cloud-protocol.md`](https://github.com/imodoiepale/attendance/blob/main/docs/cloud-protocol.md).

What it unlocks:

- **Remote enrolment.** `adduser` asks a reader to capture; the person presents a
  finger once; the template arrives as `senduser` and replicates to every other
  compatible reader. No walking the estate with each new hire.
- **Log backfill.** `getnewlog` recovers punches recorded while the link was
  down. The push path cannot do this — a scan the device already discarded is
  gone — so this is the difference between "we lost Tuesday morning" and not.
- **Device management.** Clock sync, reboot, open door, volume and verify mode,
  access schedules, anti-passback, per-user validity windows.
- **Free inventory.** Registration reports model, firmware, `fpalgo` and
  capacity/usage counters, so "is that reader full?" is a query, not a site visit.

Set `GATEWAY_CLOUD_PORT=7788`, publish the port, and set the device to its
cloud/ADMS server mode. It accepts **both** WebSocket and raw JSON over TCP on
that port, because the vendor software runs both and firmware varies.

### Two constraints, and why the code looks the way it does

The protocol has **no request ids** — a reply is `{"ret":"<same name as cmd>"}`.
So exactly one command is in flight per device and the rest queue behind it.
That is a correctness requirement, not a simplification: two outstanding
commands make the first reply ambiguous, and a wrong match would answer the
wrong question silently. Reads are **paged** (`stn:true`, then `stn:false`), and
an empty page is the only reliable end-of-data signal.

### How the app sends a command

It doesn't — not directly. The app writes a row to `device_commands`; the
gateway polls that table, dispatches, and writes the outcome back. **No inbound
control API on the VPS**, no second shared secret, and commands queue correctly
while the app is down, the gateway is down, or the device is offline. A command
for an offline reader stays queued and goes out when it reconnects.

Apply `supabase/migrations/20260828000001_biometric_credentials.sql` before this
works.

### Templates are encrypted before they reach the database

`BIOMETRIC_TEMPLATE_KEY` is **required to store any credential**. Templates are
sealed with AES-256-GCM in the gateway, so a database dump is ciphertext and no
database role can decrypt one. Without the key the gateway refuses to store a
captured credential rather than writing biometric data in the clear.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Back it up where you would back up a root password: lose it and every stored
credential is unreadable, which means re-enrolling the estate.
`BIOMETRIC_TEMPLATE_KEYS_PREVIOUS` holds retired keys so a rotation does not
break existing rows.

### Testing it without hardware

A simulator speaks the device side — registers, answers commands, pushes punches
and captured credentials:

```bash
node src/probe/simulate-cloud.ts --serial ENS2025079 --port 7788 --punch 1027
```

This is how the whole feature was built and is covered by tests; it is also the
fastest way to prove a deployment works before a terminal is anywhere near it.

## Cams Web API v3 is a separate, optional path

| Mode | Where the URL is configured | URL |
|---|---|---|
| Native FkWeb | On the physical terminal | `<VPS IP>:5005` (raw TCP) |
| Cams Web API v3 | Cams **API Monitor**, not the terminal | `https://srv1631847.hstgr.cloud/callbacks/cams` |

The Cams documentation describes a paid cloud protocol engine. It does not
document the FkWeb protocol and does not make a non-Cams device Cams-native. If
you do activate it, `/callbacks/cams` implements the documented
`RealTime.PunchLog`, validates `AuthToken`, optionally decrypts AES-256-ECB
callbacks, and always returns `{"status":"done"}` after a valid callback.

With FkWeb working natively, Cams is not needed for these terminals.

## Local setup

```bash
cd gateway
npm ci
cp .env.example .env
cp devices.example.yaml devices.yaml
cp destinations.example.yaml destinations.yaml
npm test
npm run typecheck
npm start
```

Required `.env` values for the default direct-to-Supabase path:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
GATEWAY_HTTP_PORT=8080
GATEWAY_TCP_PORTS=5005
STRICT_SERIALS=true
ARCHIVE_RAW=true
TZ=Africa/Nairobi
GATEWAY_ADDRESS=:80
```

The service-role value is a root-equivalent secret. Store it only in the VPS
application environment. Never place it in Git, a terminal setting, a URL, or
chat. An `app`-type destination is the alternative when the gateway host should
not have it.

`devices.yaml` must contain the same serial as the Supabase device:

```yaml
devices:
  - serial: ENS2025079
    label: HQ main entrance
    vendor: fkweb
    mode: listen
    port: 5005
    timezone: Africa/Nairobi
    branch: hq          # routing hint for destination filters
    direction: null
```

Docker Manager uses `DEVICES_YAML` and `DESTINATIONS_YAML` instead of
bind-mounted files; the supplied Hostinger Compose definition already contains
this device.

## Destinations: fanning out to third parties

`destinations.yaml` lists everywhere a scan should go. Each destination gets its
**own spool directory and its own retry loop**, so a partner endpoint that is
down, slow or rate-limiting cannot delay a punch reaching Supabase.

```yaml
destinations:
  - id: supabase-primary
    type: supabase

  - id: n8n-payroll
    type: webhook
    url: https://n8n.example.com/webhook/citywalk-punch
    auth:
      kind: hmac                 # hmac | bearer | header | none
      secretEnv: N8N_WEBHOOK_SECRET
    filter:
      branches: [hq]             # matches `branch:` in devices.yaml
```

Third parties receive the same `NormalizedEvent` everything else gets:

```json
{"events":[{
  "deviceSerial":"ENS2025079","externalUserId":"1027",
  "scannedAt":"2026-08-27T05:15:30.000Z","direction":"in",
  "dedupeKey":"ENS2025079|1027|2026-08-27T05:15:30.000Z","raw":{}
}]}
```

`dedupeKey` is derived from the scan, never from receipt time, so a terminal
replaying its buffer after an outage is not a second punch. Receivers must treat
a repeat as a no-op.

For a partner who needs their own shape, `format: single` sends one request per
scan and `template` reshapes the body with `{{placeholders}}` — see
`destinations.example.yaml` for a worked example.

**Secrets are never written in this file.** `auth.secretEnv` names an
environment variable; the loader refuses a literal secret, an inline
`Authorization` header, or a credential in the URL, and fails at boot — with the
variable's name — if the named variable is unset.

Omitting `destinations.yaml` entirely falls back to the single destination named
by `SINK`, exactly as the gateway behaved before fan-out existed.

Per-destination health, including a one-sided backlog, is in `/status` under
`destinations`.

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

## One client per command

For running several clients on one host, `deploy/install.sh` renders a complete
per-client stack — its own container, spool volume, Supabase project and ports —
and brings it up under its own Compose project:

```bash
export SUPABASE_SERVICE_ROLE_KEY=...   # keeps it out of shell history
./deploy/install.sh --client acme --supabase-url https://xxxx.supabase.co --hostname gateway.acme.example.com --serial ENS2025079 --branch hq
```

It picks host ports that do not collide with clients already installed, generates
a `BIOMETRIC_TEMPLATE_KEY`, writes `.env` at mode 600, and prints the firewall
and terminal settings to apply. `--no-start` renders without launching.

Not a `curl … | bash` one-liner on purpose: this writes a service-role key and a
biometric encryption key to disk and starts a container, and piping a remote
script into a root shell to save one step is not a trade worth making.

## Deploy as a Hostinger Docker application

The simplest hPanel route after these files are committed and pushed:

1. Open **VPS → Manage → Docker Manager → Compose → Compose from URL**.
2. Use project name `citywalk-biometric-gateway`.
3. Use this Compose URL:

   ```text
   https://raw.githubusercontent.com/imodoiepale/citywalk-attendance/main/gateway/docker-compose.hostinger.yml
   ```

4. Add these application environment values in Hostinger:

   | Variable | Initial value |
   |---|---|
   | `SUPABASE_URL` | The project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | The service-role key |
   | `GATEWAY_HOSTNAME` | `srv1631847.hstgr.cloud` |
   | `FKWEB_TCP_PORT` | `5005` — where the terminal dials |
   | `NATIVE_HTTP_PORT` | `8081`, only if an HTTP-family device also needs raw-IP capture |
   | `DEVICE_SERIAL` | `ENS2025079` |
   | `DEVICE_VENDOR` | `fkweb` |
   | `DEVICE_LABEL` | `HQ main entrance` |
   | `DEVICE_BRANCH` | `hq` |
   | `DEVICE_DIRECTION` | `null` |
   | `TZ` | `Africa/Nairobi` |
   | `M50_TOKEN_SECRET` | A generated secret — keeps M50 WebSocket terminals registered across restarts |
   | `LEGACY_TLS_PORT` | `8443`, only if an M82-generation terminal that speaks TLS 1.0 needs the legacy TLS sidecar (see below) |

   Add any `auth.secretEnv` variables your `destinations.yaml` names — e.g.
   `N8N_WEBHOOK_SECRET`. The container refuses to start if one is missing.

5. Deploy. The remote Git build context fetches `gateway/` from the repository;
   the scan spool uses a named persistent volume. Traefik already running on
   this VPS terminates HTTPS for the gateway hostname.
6. In both the Hostinger managed firewall and the Ubuntu firewall, allow inbound
   TCP `22`, `80`, `443`, and **`5005`**.

   `5005` is inbound to the *gateway*, not to the terminal — the terminal dials
   out to it. It carries a raw protocol with no authentication the firmware can
   provide, so `STRICT_SERIALS=true` and an accurate `devices.yaml` are the
   whole of the door: an unlisted serial is rejected and never becomes a punch.
   If your terminals have fixed public egress addresses, restrict `5005` to
   those source IPs as well.

   Do not expose `8090`, Postgres, or Supabase credentials. Close `8081` unless
   an HTTP-family device is actually using it.

   Open **`8443`** too if any terminal needs the legacy TLS sidecar (below);
   otherwise leave it closed.

### M82 terminals that speak TLS 1.0

Some M82-generation firmware always wraps its connection in TLS, regardless of
the URL scheme configured on the terminal's own menu — but only negotiates
TLS 1.0 with old CBC cipher suites, below Traefik's default minimum (TLS 1.2).
Pointing such a terminal at the `GATEWAY_HOSTNAME` router will fail the TLS
handshake before any request reaches the gateway at all, with nothing to see
in the gateway's own logs — the connection never gets that far.

Traefik's per-router TLS options (`minVersion`, `cipherSuites`) cannot be set
from this compose file's Docker labels alone; they require Traefik's separate
file provider, which lives outside this repository since Hostinger's Traefik
is a pre-existing, separately-managed instance. `legacy-tls-sidecar` in
`docker-compose.hostinger.yml` works around this by terminating that TLS
itself — with an internally-generated self-signed certificate, regenerated
fresh on each container start — and handing the gateway plain HTTP, published
on its own port (`LEGACY_TLS_PORT`, default `8443`) so it bypasses Traefik
entirely, the same way FkWeb's raw TCP `5005` already does.

Point such a terminal's Web Server URL at `<VPS IP>:8443` instead of the
Traefik hostname. If the terminal's firmware validates the certificate chain
and rejects a self-signed one, the symptom is the TLS handshake completing —
visible in the sidecar's own log — followed by an immediate connection close
with no HTTP request ever sent; the fix at that point is mounting a CA-issued
certificate instead of the generated one, not a code change.

For SSH deployment instead, clone the repository, create `gateway/.env` and
`gateway/devices.yaml`, then run `docker compose up -d --build` from `gateway/`.

### Domain and TLS

FkWeb is a raw TCP protocol, **not HTTP**, so Traefik cannot front it and TLS
does not apply to it. The terminal is pointed straight at the VPS address and
port, and the container publishes that port itself:

```text
Server-Client Mode: FkWeb
Web Server URL: 76.13.53.26:5005
```

The scan payload carries an enrollment number, a device serial and a timestamp —
no names, no biometric templates. That it crosses the internet unencrypted is a
real limitation of the firmware, not a choice; if it matters for your threat
model, terminate it over a site-to-site VPN or WireGuard tunnel to the VPS and
point the terminal at the tunnel address instead.

HTTP-family devices and Cams callbacks do get TLS, via the existing hostname:

- Set `GATEWAY_HOSTNAME=srv1631847.hstgr.cloud`.
- Configure Cams API Monitor callback as
  `https://srv1631847.hstgr.cloud/callbacks/cams`.

Note the direction of `5005`: it is inbound **to the gateway**, which the
terminal dials out to. Nobody needs inbound access to the reader itself — never
port-forward the terminal's own `5005` from the branch network.

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
Callback URL: https://srv1631847.hstgr.cloud/callbacks/cams
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
| `GET` | `/status` | Queue/device diagnostics; loopback-only |

Read private status on the VPS:

```bash
docker compose exec gateway node -e "fetch('http://127.0.0.1:8080/status').then(r=>r.json()).then(console.log)"
```

## Test the complete path

### 1. Container and proxy

```bash
curl -i http://76.13.53.26:8081/healthz
curl -i https://srv1631847.hstgr.cloud/healthz
docker compose ps
docker compose logs --tail=100 gateway
```

Expected: HTTP 200, both containers healthy/running, no credential or migration
errors.

### 2. Synthetic FkWeb scan

This is the important one: it proves the acknowledgement path end to end. From
any machine that can reach the VPS:

```bash
printf '{"log_id":"1","user_id":"1027","fk_device_id":"ENS2025079","io_time":"20260827081530","verify_mode":"3","temperature":"0.0"}' | nc 76.13.53.26 5005
```

The gateway must reply on the same connection with:

```json
{"log_id":"1","result":"OK","mode":"nothing"}
```

No reply means the scan was **not** accepted — check the logs for
`rejected push from unknown serial`, which is the expected result if the serial
is missing from `devices.yaml`.

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

1. Photograph the terminal's current network/server screens before changing
   anything.
2. Set `Server-Client Mode: FkWeb` and `Web Server URL: <VPS IP>:5005`.
3. Scan one known finger/face/card.
4. Check the gateway log for `accepted scans` with `vendor: fkweb`, then run the
   three queries above.

If a connection arrived but parsed zero events, the archived payload in
`device_raw_payloads` is the evidence — add it to `test/fkweb.test.ts` as a
fixture and tighten the parser against it rather than guessing. The likely
causes, in order:

- **Different field names.** Some firmwares in this family use `device_id`
  instead of `fk_device_id`; the parser accepts both, but a genuinely new
  spelling needs adding.
- **A V1 device wanting a different reply.** Both `SendRtLogResponseV1` and
  `SendRtLogResponseV3` exist in the vendor implementation; the gateway sends
  the superset body. If the terminal keeps re-sending an already-accepted scan,
  that is the thing to vary first.
- **Not JSON at all.** Then it is not FkWeb, and
  `attendance/docs/fkweb-protocol.md` §5 covers the SBXPC XML family.

If no connection arrived at all, the problem is network, not parsing: check the
Hostinger and Ubuntu firewalls both allow inbound `5005`, and confirm the
terminal's branch network permits outbound to it.

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
