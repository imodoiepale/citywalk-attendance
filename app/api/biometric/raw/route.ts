import { NextResponse } from 'next/server'
import { getWebhookSecret, verifySignature } from '@/lib/biometric/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// The raw payload archive, for gateways running with SINK=app.
//
// The gateway's default is to write to Supabase directly, which keeps
// attendance working when this app is not. This route is the alternative for a
// gateway that should not hold a service-role key — a branch mini-PC, say — and
// it lands in exactly the same table either way.
//
// Same signature scheme as /api/biometric/events: HMAC-SHA256 over the raw
// bytes. Unlike that route, nothing here is interpreted — the point is to store
// what arrived, verbatim, including the payloads no parser understood.

export const dynamic = 'force-dynamic'

interface IncomingPayload {
  deviceSerial?: string | null
  transport?: string
  method?: string | null
  path?: string | null
  query?: Record<string, string> | null
  headers?: Record<string, string> | null
  bodyText?: string | null
  bodyBase64?: string
  bytes?: number
  parsedEventCount?: number
  vendor?: string | null
  sourceIp?: string | null
  receivedAt?: string
  payloadKey?: string
}

export async function POST(request: Request) {
  const secret = getWebhookSecret()
  if (!secret) {
    // Fail closed. An unset secret must not mean "accept anything".
    return NextResponse.json({ error: 'ingest is not configured' }, { status: 503 })
  }

  // Read as text, not JSON: the signature covers the exact bytes sent, and
  // re-serialising parsed JSON would not reproduce them.
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-signature') ?? request.headers.get('x-hub-signature-256')

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let parsed: { payloads?: IncomingPayload[] }
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const payloads = Array.isArray(parsed.payloads) ? parsed.payloads : []
  if (payloads.length === 0) {
    return NextResponse.json({ error: 'no payloads in body' }, { status: 422 })
  }

  // payload_key is required and unique — it is what makes a redelivery after a
  // gateway crash a no-op instead of a duplicate row.
  const rows = payloads
    .filter((p) => typeof p.payloadKey === 'string' && p.payloadKey.length > 0)
    .map((p) => ({
      device_serial: p.deviceSerial ?? null,
      transport: p.transport ?? 'unknown',
      method: p.method ?? null,
      path: p.path ?? null,
      query: p.query ?? null,
      headers: p.headers ?? null,
      body_text: p.bodyText ?? null,
      body_base64: p.bodyBase64 ?? null,
      bytes: p.bytes ?? 0,
      parsed_event_count: p.parsedEventCount ?? 0,
      vendor: p.vendor ?? null,
      source_ip: p.sourceIp ?? null,
      received_at: p.receivedAt ?? new Date().toISOString(),
      payload_key: p.payloadKey,
    }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no payloads carried a payload_key' }, { status: 422 })
  }

  // Service role: a device has no user session, and the signature above is the
  // authorization. ignoreDuplicates makes a retry idempotent rather than a
  // unique violation that would wedge the gateway's queue.
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('device_raw_payloads')
    .upsert(rows, { onConflict: 'payload_key', ignoreDuplicates: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ stored: rows.length })
}
