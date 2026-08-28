import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { loadTemplateKeys, open, parseTemplateKey, seal, keyIdOf } from '../src/cloud/crypto.ts'
import { CommandQueue } from '../src/cloud/queue.ts'
import { CloudServer } from '../src/cloud/session.ts'
import { credentialTypeForSlot } from '../src/cloud/inbound.ts'
import { SimulatedDevice } from '../src/probe/simulate-cloud.ts'
import type { DeviceCommandRow, Persistence } from '../src/cloud/persistence.ts'

// Two things under test: that a template is unreadable without the key, and
// that the command queue does not lose or misdirect work.

const KEY = 'k'.repeat(32)

// ── template sealing ─────────────────────────────────────────────────────────

test('a sealed template round-trips', () => {
  const key = parseTemplateKey(Buffer.from(KEY).toString('base64'))
  const sealed = seal('TEMPLATE-DATA', key)
  assert.equal(open(sealed, [key]), 'TEMPLATE-DATA')
})

test('the ciphertext does not contain the plaintext', () => {
  // The whole point: a database dump must not be a biometric dataset.
  const key = parseTemplateKey(Buffer.from(KEY).toString('base64'))
  const sealed = seal('DISTINCTIVE-TEMPLATE', key)
  assert.equal(sealed.ciphertext.includes('DISTINCTIVE'), false)
  assert.equal(Buffer.from(sealed.ciphertext, 'base64').includes('DISTINCTIVE'), false)
})

test('sealing the same template twice gives different ciphertext', () => {
  // A deterministic ciphertext would leak that two people share a finger, or
  // that a template was re-enrolled unchanged.
  const key = parseTemplateKey(Buffer.from(KEY).toString('base64'))
  assert.notEqual(seal('T', key).ciphertext, seal('T', key).ciphertext)
})

test('a tampered template fails to open rather than yielding a wrong one', () => {
  // GCM is authenticated for exactly this reason: a silently corrupted template
  // pushed to a reader could let the wrong person through a door.
  const key = parseTemplateKey(Buffer.from(KEY).toString('base64'))
  const sealed = seal('TEMPLATE', key)

  const raw = Buffer.from(sealed.ciphertext, 'base64')
  raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1)
  assert.throws(() => open({ ...sealed, ciphertext: raw.toString('base64') }, [key]))
})

test('a template sealed with another key is refused, with a usable message', () => {
  const a = parseTemplateKey(Buffer.from('a'.repeat(32)).toString('base64'))
  const b = parseTemplateKey(Buffer.from('b'.repeat(32)).toString('base64'))
  assert.throws(() => open(seal('T', a), [b]), /no template key with id/)
})

test('key rotation keeps older rows readable', () => {
  // A rotation that made every existing credential undecryptable would mean
  // re-enrolling the entire estate.
  const oldKey = parseTemplateKey(Buffer.from('a'.repeat(32)).toString('base64'))
  const newKey = parseTemplateKey(Buffer.from('b'.repeat(32)).toString('base64'))
  const sealedOld = seal('OLD', oldKey)

  const keys = loadTemplateKeys({
    BIOMETRIC_TEMPLATE_KEY: Buffer.from('b'.repeat(32)).toString('base64'),
    BIOMETRIC_TEMPLATE_KEYS_PREVIOUS: Buffer.from('a'.repeat(32)).toString('base64'),
  })!

  assert.equal(keys.active.id, newKey.id)
  assert.equal(open(sealedOld, keys.all), 'OLD')
  assert.equal(open(seal('NEW', keys.active), keys.all), 'NEW')
})

test('a wrong-length key is refused at parse time, not at decrypt time', () => {
  // Padding or truncating would encrypt happily and be undecryptable later.
  assert.throws(() => parseTemplateKey('too-short'), /must be 32 bytes/)
  assert.throws(() => parseTemplateKey(randomBytes(16).toString('base64')), /must be 32 bytes/)
  assert.doesNotThrow(() => parseTemplateKey(randomBytes(32).toString('hex')))
  assert.doesNotThrow(() => parseTemplateKey(randomBytes(32).toString('base64')))
})

