import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import {
  Correlator, JsonStream, readPaged,
  CommandTimeoutError, DeviceGoneError,
  type CloudReply, type CloudRequest,
} from '../src/cloud/protocol.ts'
import { parseSendLog, parseSendUser, parseDeviceInfo, sendLogAck } from '../src/cloud/inbound.ts'
import { CloudServer } from '../src/cloud/session.ts'
import * as cmd from '../src/cloud/commands.ts'
import { SimulatedDevice } from '../src/probe/simulate-cloud.ts'
import { parseFkWebPush } from '../src/vendors/fkweb/push.ts'
import type { NormalizedEvent } from '../src/types.ts'
import type { CapturedCredential, DeviceInfo } from '../src/cloud/inbound.ts'

// The cloud protocol is UNVERIFIED against hardware. These tests pin our
// understanding of the spec so that when a real terminal disagrees, exactly one
// assumption fails visibly rather than a bug hiding in the gateway.

const waitFor = async (cond: () => boolean, ms = 5000, what = 'condition'): Promise<void> => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

// ── framing ──────────────────────────────────────────────────────────────────

test('a frame split across reads is reassembled', () => {
  // Raw TCP gives no message boundaries, so a single read routinely holds half
  // a frame. Treating that half as a message would drop every punch.
  const s = new JsonStream()
  assert.deepEqual(s.push('{"cmd":"reg","sn":'), [])
  assert.deepEqual(s.push('"ENS1"}'), [{ cmd: 'reg', sn: 'ENS1' }])
})

test('several frames in one read all come through, in order', () => {
  const s = new JsonStream()
  const out = s.push('{"cmd":"a"}{"cmd":"b"}\n{"cmd":"c"}')
  assert.deepEqual(out.map((m) => (m as CloudRequest).cmd), ['a', 'b', 'c'])
})

test('a brace inside a string does not end the frame early', () => {
  // Templates and names are attacker-adjacent free text. Naive brace counting
  // would truncate the frame and lose the credential.
  const s = new JsonStream()
  const out = s.push(JSON.stringify({ cmd: 'senduser', record: 'aaa}bbb{ccc', name: 'A "B" }' }))
  assert.equal(out.length, 1)
  assert.equal((out[0] as CloudRequest).record, 'aaa}bbb{ccc')
})

test('malformed JSON is skipped without stalling the stream behind it', () => {
  const s = new JsonStream()
  const out = s.push('{"broken":}{"cmd":"ok"}')
  assert.deepEqual(out.map((m) => (m as CloudRequest).cmd), [undefined, 'ok'].filter(Boolean))
})

test('an unbounded frame is refused rather than growing forever', () => {
  const s = new JsonStream(64)
  assert.throws(() => s.push('{'.padEnd(200, 'x')), /exceeded 64 bytes/)
})

// ── correlation: the constraint that makes this protocol usable ──────────────

test('only one command is in flight at a time', async () => {
  // There are no request ids. Two outstanding commands make the first reply
  // ambiguous, and a wrong match would answer the wrong question silently.
  const sent: string[] = []
  const c = new Correlator((text) => sent.push(text))

  const first = c.request({ cmd: 'getdevinfo' })
  const second = c.request({ cmd: 'reboot' })

  await waitFor(() => sent.length === 1, 1000, 'first command to be written')
  assert.equal(sent.length, 1, 'the second command waits its turn')
  assert.equal(c.queued, 1)

  c.accept({ ret: 'getdevinfo', result: true })
  assert.deepEqual(await first, { ret: 'getdevinfo', result: true })

  await waitFor(() => sent.length === 2, 1000, 'second command to be written')
  c.accept({ ret: 'reboot', result: true })
  assert.equal((await second).ret, 'reboot')
})

test('a reply for a different command is not accepted', async () => {
  const c = new Correlator(() => {})
  const pending = c.request({ cmd: 'getdevinfo' })

  assert.equal(c.accept({ ret: 'settime', result: true }), false, 'mismatched ret is refused')
  assert.equal(c.accept({ ret: 'getdevinfo', result: true }), true)
  assert.equal((await pending).ret, 'getdevinfo')
})

