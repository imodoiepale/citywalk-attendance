import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeM82Body, parseM82Push, readM82DeviceInfo, readM82Enrollment, m82Parser,
} from '../src/vendors/m82/push.ts'
import { getParser } from '../src/vendors/index.ts'
import type { VendorInput } from '../src/types.ts'

// Fixtures are the bytes an EN-K190FTW running M82 v3.15.988 actually sent on
// 2026-08-28, not invented shapes. Where a value looks odd — verify_mode of 10,
// a user_id zero-padded to eight digits, a punch dated months in the past —
// that is the device's behaviour and the test exists to keep us honest about it.

/** Builds a body the way the firmware does: uint32 LE length, JSON, then blobs. */
const frame = (json: unknown, blobs = Buffer.alloc(0)): Buffer => {
  const body = Buffer.from(JSON.stringify(json), 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length, 0)
  return Buffer.concat([len, body, blobs])
}

const GLOG = {
  fk_bin_data_lib: 'M50',
  user_id: '00000001',
  verify_mode: 10,
  io_mode: 1,
  io_time: '20251106123055',
}

const ENROLL = {
  user_id: '00000001',
  user_name: 'mesh',
  user_privilege: 0,
  user_photo: 'BIN_1',
  user_enabled: 1,
  user_depart_id: 0,
  enroll_data_array: [
    { backup_number: 0, enroll_data: 'BIN_2' },
    { backup_number: 1, enroll_data: 'BIN_3' },
    { backup_number: 2, enroll_data: 'BIN_4' },
    { backup_number: 12, enroll_data: 'BIN_5' },
  ],
}

const HEARTBEAT = {
  fk_name: 'M82',
  fk_time: '20260828102922',
  fk_info: {
    supported_enroll_data: ['FP', 'PASSWORD', 'IDCARD', 'QR', 'FACE'],
    fk_bin_data_lib: 'M50',
    firmware: 'M82 v3.15.988',
  },
}

const input = (
  requestCode: string,
  body: Buffer,
  extra: Partial<VendorInput> = {}
): VendorInput => ({
  body,
  headers: { request_code: requestCode, dev_id: 'ENS2025079' },
  timezone: 'Africa/Nairobi',
  ...extra,
})

test('decodes the uint32-LE length prefix and separates trailing blobs', () => {
  const blobs = Buffer.from([0xff, 0xd8, 0xff, 0xe0])   // JFIF magic
  const decoded = decodeM82Body(frame(GLOG, blobs))

  assert.deepEqual(decoded.json, GLOG)
  assert.equal(decoded.declaredLength, Buffer.byteLength(JSON.stringify(GLOG)))
  assert.deepEqual(decoded.blobs, blobs)
})

test('refuses a frame whose declared length exceeds the buffer', () => {
  // Truncation must not be guessed at: a half-read block is not a record.
  const body = frame(GLOG)
  const truncated = body.subarray(0, body.length - 10)
  const decoded = decodeM82Body(truncated)

  assert.equal(decoded.json, null)
  assert.equal(decoded.blobs.length, 0)
})

test('survives a body too short to hold a length prefix', () => {
  const decoded = decodeM82Body(Buffer.from([0x01, 0x02]))
  assert.equal(decoded.json, null)
  assert.equal(decoded.declaredLength, null)
})

test('turns realtime_glog into one event, taking the serial from the header', () => {
  const events = parseM82Push(input('realtime_glog', frame(GLOG)))

  assert.equal(events.length, 1)
  const [event] = events
  // The serial lives ONLY in the dev_id header on this firmware.
  assert.equal(event.deviceSerial, 'ENS2025079')
  assert.equal(event.externalUserId, '00000001')
  // 2025-11-06 12:30:55 in Africa/Nairobi (UTC+3) is 09:30:55Z.
  assert.equal(event.scannedAt, '2025-11-06T09:30:55.000Z')
})

test('does not guess a direction from io_mode', () => {
  // io_mode is present and the shared mapper would read 1 as "out". One
  // observed value from one device is not a mapping, and null defers to the
  // app's device row rather than stamping the estate's punches as exits.
  const [event] = parseM82Push(input('realtime_glog', frame(GLOG)))
  assert.equal(event.direction, null)
})

test('keeps verify_mode verbatim rather than forcing it into the 0-4 table', () => {
  const [event] = parseM82Push(input('realtime_glog', frame(GLOG)))
  const raw = event.raw as { verifyMode: unknown; verificationMethod: unknown }

  assert.equal(raw.verifyMode, 10)
  // 10 is outside the table every other module assumes. Passing the code
  // through unlabelled is the honest outcome; a confident wrong label is not.
  assert.equal(raw.verificationMethod, '10')
})

test('produces a dedupe key stable across the firmware\'s endless retries', () => {
  const first = parseM82Push(input('realtime_glog', frame(GLOG)))
  const second = parseM82Push(input('realtime_glog', frame(GLOG)))

  // The device re-sends the same record indefinitely because the ack is
  // unsolved. Ingestion stays idempotent only if this holds.
  assert.equal(first[0].dedupeKey, second[0].dedupeKey)
})

test('emits no attendance event for heartbeats or enrolment pushes', () => {
  assert.deepEqual(parseM82Push(input('receive_cmd', frame(HEARTBEAT))), [])
  assert.deepEqual(parseM82Push(input('realtime_enroll_data', frame(ENROLL))), [])
})

test('ignores a payload with no request_code rather than claiming it', () => {
  // Claiming a frame it does not own would let this parser win the candidate
  // race in server.ts against the vendor that really owns the device.
  const events = parseM82Push({ body: frame(GLOG), headers: {}, timezone: 'UTC' })
  assert.deepEqual(events, [])
})

test('reads the device inventory the heartbeat volunteers', () => {
  const info = readM82DeviceInfo(input('receive_cmd', frame(HEARTBEAT)))

  assert.equal(info?.model, 'M82')
  assert.equal(info?.firmware, 'M82 v3.15.988')
  assert.equal(info?.serial, 'ENS2025079')
  assert.deepEqual(info?.supportedEnrollData, ['FP', 'PASSWORD', 'IDCARD', 'QR', 'FACE'])
})

test('reads an enrolment push, counting attachment bytes without reassembling', () => {
  const blobs = Buffer.alloc(712, 0x41)
  const enrollment = readM82Enrollment(input('realtime_enroll_data', frame(ENROLL, blobs)))

  assert.equal(enrollment?.externalUserId, '00000001')
  assert.equal(enrollment?.name, 'mesh')
  assert.equal(enrollment?.photoRef, 'BIN_1')
  assert.equal(enrollment?.enabled, true)
  assert.deepEqual(
    enrollment?.credentials.map((c) => c.backupNumber),
    [0, 1, 2, 12]
  )
  // Blocks beyond the first have never been observed, so the bytes are counted
  // and not stitched together.
  assert.equal(enrollment?.blobBytes, 712)
})

test('returns no acknowledgement string, because none was found to work', () => {
  // Nine body shapes, an empty body and eight header variants all left the
  // retry rate unchanged. See docs/m82-protocol.md section 6.
  assert.equal(m82Parser.ack?.(input('realtime_glog', frame(GLOG)), []), null)
})

test('is reachable through the vendor registry', () => {
  assert.equal(getParser('m82').name, 'm82')
})
