import { createHmac } from 'node:crypto'
import type { NormalizedEvent } from '../types.ts'
import type { Delivery, DeliveryOutcome } from '../sinks/types.ts'
import type { DestinationConfig } from './types.ts'
import { isRecord } from '../vendors/fields.ts'
import { log } from '../log.ts'

// The generic outbound webhook: the destination type that makes this gateway
// useful to anything that is not Citywalk's own app — n8n, Make, Zapier, a
// payroll provider, a partner HRMS, a customer's own endpoint.
//
// It sends the same NormalizedEvent every other destination gets. That is
// deliberate: one event contract, documented once, is what lets a third party
// integrate without anyone explaining what an FkWeb frame is.

const RETRYABLE_TIMEOUT_MS = 20_000

/**
 * Statuses that will fail identically no matter how many times we try.
 *
 * Dropped rather than retried because a permanently-rejecting destination at
 * the head of a queue blocks every scan behind it. The scan is not lost — the
 * raw archive and the other destinations still have it — and the drop is
 * counted and logged.
 */
function isPermanent(status: number): boolean {
  return status === 400 || status === 401 || status === 403 ||
    status === 404 || status === 405 || status === 410 || status === 422
}

function authHeaders(d: DestinationConfig, body: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const auth = d.auth
  if (!auth || auth.kind === 'none') return {}

  // Validated at boot by loadDestinations, so this cannot be empty in practice;
  // the guard is here so a misuse in a test fails loudly rather than sending an
  // unsigned request to a real endpoint.
  const secret = env[auth.secretEnv ?? '']?.trim()
  if (!secret) throw new Error(`destination ${d.id}: ${auth.secretEnv} is not set`)

  switch (auth.kind) {
    case 'hmac':
      // Signed over the exact bytes sent, so the receiver can verify by hashing
      // the raw request body — the same contract as the app sink.
      return { [auth.header ?? 'x-signature']: createHmac('sha256', secret).update(body, 'utf8').digest('hex') }
    case 'bearer':
      return { [auth.header ?? 'authorization']: `Bearer ${secret}` }
    case 'header':
      return { [auth.header as string]: secret }
  }
}

/**
 * Fills a JSON template from one event.
 *
 * Placeholders are `{{field}}` for the top-level NormalizedEvent fields and
 * `{{raw.field}}` for anything the vendor module kept. Values are JSON-escaped,
 * so a device that somehow reports a quote in its serial cannot break the body
 * it lands in — or inject structure into it.
 */
export function renderTemplate(template: string, event: NormalizedEvent): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(event, path)
    if (value === undefined || value === null) return ''
    // Slice the surrounding quotes off the JSON encoding: the template already
    // supplies them where the author wanted a string.
    const encoded = JSON.stringify(String(value))
    return encoded.slice(1, -1)
  })
}

function resolvePath(event: NormalizedEvent, path: string): unknown {
  const [head, ...rest] = path.split('.')
  if (head !== 'raw') return (event as unknown as Record<string, unknown>)[path]

  let cursor: unknown = event.raw
  for (const key of rest) {
    if (!isRecord(cursor)) return undefined
    cursor = cursor[key]
  }
  return cursor
}

export function webhookEventSink(
  d: DestinationConfig,
  env: NodeJS.ProcessEnv = process.env
): Delivery<NormalizedEvent> {
  const url = d.url as string
  const single = d.format === 'single'

  const send = async (body: string): Promise<DeliveryOutcome> => {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'citywalk-gateway/0.1',
          ...(d.headers ?? {}),
          ...authHeaders(d, body, env),
        },
        body,
        signal: AbortSignal.timeout(RETRYABLE_TIMEOUT_MS),
      })
    } catch (e) {
      // Network-level failure. Always transient — the spool keeps the scan.
      log.warn('webhook unreachable', { destination: d.id, url, error: e instanceof Error ? e.message : String(e) })
      return 'retry'
    }

    if (res.ok) return 'ok'

    const text = await res.text().catch(() => '')
    if (isPermanent(res.status)) {
      log.error('webhook rejected permanently; dropping to unblock its queue', {
        destination: d.id, url, status: res.status, body: text.slice(0, 300),
      })
      return 'drop'
    }

    log.warn('webhook delivery failed', { destination: d.id, url, status: res.status, body: text.slice(0, 200) })
    return 'retry'
  }

  return async (events): Promise<DeliveryOutcome> => {
    if (!single) return send(JSON.stringify({ events }))

    // One request per scan. Any transient failure returns 'retry' for the whole
    // batch, which re-sends the successful ones too — safe because dedupeKey
    // makes a repeat a no-op at every well-behaved receiver, and losing a scan
    // is much worse than delivering one twice.
    let sawDrop = false
    for (const event of events) {
      const body = d.template ? renderTemplate(d.template, event) : JSON.stringify(event)
      const outcome = await send(body)
      if (outcome === 'retry') return 'retry'
      if (outcome === 'drop') sawDrop = true
    }
    return sawDrop ? 'drop' : 'ok'
  }
}
