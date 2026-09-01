# Deploying the gateway to Hostinger — step by step

Walks through standing up `citywalk-biometric-gateway` as a new Docker
Manager application on the existing Hostinger VPS, and pointing the
EN-K190FTW terminal (serial `ENS2025079`) at it. See
[`../README.md`](../README.md) for the full reference — this is the
condensed, in-order checklist for doing it once, start to finish.

The VPS already exists: `srv1631847.hstgr.cloud` / `76.13.53.26`, Ubuntu
24.04 with Docker and a host-network Traefik project already running on
80/443. You're adding a new application alongside it, not setting up the VPS
itself.

## 0. Before you start

Gather these — you'll paste them into Hostinger in step 3:

- **Supabase project URL and service-role key** — Supabase dashboard →
  Project Settings → API. The service-role key is root-equivalent: never
  paste it anywhere except the Hostinger application environment.
- Two fresh secrets, generated on any machine with Node:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  Run it twice — once for `BIOMETRIC_TEMPLATE_KEY`, once for
  `M50_TOKEN_SECRET`. Back both up like a root password: losing
  `BIOMETRIC_TEMPLATE_KEY` after credentials are stored means re-enrolling
  the estate.

## 1. Apply the Supabase migrations

In the Supabase SQL editor (or via a linked CLI), run, in order:

- `supabase/migrations/20260822000001_gateway_direct_ingest.sql`
- `supabase/migrations/20260828000001_biometric_credentials.sql`

Skipping this doesn't lose scans — they queue in the gateway's spool and
apply once the migration exists — but nothing reaches the database until
it's run.

## 2. Create the application in hPanel

1. **VPS → Manage → Docker Manager → Compose → Compose from URL**.
2. Project name: `citywalk-biometric-gateway`.
3. Compose URL:
   ```
   https://raw.githubusercontent.com/imodoiepale/citywalk-attendance/main/gateway/docker-compose.hostinger.yml
   ```

## 3. Set the application environment

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | From step 0 |
| `GATEWAY_HOSTNAME` | `srv1631847.hstgr.cloud` |
| `BIOMETRIC_TEMPLATE_KEY` | Generated in step 0 |
| `M50_TOKEN_SECRET` | Generated in step 0 |
| `FKWEB_TCP_PORT` | `5005` |
| `DEVICE_SERIAL` | `ENS2025079` |
| `DEVICE_VENDOR` | `m82` |
| `DEVICE_LABEL` | `HQ main entrance` |
| `DEVICE_BRANCH` | `hq` |
| `DEVICE_DIRECTION` | `null` |
| `TZ` | `Africa/Nairobi` |
| `LEGACY_TLS_PORT` | `8443` |

`DEVICE_VENDOR=m82`, not `fkweb` — confirmed against this specific terminal
(see the "M82 terminals that speak TLS 1.0" section of the README for how
that was established).

## 4. Deploy

Click deploy. This builds two services from `main`: `gateway` and
`legacy-tls-sidecar`. First build takes a few minutes; watch the Docker
Manager build log for errors (most commonly: a required env var left
blank).

## 5. Open firewall ports

In **both** the Hostinger managed firewall and the VPS's own `ufw`, allow
inbound TCP:

- `22` — SSH (should already be open)
- `80`, `443` — Traefik (should already be open)
- `5005` — FkWeb/native raw TCP push
- `8443` — the legacy TLS sidecar

## 6. Point the terminal at the gateway

On the terminal's own menu, set the Web Server URL to:

```
76.13.53.26:8443
```

This is the legacy TLS sidecar — the path that terminates this firmware's
TLS 1.0 connection itself, since Traefik's default minimum is TLS 1.2 and
can't be lowered from this repo's compose file alone (see the README section
above for why).

## 7. Verify

```bash
curl -i https://srv1631847.hstgr.cloud/healthz      # gateway via Traefik
docker compose logs -f gateway                       # on the VPS
docker compose logs -f legacy-tls-sidecar            # on the VPS
```

Trigger one scan on the terminal. Expect, in order, in the
`legacy-tls-sidecar` log: a TLS connection accepted. In the `gateway` log:
`accepted scans` with `vendor:"m82"` and the terminal's serial.

Then in Supabase:

```sql
select received_at, device_serial, vendor, parsed_event_count, path
from public.device_raw_payloads
order by received_at desc
limit 20;

select received_at, device_serial, external_user_id, scanned_at, status, error
from public.biometric_events
order by received_at desc
limit 20;
```

Success is one raw archive row, one biometric event, and — once the
enrolment number is mapped to a person — one applied punch.

## If the terminal connects but nothing shows up

- **Nothing at all, ever, in any log** — network problem, not protocol.
  Confirm both firewalls (step 5) and that the terminal's network permits
  outbound to `76.13.53.26:8443`.
- **TLS connects, then closes immediately with no HTTP request logged** —
  the firmware is validating the certificate chain and rejecting the
  sidecar's self-signed one. The fix is mounting a CA-issued certificate in
  the sidecar instead of the generated one — not a code change. This was the
  exact failure mode reproduced locally against a hand-rolled self-signed
  cert; a real deployment may or may not hit it depending on whether this
  firmware validates chains at all.
- **`push produced no events`** — the connection and framing worked but the
  parser didn't recognize the payload shape. The archived raw payload in
  `device_raw_payloads` is the next thing to look at — add it as a fixture
  to `gateway/test/m82.test.ts` and tighten the parser against it rather than
  guessing.
