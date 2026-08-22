import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getParser } from '../src/vendors/index.ts'
import { parseAttlog } from '../src/vendors/zkteco/adms.ts'
import type { VendorInput } from '../src/types.ts'

const TZ = 'Africa/Nairobi'

function input(body: string, extra: Partial<VendorInput> = {}): VendorInput {
  return { body: Buffer.from(body, 'utf8'), timezone: TZ, ...extra }
}

// ── EBKN ─────────────────────────────────────────────────────────────────────
// Until a real capture exists these assert the tolerance the parser promises,
// not a confirmed wire format. When Phase 0 lands a fixture, add it here and
// tighten — do not delete these: the estate will not all be on one firmware.

test('ebkn: JSON with vendor-typical field names', () => {
  const events = getParser('ebkn').parse(
    input(JSON.stringify({ sn: 'ENS2025079', enrollid: '1027', time: '2026-08-22 13:48:32', mode: '3' }))
  )

  assert.equal(events.length, 1)
  assert.deepEqual(
    { ...events[0], raw: undefined },
    {
      deviceSerial: 'ENS2025079',
      externalUserId: '1027',
      scannedAt: '2026-08-22T10:48:32.000Z',
      direction: null,
      dedupeKey: 'ENS2025079|1027|2026-08-22T10:48:32.000Z',
      raw: undefined,
    }
  )
  assert.equal((events[0]?.raw as { verificationMethod: string }).verificationMethod, 'face')
})

test('ebkn: records wrapped in an envelope key are found', () => {
  const events = getParser('ebkn').parse(
    input(JSON.stringify({
      cmd: 'sendlog',
      count: 2,
      record: [
        { enrollid: '1', time: '2026-08-22 08:00:00' },
        { enrollid: '2', time: '2026-08-22 08:01:00' },
      ],
    }), { deviceSerial: 'ENS2025079' })
  )
  assert.equal(events.length, 2)
  assert.deepEqual(events.map((e) => e.externalUserId), ['1', '2'])
})

test('ebkn: a serial on the envelope applies to every record inside it', () => {
  // The commonest real shape: the terminal states its serial once, then lists
  // the scans. Unwrapping to the records alone loses it and silently drops the
  // whole batch — which looks exactly like a device that is not sending.
  const events = getParser('ebkn').parse(
    input(JSON.stringify({
      cmd: 'sendlog',
      sn: 'ENS2025079',
      count: 2,
      record: [
        { enrollid: '1027', time: '2026-08-22 13:48:32', mode: 3 },
        { enrollid: '1028', time: '2026-08-22 13:49:10', mode: 1 },
      ],
    }))
  )
  assert.equal(events.length, 2)
  assert.deepEqual(events.map((e) => e.deviceSerial), ['ENS2025079', 'ENS2025079'])
  assert.equal(events[0]?.externalUserId, '1027')
})

test('a record with its own serial beats the envelope it arrived in', () => {
  // A relay forwarding several readers' scans in one batch must still attribute
  // each scan to the reader that produced it.
  const events = getParser('ebkn').parse(
    input(JSON.stringify({
      sn: 'RELAY-1',
      record: [
        { sn: 'READER-A', enrollid: '1', time: '2026-08-22 08:00:00' },
        { enrollid: '2', time: '2026-08-22 08:01:00' },
      ],
    }))
  )
  assert.deepEqual(events.map((e) => e.deviceSerial), ['READER-A', 'RELAY-1'])
})

test('the inherited serial is plumbing and never appears in the archived raw', () => {
  const events = getParser('ebkn').parse(
    input(JSON.stringify({ sn: 'ENS2025079', record: [{ pin: '5', time: '2026-08-22 08:00:00' }] }))
  )
  const record = (events[0]?.raw as { record: Record<string, unknown> }).record
  assert.equal('__envelopeSerial' in record, false)
  assert.deepEqual(record, { pin: '5', time: '2026-08-22 08:00:00' })
})

test('ebkn: serial from the query string wins over config', () => {
  // A single endpoint serves the whole fleet, so a device naming itself has to
  // beat the fallback — otherwise every reader's scans land on one device row.
  const events = getParser('ebkn').parse(
    input(JSON.stringify({ pin: '7', time: '2026-08-22 09:00:00' }), {
      query: { SN: 'FROM-QUERY' },
      deviceSerial: 'FROM-CONFIG',
    })
  )
  assert.equal(events[0]?.deviceSerial, 'FROM-QUERY')
})

