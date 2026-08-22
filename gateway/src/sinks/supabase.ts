import type { NormalizedEvent } from '../types.ts'
import type { RawPayload } from '../archive.ts'
import type { Delivery, DeliveryOutcome } from './types.ts'
import { log } from './../log.ts'

// Direct-to-Supabase delivery, via PostgREST.
//
// This is the live path: a scan becomes a punch without the Next.js app being
// involved at all, so a deploy, a cold start or a hosting incident cannot stop
// people clocking in.
//
// SECURITY NOTE, stated plainly because it is a real trade and was a deliberate
// choice rather than an oversight: this requires the service-role key on the
// gateway host. That key bypasses RLS entirely — anyone who reads it has full
// read/write on every table, including profiles and punches. The mitigations
// that make it acceptable:
//
//   - The key lives only in the container's environment, never in git, never in
//     devices.yaml, and never in a log line (see redact() below).
//   - The gateway reaches exactly two things: the ingest RPC and the raw
//     archive table. It never selects from profiles or punches.
//   - The RPC is revoked from anon and authenticated, so a leaked *anon* key
//     cannot forge attendance.
//   - The VPS should allow inbound 22/80/443 only, and 22 by key.
//
// If that trade stops being acceptable, `SINK=app` switches back to the
// HMAC-signed webhook path with no other change.

export interface SupabaseSinkOptions {
  url: string
  serviceRoleKey: string
}

function headers(key: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: key,
    authorization: `Bearer ${key}`,
  }
}

/** Anything logged from here is scrubbed: a key in a log file is a key on disk. */
function redact(text: string, key: string): string {
  return key ? text.split(key).join('«service-role-key»') : text
}

async function post(
  url: string,
  key: string,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers(key), ...extraHeaders },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  return { ok: res.ok, status: res.status, text: await res.text().catch(() => '') }
}

/**
 * Scans → the ingest RPC, which owns the matching rules.
 *
 * Deliberately one RPC call rather than a handful of REST calls: the device
 * lookup, the enrollment match, the event insert and the punch all have to
 * happen in one transaction, or a crash halfway leaves an event row claiming a
 * punch that does not exist.
 */
export function supabaseEventSink(opts: SupabaseSinkOptions): Delivery<NormalizedEvent> {
  const endpoint = `${opts.url.replace(/\/$/, '')}/rest/v1/rpc/ingest_biometric_events`

  return async (events): Promise<DeliveryOutcome> => {
    const res = await post(endpoint, opts.serviceRoleKey, JSON.stringify({ p_events: events }))

    if (res.ok) {
      log.info('ingested batch', { count: events.length, result: safeJson(res.text) })
      return 'ok'
    }

    // The function is missing: the migration has not been applied. Retrying
    // forever would wedge the queue and hide the actual problem.
    if (res.status === 404 || res.text.includes('PGRST202')) {
      log.error('ingest_biometric_events not found — apply the migration', {
        hint: 'supabase/migrations/20260822000001_gateway_direct_ingest.sql',
        detail: redact(res.text.slice(0, 300), opts.serviceRoleKey),
      })
      return 'retry'
    }

    // A bad key is not transient either, but it IS recoverable by fixing the
    // env, so the batch is kept and retried rather than dropped.
    if (res.status === 401 || res.status === 403) {
      log.error('supabase rejected the credentials', {
        status: res.status,
        hint: 'check SUPABASE_SERVICE_ROLE_KEY — the anon key will not work here',
      })
      return 'retry'
    }

    log.error('ingest failed', {
      status: res.status,
      detail: redact(res.text.slice(0, 300), opts.serviceRoleKey),
    })
    return 'retry'
  }
}

/**
 * Raw payloads → a plain insert.
 *
 * `Prefer: resolution=ignore-duplicates` makes a redelivery after a crash a
 * no-op rather than a unique-violation that would block the queue head.
 */
export function supabaseRawSink(opts: SupabaseSinkOptions): Delivery<RawPayload> {
  const endpoint = `${opts.url.replace(/\/$/, '')}/rest/v1/device_raw_payloads`

  return async (payloads): Promise<DeliveryOutcome> => {
    const rows = payloads.map((p) => ({
      device_serial: p.deviceSerial,
      transport: p.transport,
      method: p.method,
      path: p.path,
      query: p.query,
      headers: p.headers,
      body_text: p.bodyText,
      body_base64: p.bodyBase64,
      bytes: p.bytes,
      parsed_event_count: p.parsedEventCount,
      vendor: p.vendor,
      source_ip: p.sourceIp,
      received_at: p.receivedAt,
      payload_key: p.payloadKey,
    }))

    const res = await post(endpoint, opts.serviceRoleKey, JSON.stringify(rows), {
      prefer: 'resolution=ignore-duplicates,return=minimal',
    })

    if (res.ok) return 'ok'

    // The archive is diagnostics, not attendance. If the table is missing, say
    // so once and drop — blocking here would eventually stall the disk while
    // punches, which matter more, are unaffected on their own queue.
    if (res.status === 404) {
      log.error('device_raw_payloads table not found — apply the migration', {
        hint: 'supabase/migrations/20260822000001_gateway_direct_ingest.sql',
      })
      return 'drop'
    }

    log.warn('raw archive insert failed', {
      status: res.status,
      detail: redact(res.text.slice(0, 200), opts.serviceRoleKey),
    })
    return 'retry'
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text.slice(0, 200)
  }
}
