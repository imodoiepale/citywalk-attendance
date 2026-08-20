import { NextResponse } from 'next/server'
import { getAdapter } from '@/lib/biometric/adapters'
import { getWebhookSecret, verifySignature } from '@/lib/biometric/auth'
import { ingestEvents } from '@/lib/biometric/process'

// Signed JSON webhook. For an on-site server or the connector script to POST
// batches of scans to. Vendor-agnostic: `?vendor=` picks the adapter, and the
// default handles the field-name variations these systems ship with.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = getWebhookSecret()
  if (!secret) {
    // Fail closed. An unset secret must not mean "accept anything".
    return NextResponse.json({ error: 'ingest is not configured' }, { status: 503 })
  }

  // Read the body as text, not JSON: the signature is over the exact bytes
  // sent, and re-serialising parsed JSON would not reproduce them.
  const rawBody = await request.text()
  const signature =
    request.headers.get('x-signature') ?? request.headers.get('x-hub-signature-256')

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 })
  }

  const vendor = new URL(request.url).searchParams.get('vendor')
  const events = getAdapter(vendor).parse(payload)

  if (events.length === 0) {
    return NextResponse.json({ error: 'no readable events in payload' }, { status: 422 })
  }

  const result = await ingestEvents(events)
  return NextResponse.json(result)
}
