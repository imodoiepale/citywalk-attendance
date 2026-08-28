import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createForwarder } from '../src/forward.ts'
import { createServer, type M82CredentialCapture } from '../src/server.ts'
import type { Config } from '../src/config.ts'
import type { NormalizedEvent, VendorInput } from '../src/types.ts'

// The server, not the parser, owns the acknowledgement for realtime_enroll_data
// pushes — because it is the one holding the in-progress block assembly. These
// tests exercise that decision directly through handlePayload, the same seam
// fkweb.test.ts uses.

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'm82-enroll-'))
}

function config(over: Partial<Config> = {}): Config {
  return {
    sink: 'supabase',
    supabaseUrl: 'http://127.0.0.1:1',
    supabaseKey: 'k'.repeat(64),
    httpPort: 0,
    tcpPorts: [0],
    cloudPort: 0,
    spoolDir: 'unused',
    timezone: 'Africa/Nairobi',
    strictSerials: true,
    archiveRaw: false,
    camsAuthTokens: [],
    camsSecurityKey: undefined,
    devices: [{
      serial: 'ENS2025079', vendor: 'm82', mode: 'listen',
      timezone: 'Africa/Nairobi', direction: null, pollIntervalMs: 30_000, branch: 'hq',
    }],
    destinations: [{ id: 'supabase-primary', type: 'supabase', enabled: true }],
    ...over,
  }
}

const lenPrefixed = (json: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(json), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length, 0)
  return Buffer.concat([len, body])
}

const blobFrame = (bytes: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32LE(bytes.length, 0)
  return Buffer.concat([len, bytes])
}

const enrollInput = (body: Buffer, headers: Record<string, string> = {}): VendorInput => ({
  body,
  headers: { request_code: 'realtime_enroll_data', dev_id: 'ENS2025079', ...headers },
  timezone: 'Africa/Nairobi',
})