test('the key id is derived from the key and never contains it', () => {
  const material = Buffer.from(KEY)
  const id = keyIdOf(material)
  assert.equal(id.length, 16)
  assert.equal(id.includes('k'.repeat(8)), false)
  assert.equal(keyIdOf(material), id, 'stable across calls')
})

test('no configured key means no key, not a default one', () => {
  // Falling back to a built-in key would be worse than refusing: it would look
  // encrypted while being readable by anyone with the source.
  assert.equal(loadTemplateKeys({}), null)
})

test('credential slots map to types by the documented convention', () => {
  assert.equal(credentialTypeForSlot(0), 'fingerprint')
  assert.equal(credentialTypeForSlot(9), 'fingerprint')
  assert.equal(credentialTypeForSlot(10), 'password')
  assert.equal(credentialTypeForSlot(11), 'card')
  assert.equal(credentialTypeForSlot(50), 'face')
})

// ── the command queue ────────────────────────────────────────────────────────

function fakePersistence(queued: DeviceCommandRow[]) {
  const completed: { id: string; ok: boolean; result: unknown; error: string | null }[] = []
  const claims: string[][] = []

  const persistence: Persistence = {
    async registerDevice() {},
    async storeCapturedCredential() { return 'credential-id' },
    async claimCommands(onlineSerials, limit) {
      claims.push([...onlineSerials])
      const take = queued.filter((r) => onlineSerials.includes(r.serial_no)).slice(0, limit)
      for (const row of take) queued.splice(queued.indexOf(row), 1)
      return take
    },
    async completeCommand(id, ok, result, error) {
      completed.push({ id, ok, result, error })
    },
  }
  return { persistence, completed, claims }
}

const row = (over: Partial<DeviceCommandRow> = {}): DeviceCommandRow => ({
  id: `cmd-${Math.random().toString(36).slice(2, 8)}`,
  serial_no: 'ENS2025079',
  command: 'reboot',
  payload: {},
  attempts: 0,
  ...over,
})

test('only online devices have their commands claimed', async () => {
  // A command for an offline reader must stay queued until it dials back in.
  // Claiming and failing it would throw away work someone just asked for.
  const { persistence, claims } = fakePersistence([])
  const queue = new CommandQueue({
    persistence,
    sessionFor: () => undefined,
    onlineSerials: () => ['A', 'B'],
  })

  await queue.tick()
  assert.deepEqual(claims, [['A', 'B']])
})

test('nothing online means no round trip to the database at all', async () => {
  const { persistence, claims } = fakePersistence([])
  const queue = new CommandQueue({ persistence, sessionFor: () => undefined, onlineSerials: () => [] })

  assert.equal(await queue.tick(), 0)
  assert.equal(claims.length, 0)
})