test('ebkn: form-encoded bodies are read', () => {
  const events = getParser('ebkn').parse(
    input('sn=ENS2025079&pin=1027&time=2026-08-22+13%3A48%3A32&status=1', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.direction, 'out')
})

test('ebkn: tab-delimited text falls back to positional parsing', () => {
  const events = getParser('ebkn').parse(
    input('1027\t2026-08-22 13:48:32\t0\t3\n1028\t2026-08-22 13:49:10\t1\t1\n', {
      deviceSerial: 'ENS2025079',
    })
  )
  assert.equal(events.length, 2)
  assert.equal(events[0]?.direction, 'in')
  assert.equal(events[1]?.direction, 'out')
})

test('ebkn: a record missing the timestamp is dropped, not invented', () => {
  // The failure this prevents: defaulting to "now" and writing a punch at the
  // wrong time, which is worse than no punch because nobody notices it.
  const events = getParser('ebkn').parse(
    input(JSON.stringify({ sn: 'ENS2025079', pin: '1027' }))
  )
  assert.deepEqual(events, [])
})

test('ebkn: heartbeats and handshakes produce no events without erroring', () => {
  assert.deepEqual(getParser('ebkn').parse(input(JSON.stringify({ cmd: 'ping' }))), [])
  assert.deepEqual(getParser('ebkn').parse(input('')), [])
  assert.deepEqual(getParser('ebkn').parse(input('{ not json')), [])
})

test('ebkn: binary frames are refused rather than mangled', () => {
  // A frame we cannot yet decode must return nothing, not a garbage event
  // built out of bytes that happened to look like digits.
  const binary = Buffer.from([0x45, 0x42, 0x4b, 0x4e, 0x01, 0x00, 0xff, 0xfe, 0x00, 0x00, 0x80, 0x01])
  assert.deepEqual(getParser('ebkn').parse({ body: binary, timezone: TZ }), [])
})

// ── ZKTeco ───────────────────────────────────────────────────────────────────

test('zkteco: ATTLOG matches the app adapter, including status mapping', () => {
  const events = parseAttlog(
    '1027\t2026-08-22 08:14:03\t0\t1\t0\t0\n1027\t2026-08-22 17:02:41\t1\t1\t0\t0\n',
    'TFT500P-0042',
    TZ
  )
  assert.equal(events.length, 2)
  assert.equal(events[0]?.direction, 'in')
  assert.equal(events[0]?.scannedAt, '2026-08-22T05:14:03.000Z')
  assert.equal(events[1]?.direction, 'out')
  assert.equal(events[0]?.dedupeKey, 'TFT500P-0042|1027|2026-08-22T05:14:03.000Z')
})

test('zkteco: an unknown status means "device did not say", not a guess', () => {
  const events = parseAttlog('1027\t2026-08-22 08:14:03\t9\t1\n', 'SN1', TZ)
  assert.equal(events[0]?.direction, null)
})

test('zkteco: only ATTLOG becomes punches', () => {
  // OPERLOG and template uploads hit the same endpoint. Clocking someone in
  // because an admin opened a menu would be wrong.
  const oper = getParser('zkteco').parse(
    input('1027\t2026-08-22 08:14:03\t0\t1\n', { query: { SN: 'SN1', table: 'OPERLOG' } })
  )
  assert.deepEqual(oper, [])

  const att = getParser('zkteco').parse(
    input('1027\t2026-08-22 08:14:03\t0\t1\n', { query: { SN: 'SN1', table: 'ATTLOG' } })
  )
  assert.equal(att.length, 1)
})

// ── generic ──────────────────────────────────────────────────────────────────

test('generic: the app-compatible payload shape round-trips', () => {
  const events = getParser('generic').parse(
    input(JSON.stringify({
      events: [{ device_serial: 'SN1', user_id: '42', scanned_at: '2026-08-22T05:14:03.000Z', direction: 'in' }],
    }))
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.scannedAt, '2026-08-22T05:14:03.000Z')
  assert.equal(events[0]?.direction, 'in')
})

test('an unknown vendor name falls back to generic instead of dropping the scan', () => {
  const events = getParser('some-reader-we-have-never-heard-of').parse(
    input(JSON.stringify({ sn: 'SN1', pin: '5', time: '2026-08-22 09:00:00' }))
  )
  assert.equal(events.length, 1)
})

// ── Cams Web API v3 ─────────────────────────────────────────────────────────

test('cams: RealTime.PunchLog becomes a normalized attendance event', () => {
  const events = getParser('cams').parse(input(JSON.stringify({
    RealTime: {
      OperationID: 'op-123',
      LabelName: 'HQ entrance',
      SerialNumber: 'ENS2025079',
      PunchLog: {
        Type: 'CheckOut',
        InputType: 'Fingerprint',
        UserId: '1027',
        LogTime: '2026-08-22 13:48:32 GMT +0300',
      },
      AuthToken: 'must-not-be-copied-into-the-event',
      Time: '2026-08-22 10:48:32 GMT +0000',
    },
  })))

  assert.equal(events.length, 1)
  assert.deepEqual(
    { ...events[0], raw: undefined },
    {
      deviceSerial: 'ENS2025079',
      externalUserId: '1027',
      scannedAt: '2026-08-22T10:48:32.000Z',
      direction: 'out',
      dedupeKey: 'ENS2025079|1027|2026-08-22T10:48:32.000Z',
      raw: undefined,
    }
  )
  assert.equal((events[0]?.raw as { operationId: string }).operationId, 'op-123')
  assert.equal(JSON.stringify(events[0]?.raw).includes('must-not-be-copied'), false)
})

test('cams: non-attendance callbacks are acknowledged by the server but not parsed as punches', () => {
  const events = getParser('cams').parse(input(JSON.stringify({
    RealTime: {
      SerialNumber: 'ENS2025079',
      AuthToken: 'token',
      UserUpdated: { UserID: '1027', OperationTime: '2026-08-22 13:48:32 GMT +0300' },
    },
  })))
  assert.deepEqual(events, [])
})

// ── idempotency ──────────────────────────────────────────────────────────────

test('dedupeKey is stable across re-delivery of the same scan', () => {
  // The property the whole no-duplicate-punch guarantee rests on: a terminal
  // replaying its buffer after an outage must produce identical keys, so the
  // app's unique index absorbs them.
  const body = JSON.stringify({ sn: 'ENS2025079', pin: '1027', time: '2026-08-22 13:48:32' })
  const first = getParser('ebkn').parse(input(body))
  const second = getParser('ebkn').parse(input(body))
  assert.equal(first[0]?.dedupeKey, second[0]?.dedupeKey)
})

test('dedupeKey distinguishes two scans a second apart', () => {
  const a = getParser('ebkn').parse(input(JSON.stringify({ sn: 'S', pin: '1', time: '2026-08-22 13:48:32' })))
  const b = getParser('ebkn').parse(input(JSON.stringify({ sn: 'S', pin: '1', time: '2026-08-22 13:48:33' })))
  assert.notEqual(a[0]?.dedupeKey, b[0]?.dedupeKey)
})
