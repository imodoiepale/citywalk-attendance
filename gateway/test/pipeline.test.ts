import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createCipheriv, createHmac, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { Spool } from '../src/spool.ts'
import { Forwarder, createForwarder } from '../src/forward.ts'
import { createServer } from '../src/server.ts'
import { appEventSink, sign } from '../src/sinks/app.ts'
import { supabaseEventSink, supabaseRawSink } from '../src/sinks/supabase.ts'
import { buildRawPayload } from '../src/archive.ts'
import { decryptCamsCallback } from '../src/vendors/cams/security.ts'
import type { Config } from '../src/config.ts'
import type { NormalizedEvent } from '../src/types.ts'
import type { Delivery } from '../src/sinks/types.ts'

// These cover the promises the parsers cannot: that a scan survives the
// destination being down, that what we send is what the destination expects,
// and that the allowlist actually holds.

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ss-'))
}

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    deviceSerial: 'ENS2025079',
    externalUserId: '1027',
    scannedAt: '2026-08-22T10:48:32.000Z',
    direction: 'in',
    dedupeKey: 'ENS2025079|1027|2026-08-22T10:48:32.000Z',
    raw: { vendor: 'ebkn' },
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

/** Records every request so a test can assert on the exact wire form. */
function captureServer(handler: (req: {
  method: string; url: string; headers: http.IncomingHttpHeaders; body: string
}) => { status: number; body: string }) {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = []

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const entry = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      seen.push(entry)
      const out = handler(entry)
      res.writeHead(out.status, { 'content-type': 'application/json' })
      res.end(out.body)
    })
  })

  return {
    seen,
    listen: (): Promise<string> =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
        })
      }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

// ── the Supabase sink: the live path ─────────────────────────────────────────

test('supabase sink calls the ingest RPC with the events as p_events', async () => {
  const srv = captureServer(() => ({ status: 200, body: JSON.stringify({ processed: 1 }) }))
  const url = await srv.listen()

  try {
    const sink = supabaseEventSink({ url, serviceRoleKey: 'service-role-key-'.padEnd(64, 'x') })
    assert.equal(await sink([event()]), 'ok')

    const req = srv.seen[0]!
    assert.equal(req.url, '/rest/v1/rpc/ingest_biometric_events')
    // Both are required by PostgREST; sending only one gets a 401 that looks
    // like a wrong key.
    assert.ok(req.headers.apikey, 'apikey header')
    assert.ok(String(req.headers.authorization).startsWith('Bearer '), 'bearer token')

    const parsed = JSON.parse(req.body) as { p_events: NormalizedEvent[] }
    assert.equal(parsed.p_events[0]?.dedupeKey, 'ENS2025079|1027|2026-08-22T10:48:32.000Z')
  } finally {
    await srv.close()
  }
})

test('supabase raw sink asks PostgREST to ignore duplicate payload keys', async () => {
  // Without this a redelivery after a crash is a unique violation that blocks
  // the queue head forever.
  const srv = captureServer(() => ({ status: 201, body: '' }))
  const url = await srv.listen()

  try {
    const sink = supabaseRawSink({ url, serviceRoleKey: 'k'.repeat(64) })
    const payload = buildRawPayload({
      body: Buffer.from('{"cmd":"ping"}'), transport: 'http', parsedEventCount: 0,
    })
    assert.equal(await sink([payload]), 'ok')

    const req = srv.seen[0]!
    assert.equal(req.url, '/rest/v1/device_raw_payloads')
    assert.match(String(req.headers.prefer), /ignore-duplicates/)
    assert.equal((JSON.parse(req.body) as { parsed_event_count: number }[])[0]?.parsed_event_count, 0)
  } finally {
    await srv.close()
  }
})

test('a missing ingest function is retried, not silently dropped', async () => {
  // The migration not being applied must not lose scans — it is a five-minute
  // fix, and the queue should still be there afterwards.
  const srv = captureServer(() => ({ status: 404, body: JSON.stringify({ code: 'PGRST202' }) }))
  const url = await srv.listen()
  try {
    const sink = supabaseEventSink({ url, serviceRoleKey: 'k'.repeat(64) })
    assert.equal(await sink([event()]), 'retry')
  } finally {
    await srv.close()
  }
})

test('a missing raw table is dropped so it cannot stall the punch queue', async () => {
  const srv = captureServer(() => ({ status: 404, body: '{}' }))
  const url = await srv.listen()
  try {
    const sink = supabaseRawSink({ url, serviceRoleKey: 'k'.repeat(64) })
    assert.equal(await sink([buildRawPayload({
      body: Buffer.from('x'), transport: 'http', parsedEventCount: 0,
    })]), 'drop')
  } finally {
    await srv.close()
  }
})