test('a silent device times out rather than hanging the caller forever', async () => {
  const c = new Correlator(() => {})
  await assert.rejects(c.request({ cmd: 'getdevinfo' }, 40), CommandTimeoutError)
})

test('a timeout releases the queue instead of wedging it', async () => {
  const sent: string[] = []
  const c = new Correlator((t) => sent.push(t))

  const first = c.request({ cmd: 'getdevinfo' }, 30)
  const second = c.request({ cmd: 'reboot' }, 500)

  await assert.rejects(first, CommandTimeoutError)
  await waitFor(() => sent.length === 2, 1000, 'the queued command to run after the timeout')
  c.accept({ ret: 'reboot', result: true })
  assert.equal((await second).ret, 'reboot')
})

test('a disconnect fails everything rather than leaving callers hanging', async () => {
  const c = new Correlator(() => {})
  const inFlight = c.request({ cmd: 'getdevinfo' })
  const queued = c.request({ cmd: 'reboot' })

  c.close('device went away')

  await assert.rejects(inFlight, DeviceGoneError)
  await assert.rejects(queued, DeviceGoneError)
})

// ── paged reads ──────────────────────────────────────────────────────────────

test('a paged read opens with stn true, continues with false, and terminates', async () => {
  const pages: CloudReply[] = [
    { ret: 'getallusers', result: true, record: [{ enrollid: 1 }, { enrollid: 2 }] },
    { ret: 'getallusers', result: true, record: [{ enrollid: 3 }] },
    { ret: 'getallusers', result: true, record: [] },
  ]
  const seen: unknown[] = []
  const rows = await readPaged(async (req) => {
    seen.push(req.stn)
    return pages.shift() as CloudReply
  }, 'getallusers')

  assert.deepEqual(seen, [true, false, false])
  assert.equal(rows.length, 3)
})

test('a firmware that never stops returning rows is bounded, not infinite', async () => {
  const rows = await readPaged(
    async () => ({ ret: 'getalllog', result: true, record: [{ enrollid: 1 }] }),
    'getalllog', {}, 5
  )
  assert.equal(rows.length, 5, 'stops at maxPages instead of looping forever')
})

// ── inbound message parsing ──────────────────────────────────────────────────

test('a cloud punch and the same FkWeb punch produce one dedupeKey, not two', () => {
  // The property that matters most during a cutover, when both transports may
  // be live: a device replaying its buffer must not create a second punch.
  const cloud = parseSendLog(
    { cmd: 'sendlog', sn: 'ENS2025079', count: 1,
      record: [{ enrollid: '1027', time: '2026-08-27 08:15:30', mode: 3, inout: 0 }] },
    null, 'Africa/Nairobi'
  )
  const fkweb = parseFkWebPush({
    body: Buffer.from(JSON.stringify({
      log_id: '1', user_id: '1027', fk_device_id: 'ENS2025079',
      io_time: '20260827081530', verify_mode: '3',
    })),
    timezone: 'Africa/Nairobi',
  })

  assert.equal(cloud.length, 1)
  assert.equal(cloud[0]?.dedupeKey, fkweb[0]?.dedupeKey)
  assert.equal(cloud[0]?.scannedAt, '2026-08-27T05:15:30.000Z')
})

test('mode is the verification method and inout is the direction', () => {
  // Reading `mode` as in/out would clock people in as they leave.
  const [e] = parseSendLog(
    { cmd: 'sendlog', sn: 'S', record: [{ enrollid: '1', time: '2026-08-27 08:15:30', mode: 3, inout: 1 }] },
    null, 'Africa/Nairobi'
  )
  assert.equal(e?.direction, 'out')
  assert.equal((e?.raw as { verificationMethod: string }).verificationMethod, 'face')
})

test('a punch missing a load-bearing field is skipped, not invented', () => {
  const events = parseSendLog(
    { cmd: 'sendlog', sn: 'S', record: [{ enrollid: '1' }, { time: '2026-08-27 08:15:30' }] },
    null, 'Africa/Nairobi'
  )
  assert.equal(events.length, 0)
})

test('the sendlog acknowledgement echoes what the device advances its pointer on', () => {
  const ack = sendLogAck({ cmd: 'sendlog', logindex: 48213 }, 2)
  assert.deepEqual(ack, { ret: 'sendlog', result: true, count: 2, logindex: 48213 })
})

