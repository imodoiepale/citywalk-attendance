import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHmac } from 'node:crypto'
import { loadDestinations } from '../src/destinations/config.ts'
import { webhookEventSink, renderTemplate } from '../src/destinations/webhook.ts'
import { Fanout, matches } from '../src/fanout.ts'
import { createForwarder } from '../src/forward.ts'
import type { DestinationConfig } from '../src/destinations/types.ts'
import type { NormalizedEvent } from '../src/types.ts'

// Fan-out exists for one reason: a third-party endpoint being down must not
// delay a punch reaching Supabase. Most of what follows is about proving that
// isolation actually holds, and that a credential cannot end up in the YAML.

const NOWHERE = path.join(os.tmpdir(), 'destinations-does-not-exist.yaml')

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    deviceSerial: 'ENS2025079',
    externalUserId: '1027',
    scannedAt: '2026-08-27T05:15:30.000Z',
    direction: 'in',
    dedupeKey: 'ENS2025079|1027|2026-08-27T05:15:30.000Z',
    raw: { vendor: 'fkweb', verificationMethod: 'face' },
    ...over,
  }
}

const eventKey = (e: NormalizedEvent) => ({ sort: e.scannedAt, id: e.dedupeKey })

const waitFor = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('timed out waiting for condition')
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dest-'))
}

// ── config loading ───────────────────────────────────────────────────────────

test('no destinations file keeps the old single-sink behaviour', () => {
  // Every deployment that predates fan-out must keep working untouched.
  assert.deepEqual(loadDestinations(NOWHERE, undefined, { SINK: 'supabase' }), [
    { id: 'supabase-primary', type: 'supabase', enabled: true },
  ])
  assert.equal(loadDestinations(NOWHERE, undefined, { SINK: 'app' })[0]?.type, 'app')
  // And the default when SINK is unset at all.
  assert.equal(loadDestinations(NOWHERE, undefined, {})[0]?.type, 'supabase')
})

test('a secret written into the YAML is refused at boot', () => {
  // The file is reviewed in a diff and committed to git. A credential in it is
  // a credential in the repository.
  assert.throws(
    () => loadDestinations(NOWHERE, `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook
    auth: { kind: bearer, secret: hunter2 }
`, {}),
    /auth.secret is not supported/
  )
})

test('a destination naming an unset environment variable fails at boot', () => {
  // Not at the first scan, when someone is standing at the reader.
  assert.throws(
    () => loadDestinations(NOWHERE, `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook
    auth: { kind: bearer, secret_env: PARTNER_TOKEN }
`, {}),
    /PARTNER_TOKEN, which is not set/
  )

  const ok = loadDestinations(NOWHERE, `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook
    auth: { kind: bearer, secret_env: PARTNER_TOKEN }
`, { PARTNER_TOKEN: 'live-token' })
  assert.equal(ok[0]?.auth?.secretEnv, 'PARTNER_TOKEN')
})

test('a credential smuggled into the url or headers is refused', () => {
  const withQuery = `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook?token=abc123
`
  assert.throws(() => loadDestinations(NOWHERE, withQuery, {}), /carries a credential/)

  const withHeader = `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook
    headers: { authorization: "Bearer abc123" }
`
  assert.throws(() => loadDestinations(NOWHERE, withHeader, {}), /use auth.secretEnv/)
})

test('ids are constrained because they name the spool directory', () => {
  assert.throws(() => loadDestinations(NOWHERE, `
destinations:
  - id: n8n/payroll
    type: supabase
`, {}), /expected lowercase letters/)

  assert.throws(() => loadDestinations(NOWHERE, `
destinations:
  - id: dupe
    type: supabase
  - id: dupe
    type: app
`, {}), /duplicate destination id/)
})

test('a webhook destination must say where to post', () => {
  assert.throws(() => loadDestinations(NOWHERE, `
destinations:
  - id: partner
    type: webhook
`, {}), /has no url/)
})

test('disabling every destination is refused rather than silently spooling forever', () => {
  assert.throws(() => loadDestinations(NOWHERE, `
destinations:
  - id: supabase-primary
    type: supabase
    enabled: false
`, {}), /every destination is disabled/)
})

test('a template that is not valid JSON is caught at boot', () => {
  assert.throws(() => loadDestinations(NOWHERE, `
destinations:
  - id: partner
    type: webhook
    url: https://partner.example/hook
    format: single
    template: '{ "employee": {{externalUserId}} '
`, {}), /not valid JSON/)
})