// ── the app sink: the alternative path ───────────────────────────────────────

test('the signature the gateway sends is the one the app computes', () => {
  const body = JSON.stringify({ events: [event()] })
  const secret = 'a'.repeat(64)
  assert.equal(sign(body, secret), createHmac('sha256', secret).update(body, 'utf8').digest('hex'))
})

test('a batch is accepted by an app verifying the signature the real way', async () => {
  const secret = 'b'.repeat(64)
  let valid = false

  const srv = captureServer((req) => {
    // Exactly what lib/biometric/auth.ts does: HMAC over the raw bytes,
    // timing-safe compared. If gateway and app ever disagree about what gets
    // signed, this fails here instead of as a 401 on a live device.
    const expected = createHmac('sha256', secret).update(req.body, 'utf8').digest('hex')
    const provided = String(req.headers['x-signature'] ?? '').trim().toLowerCase()
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(provided, 'utf8')
    valid = a.length === b.length && timingSafeEqual(a, b)
    return { status: valid ? 200 : 401, body: '{}' }
  })
  const url = await srv.listen()

  try {
    assert.equal(await appEventSink({ appUrl: url, secret })([event()]), 'ok')
    assert.equal(valid, true)
    assert.match(srv.seen[0]!.url, /^\/api\/biometric\/events\?vendor=/)
  } finally {
    await srv.close()
  }
})

// ── durability, independent of sink ──────────────────────────────────────────

