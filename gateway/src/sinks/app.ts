import { createHmac } from 'node:crypto'
import type { NormalizedEvent } from '../types.ts'
import type { RawPayload } from '../archive.ts'
import type { Delivery, DeliveryOutcome } from './types.ts'
import { log } from '../log.ts'

// The alternative sink: post to the Next.js app's HMAC-signed webhooks instead
// of to Supabase directly.
//
// Kept because it is the only option that does not put a service-role key on
// the device-facing host. Slower to react (the app has to be up) but strictly
// safer, and it is the right choice for a gateway running somewhere less
// trusted than your own VPS — a branch mini-PC, say.
//
// The app reads the body as *text* and HMACs the exact bytes it received (see
// lib/biometric/auth.ts), so the body is serialised once, signed, and that same
// string sent. Re-stringifying a parsed object gives different bytes and a 401
// that looks convincingly like a wrong secret.

export interface AppSinkOptions {
  appUrl: string
  secret: string
  vendor?: string
}

export function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

function deliver(url: string, secret: string): (body: string) => Promise<DeliveryOutcome> {
  return async (body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': sign(body, secret),
        'user-agent': 'smart-sentinel-gateway/0.1',
      },
      body,
      signal: AbortSignal.timeout(20_000),
    })

    if (res.ok) return 'ok'
    const text = await res.text().catch(() => '')

    // 404: this app build predates the endpoint. 422: the app read the body and
    // found nothing usable. Both fail identically forever, so drop rather than
    // wedge the queue behind something no retry can fix.
    if (res.status === 404 || res.status === 422) {
      log.error('app rejected batch permanently; dropping to unblock queue', {
        url, status: res.status, body: text.slice(0, 300),
      })
      return 'drop'
    }

    log.error('app delivery failed', { url, status: res.status, body: text.slice(0, 200) })
    return 'retry'
  }
}

export function appEventSink(opts: AppSinkOptions): Delivery<NormalizedEvent> {
  const url = `${opts.appUrl.replace(/\/$/, '')}/api/biometric/events?vendor=${encodeURIComponent(opts.vendor ?? 'generic')}`
  const send = deliver(url, opts.secret)
  return (events) => send(JSON.stringify({ events }))
}

export function appRawSink(opts: AppSinkOptions): Delivery<RawPayload> {
  const url = `${opts.appUrl.replace(/\/$/, '')}/api/biometric/raw`
  const send = deliver(url, opts.secret)
  return (payloads) => send(JSON.stringify({ payloads }))
}