// ── the generic webhook ──────────────────────────────────────────────────────

function captureServer(reply: (n: number) => { status: number; body: string }) {
  const seen: { headers: http.IncomingHttpHeaders; body: string }[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      seen.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      const out = reply(seen.length)
      res.writeHead(out.status, { 'content-type': 'application/json' })
      res.end(out.body)
    })
  })
  return {
    seen,
    listen: (): Promise<string> => new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`))
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

const webhook = (over: Partial<DestinationConfig>): DestinationConfig => ({
  id: 'partner', type: 'webhook', enabled: true, format: 'batch', ...over,
})

test('a batch webhook posts the events and signs the exact bytes', async () => {
  const srv = captureServer(() => ({ status: 200, body: '{}' }))
  const url = await srv.listen()
  const secret = 's'.repeat(32)

  try {
    const sink = webhookEventSink(
      webhook({ url, auth: { kind: 'hmac', secretEnv: 'HOOK_SECRET' } }),
      { HOOK_SECRET: secret }
    )
    assert.equal(await sink([event()]), 'ok')

    const req = srv.seen[0]!
    const expected = createHmac('sha256', secret).update(req.body, 'utf8').digest('hex')
    assert.equal(req.headers['x-signature'], expected, 'signature covers the bytes actually sent')

    const parsed = JSON.parse(req.body) as { events: NormalizedEvent[] }
    assert.equal(parsed.events[0]?.dedupeKey, 'ENS2025079|1027|2026-08-27T05:15:30.000Z')
  } finally {
    await srv.close()
  }
})

test('bearer and custom-header auth put the secret where the receiver expects it', async () => {
  const srv = captureServer(() => ({ status: 200, body: '{}' }))
  const url = await srv.listen()

  try {
    await webhookEventSink(webhook({ url, auth: { kind: 'bearer', secretEnv: 'T' } }), { T: 'abc' })([event()])
    assert.equal(srv.seen[0]?.headers.authorization, 'Bearer abc')

    await webhookEventSink(
      webhook({ url, auth: { kind: 'header', secretEnv: 'T', header: 'x-api-key' } }), { T: 'abc' }
    )([event()])
    assert.equal(srv.seen[1]?.headers['x-api-key'], 'abc')
  } finally {
    await srv.close()
  }
})

test('a permanently-rejecting webhook is dropped, not retried forever', async () => {
  // A 422 at the head of a queue would block every scan behind it. The scan is
  // not lost — the other destinations and the raw archive still have it.
  const srv = captureServer(() => ({ status: 422, body: '{"error":"unknown field"}' }))
  const url = await srv.listen()
  try {
    assert.equal(await webhookEventSink(webhook({ url }), {})([event()]), 'drop')
  } finally {
    await srv.close()
  }
})

test('a server error is transient, so the scan stays queued', async () => {
  const srv = captureServer(() => ({ status: 503, body: '' }))
  const url = await srv.listen()
  try {
    assert.equal(await webhookEventSink(webhook({ url }), {})([event()]), 'retry')
  } finally {
    await srv.close()
  }
})

test('an unreachable webhook is transient too', async () => {
  // Nothing is listening on this port.
  const sink = webhookEventSink(webhook({ url: 'http://127.0.0.1:1/hook' }), {})
  assert.equal(await sink([event()]), 'retry')
})

test('format single sends one request per scan, shaped by the template', async () => {
  const srv = captureServer(() => ({ status: 200, body: '{}' }))
  const url = await srv.listen()

  try {
    const sink = webhookEventSink(webhook({
      url,
      format: 'single',
      template: '{"employee_ref":"{{externalUserId}}","at":"{{scannedAt}}","how":"{{raw.verificationMethod}}"}',
    }), {})

    assert.equal(await sink([event(), event({ externalUserId: '1031', dedupeKey: 'x|1031|y' })]), 'ok')
    assert.equal(srv.seen.length, 2)
    assert.deepEqual(JSON.parse(srv.seen[0]!.body), {
      employee_ref: '1027', at: '2026-08-27T05:15:30.000Z', how: 'face',
    })
    assert.equal((JSON.parse(srv.seen[1]!.body) as { employee_ref: string }).employee_ref, '1031')
  } finally {
    await srv.close()
  }
})

test('template values are escaped so a device cannot break the body', () => {
  const rendered = renderTemplate(
    '{"serial":"{{deviceSerial}}"}',
    event({ deviceSerial: 'A"B\\C' })
  )
  assert.deepEqual(JSON.parse(rendered), { serial: 'A"B\\C' })
})

// ── isolation between destinations ───────────────────────────────────────────

test('a failing destination does not stall a healthy one', async () => {
  // The property the whole design exists for.
  const dir = tmpDir()
  try {
    const delivered: NormalizedEvent[] = []
    let partnerUp = false

    const healthy = createForwarder<NormalizedEvent>(path.join(dir, 'ok'), eventKey, {
      deliver: async (items) => { delivered.push(...items); return 'ok' },
      label: 'healthy',
    })
    const broken = createForwarder<NormalizedEvent>(path.join(dir, 'bad'), eventKey, {
      // Throwing is what an unreachable endpoint actually does, and it is what
      // records lastError — a plain 'retry' outcome is a normal backoff, not a
      // fault worth surfacing.
      deliver: async () => {
        if (!partnerUp) throw new Error('ECONNREFUSED')
        return 'ok'
      },
      label: 'broken',
    })

    const fanout = new Fanout([
      { config: { id: 'supabase-primary', type: 'supabase', enabled: true }, forwarder: healthy },
      { config: { id: 'partner', type: 'webhook', enabled: true }, forwarder: broken },
    ])
    fanout.start()
    fanout.submit([event()])

    // Supabase gets the punch immediately even though the partner is down.
    await waitFor(() => delivered.length === 1)
    assert.equal(healthy.pending, 0)
    assert.equal(broken.pending, 1, 'the partner keeps its own backlog')

    // And per-destination status makes the one-sided backlog visible.
    const status = fanout.destinations()
    assert.equal(status.find((d) => d.id === 'supabase-primary')?.pending, 0)
    assert.equal(status.find((d) => d.id === 'partner')?.pending, 1)
    assert.match(fanout.lastError ?? '', /^partner: /, 'the error names which destination failed')

    // When the partner recovers, its backlog drains on its own.
    partnerUp = true
    await waitFor(() => broken.pending === 0, 8000)

    fanout.stop()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('filters route a subset without touching the other queues', async () => {
  const dir = tmpDir()
  try {
    const hq: NormalizedEvent[] = []
    const all: NormalizedEvent[] = []

    const hqOnly = createForwarder<NormalizedEvent>(path.join(dir, 'hq'), eventKey, {
      deliver: async (items) => { hq.push(...items); return 'ok' }, label: 'hq',
    })
    const everything = createForwarder<NormalizedEvent>(path.join(dir, 'all'), eventKey, {
      deliver: async (items) => { all.push(...items); return 'ok' }, label: 'all',
    })

    const branches = new Map([['ENS2025079', 'hq'], ['TFT500P-0042', 'branch-02']])
    const fanout = new Fanout(
      [
        {
          config: { id: 'hq-bot', type: 'webhook', enabled: true, filter: { branches: ['hq'] } },
          forwarder: hqOnly,
        },
        { config: { id: 'supabase-primary', type: 'supabase', enabled: true }, forwarder: everything },
      ],
      (serial) => branches.get(serial) ?? null
    )
    fanout.start()
    fanout.submit([event(), event({ deviceSerial: 'TFT500P-0042', dedupeKey: 'TFT500P-0042|9|z' })])

    await waitFor(() => all.length === 2 && hq.length === 1)
    assert.equal(hq[0]?.deviceSerial, 'ENS2025079')
    fanout.stop()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a scan with no reported direction is never filtered out', () => {
  // The app resolves direction from the device row afterwards. Dropping such a
  // scan here would silently lose punches from readers that report nothing.
  const branchOf = () => 'hq'
  assert.equal(matches({ directions: ['out'] }, event({ direction: null }), branchOf), true)
  assert.equal(matches({ directions: ['out'] }, event({ direction: 'in' }), branchOf), false)
  assert.equal(matches({ directions: ['out'] }, event({ direction: 'out' }), branchOf), true)
})

test('a branch filter with no branch known for the device excludes it', () => {
  // Better a destination that misses a scan it was never told about than one
  // that receives another franchise's attendance.
  assert.equal(matches({ branches: ['hq'] }, event(), () => null), false)
  assert.equal(matches({ serials: ['OTHER'] }, event(), () => 'hq'), false)
  assert.equal(matches(undefined, event(), () => null), true, 'no filter means everything')
})