async function freePort(): Promise<number> {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

async function liveDevice(serial = 'ENS2025079') {
  const server = new CloudServer({
    timezone: 'Africa/Nairobi',
    strictSerials: true,
    isKnownSerial: (s) => s === serial,
    deviceTimezone: () => 'Africa/Nairobi',
    onEvents: () => {},
    onCapturedCredential: () => {},
    onRegister: () => {},
  })
  const port = await freePort()
  server.listen(port)
  await new Promise((r) => setTimeout(r, 30))

  const device = new SimulatedDevice({ port, serial, pageSize: 2 })
  await device.connect()

  const deadline = Date.now() + 3000
  while (Date.now() < deadline && server.online().length === 0) {
    await new Promise((r) => setTimeout(r, 10))
  }

  return { server, device, close: () => { device.close(); server.close() } }
}

test('a claimed command reaches the device and its outcome is written back', async () => {
  const live = await liveDevice()
  const target = row({ command: 'setuserinfo', payload: { enrollid: 7, backupnum: 0, record: 'TPL' } })
  const { persistence, completed } = fakePersistence([target])

  const queue = new CommandQueue({
    persistence,
    sessionFor: (s) => live.server.get(s),
    onlineSerials: () => live.server.online(),
  })

  try {
    assert.equal(await queue.tick(), 1)
    assert.equal(live.device.users.get('7')?.credentials.get(0), 'TPL')
    assert.equal(completed.length, 1)
    assert.equal(completed[0]?.ok, true)
  } finally {
    live.close()
  }
})

test('a device that refuses is recorded as failed, not as success', async () => {
  // The device answered — that is a real outcome, not a transport problem, and
  // reporting it as success would leave an operator believing a credential
  // landed when it did not.
  const live = await liveDevice()
  const { persistence, completed } = fakePersistence([row({ command: 'getuserinfo', payload: { enrollid: 999, backupnum: 0 } })])

  const queue = new CommandQueue({
    persistence,
    sessionFor: (s) => live.server.get(s),
    onlineSerials: () => live.server.online(),
  })

  try {
    await queue.tick()
    assert.equal(completed[0]?.ok, false)
    assert.match(String(completed[0]?.error), /not found/)
  } finally {
    live.close()
  }
})

test('a paged command is run to completion and returns every row', async () => {
  const live = await liveDevice()
  const session = live.server.get('ENS2025079')!
  for (const id of ['1', '2', '3']) {
    await session.request({ cmd: 'setuserinfo', enrollid: id, backupnum: 0, record: `T${id}`, admin: 0 })
  }

  const { persistence, completed } = fakePersistence([row({ command: 'getallusers' })])
  const queue = new CommandQueue({
    persistence,
    sessionFor: (s) => live.server.get(s),
    onlineSerials: () => live.server.online(),
  })

  try {
    await queue.tick()
    assert.equal(completed[0]?.ok, true)
    assert.equal((completed[0]?.result as { count: number }).count, 3, 'two pages, then the empty one')
  } finally {
    live.close()
  }
})

test('commands for one device keep the order they were queued in', async () => {
  // Without per-device ordering, "write the template" and "enable the user"
  // could interleave across an await and arrive backwards.
  const live = await liveDevice()
  const rows = [
    row({ command: 'setuserinfo', payload: { enrollid: 1, backupnum: 0, record: 'first' } }),
    row({ command: 'setuserinfo', payload: { enrollid: 1, backupnum: 0, record: 'second' } }),
    row({ command: 'enableuser', payload: { enrollid: 1, enflag: 1 } }),
  ]
  const { persistence } = fakePersistence(rows)
  const queue = new CommandQueue({
    persistence,
    sessionFor: (s) => live.server.get(s),
    onlineSerials: () => live.server.online(),
  })

  try {
    await queue.tick()
    const seen = live.device.received.map((c) => c.cmd)
    assert.deepEqual(seen, ['setuserinfo', 'setuserinfo', 'enableuser'])
    assert.equal(live.device.users.get('1')?.credentials.get(0), 'second', 'the later write wins')
  } finally {
    live.close()
  }
})

test('a device that vanishes mid-batch fails visibly instead of hanging', async () => {
  const live = await liveDevice()
  const { persistence, completed } = fakePersistence([row({ command: 'reboot' })])
  const queue = new CommandQueue({
    persistence,
    sessionFor: () => undefined, // as if it disconnected between claim and send
    onlineSerials: () => live.server.online(),
  })

  try {
    await queue.tick()
    assert.equal(completed[0]?.ok, false)
    assert.match(String(completed[0]?.error), /disconnected/)
  } finally {
    live.close()
  }
})

test('overlapping ticks do not double-claim', async () => {
  const live = await liveDevice()
  const { persistence, claims } = fakePersistence([])
  const queue = new CommandQueue({
    persistence,
    sessionFor: (s) => live.server.get(s),
    onlineSerials: () => live.server.online(),
  })

  try {
    await Promise.all([queue.tick(), queue.tick(), queue.tick()])
    assert.equal(claims.length, 1, 'the concurrent ticks were suppressed')
  } finally {
    live.close()
  }
})