test('registration yields inventory including the algorithm replication depends on', () => {
  const info = parseDeviceInfo({
    cmd: 'reg', sn: 'S',
    devinfo: { modelname: 'EN-K190FTW', firmware: '1.2.3', fpalgo: 'ZK10', usersize: 3000, useduser: 12 },
  })
  assert.equal(info?.modelname, 'EN-K190FTW')
  assert.equal(info?.fpalgo, 'ZK10')
  assert.equal(info?.capacity.usersize, 3000)
  assert.equal(info?.capacity.useduser, 12)
})

test('a captured credential needs a serial, a user and a template', () => {
  assert.equal(parseSendUser({ cmd: 'senduser', enrollid: '1', name: 'X' }, 'S'), null)
  const c = parseSendUser({ cmd: 'senduser', enrollid: '1', backupnum: 2, record: 'TPL' }, 'S')
  assert.deepEqual(c, {
    deviceSerial: 'S', externalUserId: '1', backupNum: 2, template: 'TPL', name: null, admin: null,
  })
})

// ── command builders ─────────────────────────────────────────────────────────

test('setuserinfo uses the vendor field names exactly', () => {
  assert.deepEqual(cmd.setUserInfo({ enrollId: 1027, backupNum: 0, record: 'TPL', name: 'A' }), {
    cmd: 'setuserinfo', enrollid: 1027, backupnum: 0, admin: 0, record: 'TPL', name: 'A',
  })
  // An empty name is omitted: some firmwares blank the stored name when handed one.
  assert.equal('name' in cmd.setUserInfo({ enrollId: 1, backupNum: 0, record: 'T' }), false)
})

test('setdevinfo sends only the fields the caller set', () => {
  // A present field is an instruction to these devices, so a default-filled
  // payload would silently reset settings nobody meant to touch.
  assert.deepEqual(cmd.setDeviceInfo({ volume: 3 }), { cmd: 'setdevinfo', volume: 3 })
})

test('settime sends device-local wall clock, not UTC', () => {
  // These terminals have no timezone concept. Sending UTC to a Nairobi reader
  // shifts every subsequent punch by three hours.
  const local = new Date(2026, 7, 27, 8, 15, 30)
  assert.deepEqual(cmd.setTime(local), { cmd: 'settime', cloudtime: '2026-08-27 08:15:30' })
})

test('enableuser maps a boolean to the enflag the device expects', () => {
  assert.deepEqual(cmd.enableUser(7, false), { cmd: 'enableuser', enrollid: 7, enflag: 0 })
})

// ── end to end, against the device simulator ─────────────────────────────────

interface Harness {
  server: CloudServer
  port: number
  events: NormalizedEvent[]
  credentials: CapturedCredential[]
  registrations: { serial: string; info: DeviceInfo | null }[]
  close(): void
}

async function freePort(): Promise<number> {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = (probe.address() as net.AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  return port
}

async function harness(known: string[] = ['ENS2025079'], strict = true): Promise<Harness> {
  const events: NormalizedEvent[] = []
  const credentials: CapturedCredential[] = []
  const registrations: { serial: string; info: DeviceInfo | null }[] = []

  const server = new CloudServer({
    timezone: 'Africa/Nairobi',
    strictSerials: strict,
    isKnownSerial: (s) => known.includes(s),
    deviceTimezone: () => 'Africa/Nairobi',
    onEvents: (e) => events.push(...e),
    onCapturedCredential: (c) => credentials.push(c),
    onRegister: (serial, info) => registrations.push({ serial, info }),
  })

  const port = await freePort()
  server.listen(port)
  await new Promise((r) => setTimeout(r, 50))
  return { server, port, events, credentials, registrations, close: () => server.close() }
}

test('a device registers over raw TCP and its inventory is captured', async () => {
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await device.connect()
    await waitFor(() => h.registrations.length === 1, 3000, 'registration')

    assert.equal(h.registrations[0]?.serial, 'ENS2025079')
    assert.equal(h.registrations[0]?.info?.modelname, 'EN-K190FTW')
    assert.equal(h.registrations[0]?.info?.capacity.usersize, 3000)
    assert.deepEqual(h.server.online(), ['ENS2025079'])
  } finally {
    device.close(); h.close()
  }
})

