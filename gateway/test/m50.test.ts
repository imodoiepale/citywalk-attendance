import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.M50_TOKEN_SECRET ??= 'test-secret'

import { parseM50Message, buildM50Response, m50TimeParts } from '../src/vendors/m50/protocol.ts'
import { m50Parser } from '../src/vendors/m50/push.ts'
import type { M50Raw } from '../src/vendors/m50/push.ts'
import { M50Session, m50TokenFor, serverTime } from '../src/vendors/m50/session.ts'

// Frames are copied from the vendor document verbatim, stray whitespace and
// all — `<Response> TimeLog_v2 </Response>` is how the vendor writes it, and a
// parser that only handles the tidy form is a parser that fails on hardware.

const SERIAL = 'M82-0001'
const TZ = 'Africa/Nairobi'

function frame(inner: string): Buffer {
  return Buffer.from(`<?xml version="1.0"?>\n<Message>\n${inner}\n</Message>`, 'utf8')
}

const REGISTER = frame(
  `<Request>Register</Request><TerminalType>M82</TerminalType>` +
  `<DeviceSerialNo>${SERIAL}</DeviceSerialNo><CloudId>cloudid12345678</CloudId>`
)

function loginFrame(token: string): Buffer {
  return frame(`<Request>Login</Request><DeviceSerialNo>${SERIAL}</DeviceSerialNo><Token>${token}</Token>`)
}

const TIMELOG = frame(
  `<TerminalType>M82</TerminalType><TerminalID>1</TerminalID>` +
  `<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event> TimeLog_v2</Event>` +
  `<LogID>24</LogID><UtcTimezoneMinutes>180</UtcTimezoneMinutes>` +
  `<Time>2026-08-29-T08:15:30Z</Time><UserID>42</UserID>` +
  `<Action>FP</Action><AttendStat>Duty On</AttendStat><APStat>None</APStat>` +
  `<JobCode>0</JobCode><Photo>Yes</Photo><LogImage>AAAAAAAA</LogImage><TransID>tx-7</TransID>`
)

/** A session wired to an in-memory transcript, with every serial allowed. */
function session(opts: { known?: boolean; deliver?: (body: Buffer, serial: string) => string | null } = {}) {
  const sent: string[] = []
  const s = new M50Session({
    from: 'test',
    strictSerials: true,
    knownSerial: () => opts.known ?? true,
    send: (t) => { sent.push(t) },
    deliver: opts.deliver ?? ((body, serial) => {
      const events = m50Parser.parse({ body, deviceSerial: serial, timezone: TZ })
      return events.length === 0 ? null : (m50Parser.ack?.({ body, timezone: TZ }, events) ?? null)
    }),
  })
  return { s, sent }
}

function tag(xml: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null
}

test('parses the vendor’s own padded and mistyped tags', () => {
  const padded = parseM50Message('<Message><Response> TimeLog_v2 </Response><Result>OK</Result></Message>')
  assert.equal(padded?.kind, 'response')
  assert.equal(padded?.name, 'TimeLog_v2')

  // `Reuqest` is the vendor document's own typo for GetUserData and friends.
  const typo = parseM50Message('<Message><Reuqest>GetUserData</Request><UserID>1</UserID></Message>')
  assert.equal(typo?.kind, 'request')
  assert.equal(typo?.name, 'GetUserData')

  assert.equal(parseM50Message('{"log_id":"1"}'), null, 'JSON must not be claimed as M50')
  assert.equal(parseM50Message('OK'), null)
})

test('the malformed timestamp the firmware actually sends is parseable', () => {
  // The stray hyphen before T is why `new Date()` returns Invalid Date here.
  assert.ok(Number.isNaN(new Date('2013-05-06-T11:09:30Z').getTime()))
  assert.deepEqual(m50TimeParts('2013-05-06-T11:09:30Z'), { y: 2013, mo: 5, d: 6, h: 11, mi: 9, s: 30 })
})

test('a device that is not logged in gets no acknowledgement for a scan', () => {
  const { s, sent } = session()
  assert.equal(s.handle(TIMELOG), true, 'the frame is still claimed as M50')
  assert.deepEqual(sent, [], 'but nothing is acknowledged before login')
})

test('full handshake: Register mints a token, Login accepts it, then a scan is acknowledged', () => {
  const { s, sent } = session()

  assert.equal(s.handle(REGISTER), true)
  const register = sent.at(-1)!
  assert.equal(tag(register, 'Result'), 'OK')
  assert.equal(tag(register, 'DeviceSerialNo'), SERIAL)
  const token = tag(register, 'Token')!
  assert.equal(token, m50TokenFor(SERIAL), 'the token is derived, so it survives a restart')
  assert.equal(s.stage, 'registered')

  assert.equal(s.handle(loginFrame(token)), true)
  assert.equal(tag(sent.at(-1)!, 'Result'), 'OK')
  assert.equal(s.stage, 'loggedIn')

  assert.equal(s.handle(TIMELOG), true)
  const ack = sent.at(-1)!
  assert.equal(tag(ack, 'Response'), 'TimeLog_v2', 'the reply must echo the event name')
  assert.equal(tag(ack, 'Result'), 'OK')
  assert.equal(tag(ack, 'TransID'), 'tx-7', 'without TransID the device cannot tick the record off')
})

test('a wrong token gets FailUnknownToken, which is what makes the device re-register', () => {
  const { s, sent } = session()
  s.handle(REGISTER)
  s.handle(loginFrame('11111111-2222-3333-4444-555555555555'))
  assert.equal(tag(sent.at(-1)!, 'Result'), 'FailUnknownToken')
  assert.equal(s.stage, 'registered', 'and the session does not advance')
})