test('a scan survives the destination being down and drains when it returns', async () => {
  // The failure this prevents is the one that matters most: an outage during
  // the morning rush meaning nobody clocked in that day.
  const dir = tmpDir()
  try {
    let up = false
    const delivered: NormalizedEvent[] = []
    const flaky: Delivery<NormalizedEvent> = async (items) => {
      if (!up) return 'retry'
      delivered.push(...items)
      return 'ok'
    }

    const f = createForwarder<NormalizedEvent>(dir, eventKey, { deliver: flaky, label: 't' })
    f.start()
    f.submit([event()])

    await waitFor(() => f.pending === 1)
    // On disk, not in memory: a fresh process finds it.
    assert.equal(new Spool<NormalizedEvent>(dir, eventKey).pending, 1)

    up = true
    await waitFor(() => delivered.length === 1, 8000)
    await waitFor(() => f.pending === 0)
    assert.equal(delivered[0]?.externalUserId, '1027')
    f.stop()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("a 'drop' outcome clears the item instead of wedging the queue", async () => {
  const dir = tmpDir()
  try {
    const f = createForwarder<NormalizedEvent>(dir, eventKey, {
      deliver: async () => 'drop',
      label: 't',
    })
    f.start()
    f.submit([event()])
    await waitFor(() => f.pending === 0)
    assert.equal(f.totals.dropped, 1)
    assert.equal(f.totals.forwarded, 0, 'dropped is not counted as delivered')
    f.stop()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a delivery that throws is treated as transient, not as loss', async () => {
  const dir = tmpDir()
  try {
    const f = createForwarder<NormalizedEvent>(dir, eventKey, {
      deliver: async () => { throw new Error('ECONNREFUSED') },
      label: 't',
    })
    f.start()
    f.submit([event()])
    await waitFor(() => f.lastError !== null)
    assert.equal(f.pending, 1)
    assert.match(f.lastError ?? '', /ECONNREFUSED/)
    f.stop()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the same scan spooled twice occupies one slot', () => {
  const dir = tmpDir()
  try {
    const spool = new Spool<NormalizedEvent>(dir, eventKey)
    spool.add(event())
    spool.add(event())
    assert.equal(spool.pending, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a corrupt spool entry is quarantined rather than blocking the queue', () => {
  const dir = tmpDir()
  try {
    const spool = new Spool<NormalizedEvent>(dir, eventKey)
    spool.add(event())
    fs.writeFileSync(path.join(dir, '0000-bad.json'), '{ truncated', 'utf8')

    assert.equal(spool.peek(10).length, 1, 'the good entry still comes through')
    assert.equal(spool.quarantined, 1, 'the bad one is kept as evidence, not deleted')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── server, allowlist, archive ───────────────────────────────────────────────

function config(over: Partial<Config> = {}): Config {
  return {
    sink: 'supabase',
    supabaseUrl: 'http://127.0.0.1:1',
    supabaseKey: 'k'.repeat(64),
    httpPort: 0,
    tcpPorts: [],
    spoolDir: 'unused',
    timezone: 'Africa/Nairobi',
    strictSerials: true,
    archiveRaw: true,
    camsAuthTokens: [],
    camsSecurityKey: undefined,
    devices: [{
      serial: 'ENS2025079', vendor: 'ebkn', mode: 'listen',
      timezone: 'Africa/Nairobi', direction: null, pollIntervalMs: 30_000,
    }],
    destinations: [{ id: 'supabase-primary', type: 'supabase', enabled: true }],
    ...over,
  }
}

function harness(cfg: Config) {
  const dir = tmpDir()
  const sunk: NormalizedEvent[] = []
  const archived: unknown[] = []

  const forwarder = createForwarder<NormalizedEvent>(path.join(dir, 'e'), eventKey, {
    deliver: async (items) => { sunk.push(...items); return 'ok' },
    label: 'events',
  })
  const archive = createForwarder(
    path.join(dir, 'r'),
    (p: { receivedAt: string; payloadKey: string }) => ({ sort: p.receivedAt, id: p.payloadKey }),
    { deliver: async (items) => { archived.push(...items); return 'ok' }, label: 'raw' }
  ) as unknown as Forwarder<never>

  forwarder.start()
  archive.start()

  const gateway = createServer({ config: cfg, forwarder, archive: archive as never })
  return {
    gateway,
    sunk,
    archived,
    /** submit() spools then drains asynchronously; tests must wait for the drain. */
    settled: () => waitFor(() => forwarder.pending === 0 && archive.pending === 0),
    dispose: () => {
      forwarder.stop()
      archive.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

const push = (body: string) => ({ body: Buffer.from(body) })

test('a push from a configured serial is accepted', async () => {
  const { gateway, settled, dispose } = harness(config())
  try {
    const r = gateway.handlePayload(
      push(JSON.stringify({ sn: 'ENS2025079', pin: '1027', time: '2026-08-22 13:48:32' })), 'test'
    )
    assert.equal(r.events.length, 1)
    assert.equal(r.rejected, 0)
    await settled()
  } finally { dispose() }
})

test('a push from an unknown serial is rejected while strict', async () => {
  // Without this the endpoint accepts fabricated attendance from anyone who can
  // reach it — the firmware cannot sign, so the allowlist is the door.
  const { gateway, settled, dispose } = harness(config())
  try {
    const r = gateway.handlePayload(
      push(JSON.stringify({ sn: 'NOT-OURS', pin: '1', time: '2026-08-22 13:48:32' })), 'test'
    )
    assert.equal(r.events.length, 0)
    assert.equal(r.rejected, 1)
    assert.equal(gateway.stats.rejectedUnknownSerial, 1)
    await settled()
  } finally { dispose() }
})

test('STRICT_SERIALS=false lets an unknown device through, for capture', async () => {
  const { gateway, settled, dispose } = harness(config({ strictSerials: false }))
  try {
    const r = gateway.handlePayload(
      push(JSON.stringify({ sn: 'BRAND-NEW', pin: '1', time: '2026-08-22 13:48:32' })), 'test'
    )
    assert.equal(r.events.length, 1)
    await settled()
  } finally { dispose() }
})

test("a device's configured direction overrides what the firmware claims", async () => {
  // A reader physically wired as the exit door stays an exit door even when its
  // firmware reports every scan as a check-in.
  const cfg = config()
  cfg.devices[0]!.direction = 'out'
  const { gateway, settled, dispose } = harness(cfg)
  try {
    const r = gateway.handlePayload(
      push(JSON.stringify({ sn: 'ENS2025079', pin: '1027', time: '2026-08-22 13:48:32', status: '0' })), 'test'
    )
    assert.equal(r.events[0]?.direction, 'out')
    await settled()
  } finally { dispose() }
})

test('an unreadable push is archived, not discarded', async () => {
  // The whole point of the raw archive: the payloads no parser understood are
  // the ones the next parser gets written from.
  const { gateway, archived, settled, dispose } = harness(config())
  try {
    const r = gateway.handlePayload(push('some frame we do not understand yet'), 'test')
    assert.equal(r.events.length, 0)
    assert.equal(gateway.stats.unparsed, 1)
    await settled()
    assert.equal(archived.length, 1)
    assert.equal((archived[0] as { parsedEventCount: number }).parsedEventCount, 0)
    assert.equal((archived[0] as { bodyText: string }).bodyText, 'some frame we do not understand yet')
  } finally { dispose() }
})

test('a successful push is archived alongside the events', async () => {
  const { gateway, archived, settled, dispose } = harness(config())
  try {
    gateway.handlePayload(
      push(JSON.stringify({ sn: 'ENS2025079', pin: '1027', time: '2026-08-22 13:48:32' })), 'test'
    )
    await settled()
    assert.equal(archived.length, 1)
    assert.equal((archived[0] as { parsedEventCount: number }).parsedEventCount, 1)
    assert.equal((archived[0] as { vendor: string }).vendor, 'ebkn')
  } finally { dispose() }
})

test('a binary frame survives the archive intact', async () => {
  const { gateway, archived, settled, dispose } = harness(config())
  try {
    const frame = Buffer.from([0x45, 0x42, 0x4b, 0x4e, 0x00, 0xff, 0xfe, 0x80])
    gateway.handlePayload({ body: frame }, 'test')
    await settled()
    const row = archived[0] as { bodyText: string | null; bodyBase64: string; bytes: number }
    assert.equal(row.bodyText, null, 'binary is not stored as mojibake')
    assert.equal(Buffer.from(row.bodyBase64, 'base64').equals(frame), true)
    assert.equal(row.bytes, 8)
  } finally { dispose() }
})

test('the archive keeps diagnostic headers but not credentials', async () => {
  const { gateway, archived, settled, dispose } = harness(config())
  try {
    gateway.handlePayload(
      {
        body: Buffer.from('x'),
        headers: {
          'content-type': 'text/plain',
          'user-agent': 'EBKN/1.0',
          cookie: 'session=super-secret',
          authorization: 'Bearer super-secret',
        },
      },
      'test'
    )
    await settled()
    const kept = (archived[0] as { headers: Record<string, string> }).headers
    assert.equal(kept['user-agent'], 'EBKN/1.0')
    assert.equal(kept.cookie, undefined, 'cookies must not land in an audit table')
    assert.equal(kept.authorization, undefined)
  } finally { dispose() }
})

test('the archive redacts Cams tokens and biometric template data', () => {
  const payload = buildRawPayload({
    body: Buffer.from(JSON.stringify({
      RealTime: {
        AuthToken: 'secret-callback-token',
        UserUpdated: {
          Template: [{ Type: 'Fingerprint', UserID: '7', Data: 'base64-biometric-template' }],
        },
      },
    })),
    transport: 'http',
    path: '/callbacks/cams',
    parsedEventCount: 0,
  })

  assert.equal(payload.bodyText?.includes('secret-callback-token'), false)
  assert.equal(payload.bodyText?.includes('base64-biometric-template'), false)
  assert.match(payload.bodyText ?? '', /REDACTED/)
})

async function listenGateway(cfg: Config) {
  const h = harness(cfg)
  h.gateway.listen()
  if (!h.gateway.server.listening) await once(h.gateway.server, 'listening')
  const address = h.gateway.server.address()
  if (!address || typeof address === 'string') throw new Error('gateway did not bind TCP')
  return {
    ...h,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve) => h.gateway.server.close(() => resolve()))
      h.dispose()
    },
  }
}

const camsBody = (token: string) => JSON.stringify({
  RealTime: {
    OperationID: 'cams-http-test',
    SerialNumber: 'ENS2025079',
    PunchLog: {
      Type: 'CheckIn', InputType: 'Face', UserId: '1027',
      LogTime: '2026-08-22 13:48:32 GMT +0300',
    },
    AuthToken: token,
    Time: '2026-08-22 10:48:32 GMT +0000',
  },
})

test('Cams callback validates AuthToken and returns the required done acknowledgement', async () => {
  const h = await listenGateway(config({ camsAuthTokens: ['correct-token'] }))
  try {
    const invalid = await fetch(`${h.url}/callbacks/cams`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: camsBody('wrong-token'),
    })
    assert.equal(invalid.status, 401)

    const valid = await fetch(`${h.url}/callbacks/cams`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: camsBody('correct-token'),
    })
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), { status: 'done' })
    await h.settled()
    assert.equal(h.sunk.length, 1)
  } finally {
    await h.close()
  }
})

test('Cams AES-256-ECB callbacks decrypt before token validation and parsing', async () => {
  const key = '12345678901234567890123456789012'
  const cipher = createCipheriv('aes-256-ecb', Buffer.from(key, 'utf8'), null)
  cipher.setAutoPadding(true)
  const encrypted = Buffer.concat([cipher.update(camsBody('encrypted-token')), cipher.final()]).toString('base64')
  assert.equal(decryptCamsCallback(Buffer.from(encrypted), key).toString('utf8'), camsBody('encrypted-token'))

  const h = await listenGateway(config({
    camsAuthTokens: ['encrypted-token'],
    camsSecurityKey: key,
  }))
  try {
    const response = await fetch(`${h.url}/callbacks/cams`, { method: 'POST', body: encrypted })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'done' })
    await h.settled()
    assert.equal(h.sunk.length, 1)
  } finally {
    await h.close()
  }
})