function harness(over: Partial<Config> = {}) {
  const dir = tmpDir()
  const forwarder = createForwarder<NormalizedEvent>(
    dir,
    (e) => ({ sort: e.scannedAt, id: e.dedupeKey }),
    { deliver: async () => 'ok', label: 'events' }
  )
  const credentials: M82CredentialCapture[] = []
  const gateway = createServer({
    config: config(over),
    forwarder,
    onM82Credential: (c) => credentials.push(c),
  })
  return { gateway, credentials, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('a single-block enrolment push is stored and acknowledged with 204', () => {
  const { gateway, credentials, cleanup } = harness()
  try {
    const body = Buffer.concat([
      lenPrefixed({
        user_id: '00000002',
        user_name: 'jamesepale',
        enroll_data_array: [{ backup_number: 1, enroll_data: 'BIN_1' }],
      }),
      blobFrame(Buffer.from('template-bytes-here')),
    ])

    const result = gateway.handlePayload(enrollInput(body), 'test')

    assert.equal(result.events.length, 0, 'enrolment is never an attendance event')
    assert.equal(result.ackStatus, 204, 'complete on the first block, so 204 immediately')
    assert.equal(credentials.length, 1)
    assert.equal(credentials[0]!.deviceSerial, 'ENS2025079')
    assert.equal(credentials[0]!.externalUserId, '00000002')
    assert.equal(credentials[0]!.name, 'jamesepale')
    assert.equal(credentials[0]!.backupNumber, 1)
    assert.equal(Buffer.from(credentials[0]!.templateBase64, 'base64').toString('utf8'), 'template-bytes-here')
  } finally {
    cleanup()
  }
})

test('a credential slot with no captured data is not stored', () => {
  // The device reserves a slot before it is filled, giving it a real BIN_N
  // reference but a zero-length blob. Storing that would put an empty
  // "template" in front of whatever consumes it later.
  const { gateway, credentials, cleanup } = harness()
  try {
    const body = Buffer.concat([
      lenPrefixed({
        user_id: '00000002',
        enroll_data_array: [{ backup_number: 1, enroll_data: 'BIN_1' }],
      }),
      blobFrame(Buffer.alloc(0)),
    ])

    gateway.handlePayload(enrollInput(body), 'test')
    assert.equal(credentials.length, 0)
  } finally {
    cleanup()
  }
})

test('a mid-assembly block is NOT acknowledged, so the device keeps sending', () => {
  // Confirming block 1 before the rest have arrived risks the device
  // concluding the whole transfer is delivered and never sending block 2 —
  // see the comment on the M82_ENROLL branch in server.ts.
  const { gateway, credentials, cleanup } = harness()
  try {
    const whole = Buffer.concat([
      lenPrefixed({
        user_id: '00000002',
        enroll_data_array: [{ backup_number: 1, enroll_data: 'BIN_1' }],
      }),
      blobFrame(Buffer.alloc(500, 0x41)),
    ])
    const midpoint = Math.floor(whole.length / 2)

    const first = gateway.handlePayload(
      enrollInput(whole.subarray(0, midpoint), { blk_no: '1' }), 'test'
    )
    assert.equal(first.ackStatus, null, 'no opinion while assembly is incomplete')
    assert.equal(credentials.length, 0, 'nothing stored from a partial payload')

    const second = gateway.handlePayload(
      enrollInput(whole.subarray(midpoint), { blk_no: '2' }), 'test'
    )
    assert.equal(second.ackStatus, 204)
    assert.equal(credentials.length, 1)
  } finally {
    cleanup()
  }
})

test('multiple credential slots in one push each produce their own capture', () => {
  const { gateway, credentials, cleanup } = harness()
  try {
    const body = Buffer.concat([
      lenPrefixed({
        user_id: '00000002',
        user_name: 'jamesepale',
        enroll_data_array: [
          { backup_number: 0, enroll_data: 'BIN_1' },
          { backup_number: 1, enroll_data: 'BIN_2' },
        ],
      }),
      blobFrame(Buffer.from('finger-0')),
      blobFrame(Buffer.from('finger-1')),
    ])

    gateway.handlePayload(enrollInput(body), 'test')

    assert.equal(credentials.length, 2)
    assert.deepEqual(credentials.map((c) => c.backupNumber), [0, 1])
    assert.equal(Buffer.from(credentials[0]!.templateBase64, 'base64').toString(), 'finger-0')
    assert.equal(Buffer.from(credentials[1]!.templateBase64, 'base64').toString(), 'finger-1')
  } finally {
    cleanup()
  }
})

test('an enrolment push with no onM82Credential hook configured does not throw', () => {
  const dir = tmpDir()
  const forwarder = createForwarder<NormalizedEvent>(
    dir, (e) => ({ sort: e.scannedAt, id: e.dedupeKey }), { deliver: async () => 'ok', label: 'events' }
  )
  const gateway = createServer({ config: config(), forwarder })   // no onM82Credential

  try {
    const body = Buffer.concat([
      lenPrefixed({ user_id: '1', enroll_data_array: [{ backup_number: 0, enroll_data: 'BIN_1' }] }),
      blobFrame(Buffer.from('x')),
    ])
    const result = gateway.handlePayload(enrollInput(body), 'test')
    assert.equal(result.ackStatus, 204, 'still acknowledged: the device must not retry forever over a missing hook')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the heartbeat is answered 200 WITH a length-prefixed body, not a bare 200', () => {
  // A bare 200 with no body left a device holding 37 locally-logged punches
  // sending none of them; the difference that fixed it was a real body in the
  // device's own wire format, not merely the status code. Regressing this back
  // to "just answer 200" reintroduces a bug with no test failure to catch it —
  // the heartbeat itself keeps a clean cadence either way, so only checking
  // ackBody catches the difference.
  const { gateway, cleanup } = harness()
  try {
    const heartbeatJson = {
      fk_name: 'M82', fk_time: '20260828120000',
      fk_info: { supported_enroll_data: ['FP', 'FACE'], firmware: 'M82 v3.15.988' },
    }
    const json = Buffer.from(JSON.stringify(heartbeatJson), 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(json.length, 0)

    const result = gateway.handlePayload(
      { body: Buffer.concat([len, json]), headers: { request_code: 'receive_cmd', dev_id: 'ENS2025079' }, timezone: 'Africa/Nairobi' },
      'test'
    )

    assert.equal(result.ackStatus, 200)
    assert.ok(result.ackBody, 'the heartbeat reply must carry a body, not just a status')
    assert.ok(result.ackBody!.length > 4, 'must be a real length-prefixed frame, not an empty placeholder')

    // And it must actually be readable in the device's own framing.
    const declaredLen = result.ackBody!.readUInt32LE(0)
    const decoded = JSON.parse(result.ackBody!.subarray(4, 4 + declaredLen).toString('utf8'))
    assert.ok(decoded && typeof decoded === 'object')
  } finally {
    cleanup()
  }
})
