import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { toInstant } from '../../time.ts'
import { decode } from '../decode.ts'
import {
  DIRECTION_KEYS, METHOD_KEYS, SERIAL_KEYS, USER_KEYS,
  isRecord, pick, toDirection, toRows, toVerificationMethod, withoutSynthetic,
} from '../fields.ts'

// FkWeb — the native real-time push protocol of the FK/EBKN terminal family
// (EN-K190FTW and relatives, and every FK6xx/FK7xx/FK8xx in the vendor's model
// dictionary). This is the mode the terminal calls "Server-Client Mode: FkWeb".
//
// Unlike ebkn/push.ts, this parser is NOT a tolerant guess. It is written from
// the vendor's own server-side implementation, recovered from the IL of
// AttendanceTracker 11.8 (Realsoft engine) — specifically the
// `axRealSvrOcxTcp1_OnReceiveGLogText*` handlers, which are the reference
// consumers of this exact wire format. See docs/fkweb-protocol.md in the
// reverse-engineering workspace for the derivation.
//
// THE ACK IS THE WHOLE POINT. The terminal opens a TCP connection, sends one
// JSON object, and waits for a JSON reply. Without that reply it treats the
// scan as undelivered and re-sends it — forever. A listener that accepts bytes
// and stays silent looks, from the terminal's side, exactly like a listener
// that is not there. This is why passively sniffing port 5005 produced nothing
// usable, and it is the single reason the gateway can now talk to these
// terminals directly instead of via the vendor's Windows software.

/** The device's own field names. Fixed by the firmware, not guessed. */
const LOG_ID = ['log_id', 'logId', 'logid']
const IMAGE_KEYS = ['image', 'img', 'photo', 'log_image', 'logImage', 'capture']
const TEMP_KEYS = ['temperature', 'temp']

// `io_time` is this firmware's timestamp field and `fk_device_id` its serial.
// Kept local rather than pushed into the shared key lists so that the generic
// parser cannot claim an FkWeb frame: whichever parser claims a frame is the
// one asked for the acknowledgement, and generic has none to give.
const FKWEB_TIME_KEYS = ['io_time', 'ioTime', 'iotime']
const FKWEB_SERIAL_KEYS = ['fk_device_id', 'fkDeviceId', 'fk_deviceid', 'device_id', 'deviceId']
// The firmware does not always report a direction. When it does not, null is
// the honest answer and the app falls back to the device row — which is correct
// for a reader physically wired as the exit door.
const FKWEB_DIRECTION_KEYS = ['io_mode', 'ioMode', 'io_state', 'in_out_mode', ...DIRECTION_KEYS]

export interface FkWebRaw {
  vendor: 'fkweb'
  logId: string | null
  verificationMethod: string | null
  temperature: number | null
  hasImage: boolean
  record: Record<string, unknown>
}

/**
 * True when this payload is FkWeb rather than some other JSON a device sent.
 *
 * Deliberately strict: it must carry the firmware's own timestamp field AND a
 * user. Claiming a frame we cannot acknowledge would leave the terminal
 * retrying in a loop, so being wrong in this direction is expensive.
 */
function looksLikeFkWeb(row: Record<string, unknown>): boolean {
  return pick(row, FKWEB_TIME_KEYS) !== null && pick(row, USER_KEYS) !== null
}