test('an unknown serial is refused and never becomes a session', async () => {
  // Auto-registering whatever dials in — as the vendor software does — would
  // let anyone who can reach the port enrol themselves a device.
  const h = await harness(['ENS2025079'])
  const device = new SimulatedDevice({ port: h.port, serial: 'NOT-OURS' })
  try {
    await device.connect()
    await new Promise((r) => setTimeout(r, 200))
    assert.deepEqual(h.server.online(), [])
    assert.equal(h.registrations.length, 0)
  } finally {
    device.close(); h.close()
  }
})

test('a punch pushed by a registered device reaches the fan-out', async () => {
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await device.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'registration')

    device.sendLog('1027', '2026-08-27 08:15:30')
    await waitFor(() => h.events.length === 1, 3000, 'the punch')

    assert.equal(h.events[0]?.externalUserId, '1027')
    assert.equal(h.events[0]?.dedupeKey, 'ENS2025079|1027|2026-08-27T05:15:30.000Z')
  } finally {
    device.close(); h.close()
  }
})

test('the gateway can command a device that dialled in', async () => {
  // The whole point of this channel: the device is behind NAT and we can never
  // dial it, so the connection it opened is the only route to it.
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await device.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'registration')

    const session = h.server.get('ENS2025079')!
    const reply = await session.request(
      cmd.setUserInfo({ enrollId: 1027, backupNum: 0, record: 'TPL-A', name: 'Asha' })
    )

    assert.equal(reply.result, true)
    assert.equal(device.users.get('1027')?.credentials.get(0), 'TPL-A')
    assert.equal(device.users.get('1027')?.name, 'Asha')
  } finally {
    device.close(); h.close()
  }
})

test('remote enrolment: adduser captures on the device and the template comes back', async () => {
  // adduser is asynchronous in reality — the device acknowledges, a human
  // presents a finger, and only then does senduser arrive.
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await device.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'registration')

    const session = h.server.get('ENS2025079')!
    const ack = await session.request(cmd.addUser(1031))
    assert.equal(ack.result, true)
    assert.equal(h.credentials.length, 0, 'the template does not arrive on the reply')

    await waitFor(() => h.credentials.length === 1, 3000, 'the captured credential')
    assert.equal(h.credentials[0]?.externalUserId, '1031')
    assert.equal(h.credentials[0]?.template, 'SIMULATED-TEMPLATE-1031')
  } finally {
    device.close(); h.close()
  }
})

test('a paged read collects every page from a real connection', async () => {
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079', pageSize: 2 })
  try {
    await device.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'registration')

    const session = h.server.get('ENS2025079')!
    for (const id of ['1', '2', '3', '4', '5']) {
      await session.request(cmd.setUserInfo({ enrollId: id, backupNum: 0, record: `T${id}` }))
    }

    const rows = await session.readPaged(cmd.GET_ALL_USERS)
    assert.equal(rows.length, 5, 'three pages of two, two, one')
  } finally {
    device.close(); h.close()
  }
})

test('a reconnect supersedes the stale session rather than shadowing it', async () => {
  // Without this, commands would be written to a socket nobody is reading.
  const h = await harness()
  const first = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  const second = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await first.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'first registration')
    const before = h.server.get('ENS2025079')

    await second.connect()
    await waitFor(() => h.registrations.length === 2, 3000, 'second registration')

    assert.equal(h.server.online().length, 1, 'still exactly one session for the serial')
    assert.notEqual(h.server.get('ENS2025079'), before, 'and it is the new one')
  } finally {
    first.close(); second.close(); h.close()
  }
})

test('a command to a device that has gone away fails instead of hanging', async () => {
  const h = await harness()
  const device = new SimulatedDevice({ port: h.port, serial: 'ENS2025079' })
  try {
    await device.connect()
    await waitFor(() => h.server.online().length === 1, 3000, 'registration')
    const session = h.server.get('ENS2025079')!

    device.close()
    await waitFor(() => h.server.online().length === 0, 3000, 'disconnect')

    await assert.rejects(session.request(cmd.reboot(), 500), DeviceGoneError)
  } finally {
    h.close()
  }
})