test('an unknown serial is refused registration rather than silently accepted', () => {
  const { s, sent } = session({ known: false })
  s.handle(REGISTER)
  assert.equal(tag(sent.at(-1)!, 'Result'), 'Fail')
  assert.equal(tag(sent.at(-1)!, 'Token'), null, 'and is given no token')
})

test('a scan the pipeline rejects is answered Fail, so the device retains it', () => {
  const { s, sent } = session({ deliver: () => null })
  s.handle(REGISTER)
  s.handle(loginFrame(m50TokenFor(SERIAL)))
  s.handle(TIMELOG)
  assert.equal(tag(sent.at(-1)!, 'Result'), 'Fail')
  assert.equal(tag(sent.at(-1)!, 'TransID'), 'tx-7')
})

test('KeepAlive is answered with both clocks, and only after login', () => {
  const { s, sent } = session()
  const alive = frame(`<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event>KeepAlive</Event><DevTime>2026-08-29-T08:00:00Z</DevTime>`)

  s.handle(alive)
  assert.deepEqual(sent, [], 'not before login')

  s.handle(REGISTER)
  s.handle(loginFrame(m50TokenFor(SERIAL)))
  s.handle(alive)
  const reply = sent.at(-1)!
  assert.equal(tag(reply, 'Response'), 'KeepAlive')
  assert.equal(tag(reply, 'DevTime'), '2026-08-29-T08:00:00Z')
  assert.match(tag(reply, 'ServerTime')!, /^\d{4}-\d{2}-\d{2}-T\d{2}:\d{2}:\d{2}Z$/)
})

test('non-M50 frames are declined so the generic push path still works', () => {
  const { s, sent } = session()
  assert.equal(s.handle(Buffer.from('{"io_time":"20260829081530","user_id":"42"}')), false)
  assert.deepEqual(sent, [])
})

test('a TimeLog_v2 becomes one normalised event, image elided', () => {
  const events = m50Parser.parse({ body: TIMELOG, timezone: TZ })
  assert.equal(events.length, 1)
  const e = events[0]!

  assert.equal(e.deviceSerial, SERIAL)
  assert.equal(e.externalUserId, '42')
  assert.equal(e.direction, 'in', 'Duty On opens the interval')
  // 08:15:30 local at UTC+3 (UtcTimezoneMinutes 180) is 05:15:30Z.
  assert.equal(e.scannedAt, '2026-08-29T05:15:30.000Z')
  assert.equal(e.dedupeKey, `${SERIAL}|42|2026-08-29T05:15:30.000Z`)

  const raw = e.raw as M50Raw
  assert.equal(raw.timeBasis, 'offset')
  assert.equal(raw.action, 'FP')
  assert.equal(raw.transId, 'tx-7')
  assert.equal(raw.hasImage, true)
  assert.equal('LogImage' in raw.record, false, 'the capture photo must not ride along to every destination')
})

test('with no UtcTimezoneMinutes the device row’s zone resolves the wall clock', () => {
  const noOffset = frame(
    `<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event>TimeLog</Event>` +
    `<Time>2026-08-29-T08:15:30Z</Time><UserID>42</UserID><AttendStat>Duty Off</AttendStat>`
  )
  const e = m50Parser.parse({ body: noOffset, timezone: TZ })[0]!
  assert.equal((e.raw as M50Raw).timeBasis, 'zone')
  // Africa/Nairobi is UTC+3 year-round.
  assert.equal(e.scannedAt, '2026-08-29T05:15:30.000Z')
  assert.equal(e.direction, 'out')

  // And the acknowledgement echoes `TimeLog`, not `TimeLog_v2`.
  const ack = m50Parser.ack!({ body: noOffset, timezone: TZ }, [e])!
  assert.equal(tag(ack, 'Response'), 'TimeLog')
})

test('a scan missing a user or a time is dropped rather than guessed at', () => {
  const noUser = frame(`<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event>TimeLog_v2</Event><Time>2026-08-29-T08:15:30Z</Time>`)
  assert.deepEqual(m50Parser.parse({ body: noUser, timezone: TZ }), [])

  const noTime = frame(`<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event>TimeLog_v2</Event><UserID>42</UserID>`)
  assert.deepEqual(m50Parser.parse({ body: noTime, timezone: TZ }), [])
})

test('AdminLog is acknowledged but never forwarded as attendance', () => {
  const { s, sent } = session()
  s.handle(REGISTER)
  s.handle(loginFrame(m50TokenFor(SERIAL)))
  const admin = frame(
    `<DeviceSerialNo>${SERIAL}</DeviceSerialNo><Event>AdminLog_v2</Event>` +
    `<AdminID>1</AdminID><UserID>42</UserID><Action>EnrollFace</Action><TransID>tx-9</TransID>`
  )
  s.handle(admin)
  assert.equal(tag(sent.at(-1)!, 'Response'), 'AdminLog_v2')
  assert.equal(tag(sent.at(-1)!, 'Result'), 'OK')
  assert.deepEqual(m50Parser.parse({ body: admin, timezone: TZ }), [], 'and carries no punch')
})

test('responses carry no XML declaration, matching the reference server', () => {
  const xml = buildM50Response('Login', [['DeviceSerialNo', SERIAL], ['Result', 'OK'], ['Token', null]])
  assert.equal(xml, `<Message><Response>Login</Response><DeviceSerialNo>${SERIAL}</DeviceSerialNo><Result>OK</Result></Message>`)
  assert.match(serverTime(new Date('2022-12-28T20:02:43Z')), /^2022-12-28-T20:02:43Z$/)
})
