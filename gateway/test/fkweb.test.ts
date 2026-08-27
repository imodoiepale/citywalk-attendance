import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createForwarder } from '../src/forward.ts'
import { createServer } from '../src/server.ts'
import { parseFkWebPush, fkWebAck, fkwebParser } from '../src/vendors/fkweb/push.ts'
import { getParser } from '../src/vendors/index.ts'
import { toInstant } from '../src/time.ts'
import type { Config } from '../src/config.ts'
import type { NormalizedEvent, VendorInput } from '../src/types.ts'

// The FkWeb parser is written from the terminal vendor's own server
// implementation rather than from a guess, so these tests pin the two things
// that implementation told us and that nothing else in the codebase can check:
// the field names on the wire, and the acknowledgement the terminal blocks on.
//
// Fixture shape, as consumed by the reference implementation's
// axRealSvrOcxTcp1_OnReceiveGLogText* handlers. See docs/fkweb-protocol.md in
// the reverse-engineering workspace.

const scan = (over: Record<string, unknown> = {}) => JSON.stringify({
  log_id: '4471',
  user_id: '1027',
  fk_device_id: 'ENS2025079',
  io_time: '20260827081530',
  verify_mode: '3',
  temperature: '0.0',
  ...over,
})

const input = (body: string, over: Partial<VendorInput> = {}): VendorInput => ({
  body: Buffer.from(body),
  timezone: 'Africa/Nairobi',
  ...over,
})

// ── the wire format ──────────────────────────────────────────────────────────

test('a FkWeb scan becomes one normalized event', () => {
  const events = parseFkWebPush(input(scan()))
  assert.equal(events.length, 1)

  const e = events[0]!
  assert.equal(e.deviceSerial, 'ENS2025079', 'serial comes from fk_device_id')
  assert.equal(e.externalUserId, '1027')
  // 08:15:30 Nairobi is 05:15:30 UTC. Getting this wrong shifts a whole
  // estate's punches by three hours, which is why it is asserted absolutely.
  assert.equal(e.scannedAt, '2026-08-27T05:15:30.000Z')
  assert.equal(e.dedupeKey, 'ENS2025079|1027|2026-08-27T05:15:30.000Z')
})

test('io_time is read as device-local wall clock, not as an epoch', () => {
  // 14 digits are a compact local timestamp. Read as a number it would land in
  // 1970 and every punch would be silently wrong rather than visibly missing.
  const at = toInstant('20260827081530', 'Africa/Nairobi')
  assert.equal(at?.toISOString(), '2026-08-27T05:15:30.000Z')
})

test('the same scan in a different zone resolves to a different instant', () => {
  const nairobi = parseFkWebPush(input(scan()))[0]
  const london = parseFkWebPush(input(scan(), { timezone: 'Europe/London' }))[0]
  assert.notEqual(nairobi?.scannedAt, london?.scannedAt)
})

test('verify_mode is kept as a readable method, not as a raw code', () => {
  const e = parseFkWebPush(input(scan({ verify_mode: '3' })))[0]
  assert.equal((e?.raw as { verificationMethod: string }).verificationMethod, 'face')
})

test('a thermal reading is retained but never gates the punch', () => {
  const hot = parseFkWebPush(input(scan({ temperature: '38.90' })))[0]
  assert.equal((hot?.raw as { temperature: number }).temperature, 38.9)
  assert.equal(hot?.externalUserId, '1027', 'a high reading still produces a punch')

  // The vendor's own sentinel for "no sensor / not measured".
  const none = parseFkWebPush(input(scan({ temperature: '0.0' })))[0]
  assert.equal((none?.raw as { temperature: number | null }).temperature, null)
})

test('a capture photo is noted but kept out of the event', () => {
  // The event is copied into every destination spool and posted to every
  // third-party webhook. A face image must not ride along by default.
  const big = 'A'.repeat(5000)
  const e = parseFkWebPush(input(scan({ image: big })))[0]
  const raw = e?.raw as { hasImage: boolean; record: Record<string, string> }

  const stored = raw.record.image ?? ''
  assert.equal(raw.hasImage, true)
  assert.equal(stored.includes(big), false, 'the blob is not carried in the event')
  assert.match(stored, /5000 bytes elided/)
})

test('a direction the firmware does not report stays null', () => {
  // Null means "the device did not say", and the app then uses the direction
  // configured on the device row — correct for a reader wired as the exit.
  // Guessing 'in' here would clock people in as they leave.
  assert.equal(parseFkWebPush(input(scan()))[0]?.direction, null)
  assert.equal(parseFkWebPush(input(scan({ io_mode: '1' })))[0]?.direction, 'out')
})

test('a scan missing any load-bearing field is skipped, not invented', () => {
  for (const missing of ['user_id', 'io_time'] as const) {
    const body = JSON.parse(scan()) as Record<string, unknown>
    delete body[missing]
    assert.equal(parseFkWebPush(input(JSON.stringify(body))).length, 0, `missing ${missing}`)
  }
})

test('a batch of scans in one frame all come through', () => {
  const body = JSON.stringify([
    JSON.parse(scan()),
    JSON.parse(scan({ log_id: '4472', user_id: '1031', io_time: '20260827081602' })),
  ])
  const events = parseFkWebPush(input(body))
  assert.equal(events.length, 2)
  assert.equal(events[1]?.externalUserId, '1031')
})