function fromRow(
  row: Record<string, unknown>,
  fallbackSerial: string | null,
  tz: string
): NormalizedEvent | null {
  if (!looksLikeFkWeb(row)) return null

  const deviceSerial = pick(row, [...FKWEB_SERIAL_KEYS, ...SERIAL_KEYS]) ?? fallbackSerial
  const externalUserId = pick(row, USER_KEYS)
  const rawTime = pick(row, FKWEB_TIME_KEYS)

  // All three are load-bearing. Inventing any of them — "now" for a missing
  // timestamp, say — would put a wrong time on someone's shift.
  if (!deviceSerial || !externalUserId || !rawTime) return null

  // `io_time` is compact local wall-clock, `yyyyMMddHHmmss`, resolved against
  // the device's configured zone by toInstant().
  const scannedAt = toInstant(rawTime, tz)
  if (!scannedAt) return null

  const iso = scannedAt.toISOString()

  // Temperature is a screening reading on the thermal models. It is kept for
  // the audit trail but never gates a punch: a device with a miscalibrated
  // sensor must not be able to stop someone clocking in.
  const tempText = pick(row, TEMP_KEYS)
  const tempValue = tempText === null ? Number.NaN : Number(tempText)
  const temperature = Number.isFinite(tempValue) && tempValue > 0 ? tempValue : null

  const raw: FkWebRaw = {
    vendor: 'fkweb',
    logId: pick(row, LOG_ID),
    verificationMethod: toVerificationMethod(pick(row, METHOD_KEYS)),
    temperature,
    // The capture photo can be hundreds of kilobytes of base64. It stays out of
    // the event — the verbatim body is already in the raw archive — because an
    // event is copied into every destination's spool and into every third-party
    // webhook, and a face image does not belong in any of those by default.
    hasImage: IMAGE_KEYS.some((k) => typeof row[k] === 'string' && (row[k] as string).length > 0),
    record: stripImage(withoutSynthetic(row)),
  }

  return {
    deviceSerial,
    externalUserId,
    scannedAt: iso,
    direction: toDirection(pick(row, FKWEB_DIRECTION_KEYS)),
    // Identical formula to every other vendor module, so the same scan arriving
    // by a different route — or during a cutover with two listeners live — is
    // one punch, not two.
    dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
    raw,
  }
}

/** Drops image blobs from the retained record, keeping their size as evidence. */
function stripImage(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row }
  for (const key of IMAGE_KEYS) {
    const value = copy[key]
    if (typeof value === 'string' && value.length > 0) copy[key] = `«${value.length} bytes elided»`
  }
  return copy
}

export function parseFkWebPush(input: VendorInput): NormalizedEvent[] {
  const tz = input.timezone ?? 'Africa/Nairobi'
  const decoded = decode(input.body, input.headers?.['content-type'])

  // Binary means this is not FkWeb — or is a frame type we have never seen.
  // Returning [] leaves the bytes in the raw archive for analysis rather than
  // guessing at them.
  if (decoded.kind !== 'json') return []

  const fallbackSerial =
    pickFrom(input.query, FKWEB_SERIAL_KEYS) ??
    pickFrom(input.query, SERIAL_KEYS) ??
    input.deviceSerial ??
    null

  return toRows(decoded.value)
    .map((row) => fromRow(row, fallbackSerial, tz))
    .filter((e): e is NormalizedEvent => e !== null)
}

function pickFrom(source: Record<string, string> | undefined, keys: string[]): string | null {
  if (!source) return null
  const lowered: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) lowered[k.toLowerCase()] = v
  return pick(lowered, keys.map((k) => k.toLowerCase()))
}

/**
 * The reply the terminal waits for.
 *
 * Byte-for-byte semantics taken from the vendor implementation:
 *
 *   {"log_id":"<echoed>","result":"OK","mode":"nothing"}
 *
 * `log_id` is echoed so the terminal can tick off which buffered record was
 * accepted — omit it and the device cannot match the reply to the record, and
 * re-sends. `mode:"nothing"` is the vendor's "no pending command for you";
 * it is what the reference implementation sends on every ordinary scan.
 *
 * Emitted as compact JSON. The vendor's own output is Newtonsoft's indented
 * form put through three String.Replace calls to squeeze it, which lands on
 * near-compact JSON with inconsistent spacing — the firmware is parsing JSON,
 * not matching a literal, so compact is both equivalent and cleaner.
 */
export function fkWebAck(_input: VendorInput, events: NormalizedEvent[]): string | null {
  if (events.length === 0) return null

  const raw = events[0]?.raw
  const logId = isRecord(raw) && typeof raw.logId === 'string' ? raw.logId : null

  const body: Record<string, string> = {}
  if (logId !== null) body.log_id = logId
  body.result = 'OK'
  body.mode = 'nothing'

  return JSON.stringify(body)
}

export const fkwebParser: VendorParser = {
  name: 'fkweb',
  parse: parseFkWebPush,
  ack: fkWebAck,
}