test('a payload that is not FkWeb is left for another parser', () => {
  // Claiming a frame we cannot acknowledge would leave the terminal retrying
  // forever, so the parser is strict about what it takes.
  assert.equal(parseFkWebPush(input(JSON.stringify({ sn: 'X', pin: '1', time: '2026-08-27 08:15:30' }))).length, 0)
  assert.equal(parseFkWebPush(input('not json at all')).length, 0)
  assert.equal(parseFkWebPush({ body: Buffer.from([0x00, 0xff, 0x01]) }).length, 0)
})

// ── the acknowledgement: the reason this protocol works at all ───────────────

test('the acknowledgement echoes log_id and reports OK', () => {
  // Recovered from the vendor implementation's SendRtLogResponseV3 call site.
  // The terminal matches the reply against the record it sent; without the
  // echoed log_id it cannot, and re-sends the scan indefinitely.
  const events = parseFkWebPush(input(scan()))
  const ack = fkWebAck(input(scan()), events)

  assert.deepEqual(JSON.parse(ack as string), {
    log_id: '4471',
    result: 'OK',
    mode: 'nothing',
  })
})

test('no scans means no acknowledgement', () => {
  assert.equal(fkWebAck(input(scan()), []), null)
})

test('the fkweb parser is registered and carries its ack', () => {
  const parser = getParser('fkweb')
  assert.equal(parser.name, 'fkweb')
  assert.equal(typeof parser.ack, 'function')
  assert.equal(parser, fkwebParser)
})

// ── end to end over raw TCP, which is how the terminal actually connects ─────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fkweb-'))
}

function config(over: Partial<Config> = {}): Config {
  return {
    sink: 'supabase',
    supabaseUrl: 'http://127.0.0.1:1',
    supabaseKey: 'k'.repeat(64),
    httpPort: 0,
    tcpPorts: [0],
    spoolDir: 'unused',
    timezone: 'Africa/Nairobi',
    strictSerials: true,
    archiveRaw: false,
    camsAuthTokens: [],
    camsSecurityKey: undefined,
    devices: [{
      serial: 'ENS2025079', vendor: 'fkweb', mode: 'listen',
      timezone: 'Africa/Nairobi', direction: null, pollIntervalMs: 30_000, branch: 'hq',
    }],
    destinations: [{ id: 'supabase-primary', type: 'supabase', enabled: true }],
    ...over,
  }
}

/** A port nothing is on, so the gateway can be told to bind it explicitly. */
async function freePort(): Promise<number> {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

test('a terminal dialling the TCP port gets its acknowledgement back', async () => {
  // The whole reason the gateway can talk to these terminals directly: the
  // device opens a socket, sends one JSON scan, and waits for a JSON reply.
  const dir = tmpDir()
  const sunk: NormalizedEvent[] = []
  const forwarder = createForwarder<NormalizedEvent>(
    dir,
    (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
    { deliver: async (items) => { sunk.push(...items); return 'ok' }, label: 'events' }
  )

  const port = await freePort()
  const gateway = createServer({ config: config({ tcpPorts: [port] }), forwarder })
  gateway.listen()

  const socket = net.createConnection({ port, host: '127.0.0.1' })
  try {
    await once(socket, 'connect')
    socket.write(scan())

    const [reply] = (await once(socket, 'data')) as [Buffer]
    assert.deepEqual(JSON.parse(reply.toString('utf8')), {
      log_id: '4471', result: 'OK', mode: 'nothing',
    })

    // And the scan really did land, rather than only being acknowledged.
    assert.equal(gateway.stats.accepted, 1)
  } finally {
    socket.destroy()
    gateway.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an unknown serial gets no acknowledgement, so the terminal keeps the scan', async () => {
  // Silence is the correct answer here. Telling an unlisted device "OK" would
  // make it discard a scan we did not record; staying quiet makes it retry, and
  // adding the serial to devices.yaml recovers the whole buffered window.
  const dir = tmpDir()
  const forwarder = createForwarder<NormalizedEvent>(
    dir,
    (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
    { deliver: async () => 'ok', label: 'events' }
  )
  const gateway = createServer({ config: config(), forwarder })

  try {
    const result = gateway.handlePayload(
      { body: Buffer.from(scan({ fk_device_id: 'NOT-OURS' })), timezone: 'Africa/Nairobi' },
      'test'
    )
    assert.equal(result.events.length, 0)
    assert.equal(result.rejected, 1)
    assert.equal(result.ack, null, 'a rejected device must not be told OK')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an accepted scan is acknowledged and identifies its vendor', async () => {
  const dir = tmpDir()
  const forwarder = createForwarder<NormalizedEvent>(
    dir,
    (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
    { deliver: async () => 'ok', label: 'events' }
  )
  const gateway = createServer({ config: config(), forwarder })

  try {
    const result = gateway.handlePayload(
      { body: Buffer.from(scan()), timezone: 'Africa/Nairobi' },
      'test'
    )
    assert.equal(result.events.length, 1)
    assert.equal(result.vendor, 'fkweb')
    assert.deepEqual(JSON.parse(result.ack as string), {
      log_id: '4471', result: 'OK', mode: 'nothing',
    })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
