import type { Direction } from '../types.ts'

// Every one of these systems names the same four facts differently — the
// enrollment number is `pin` on one firmware, `user_id` on the next, `enrollid`
// on a third. Rather than a parser per spelling, all vendor modules pull fields
// through here.
//
// This deliberately mirrors the tolerance already in the app's generic adapter
// (lib/biometric/adapters/generic.ts). The gateway does it too because it sees
// payloads the app never will — form-encoded bodies, delimited text, binary
// frames — and normalising early keeps the vendor modules to their real job.

export const USER_KEYS = [
  'external_user_id', 'externalUserId', 'user_id', 'userId', 'userid',
  'enrollid', 'enroll_id', 'enrollId', 'enrollnumber', 'enrollNumber',
  'pin', 'PIN', 'badge', 'card', 'employee_id', 'employeeId', 'empid', 'id',
]

export const TIME_KEYS = [
  'scanned_at', 'scannedAt', 'timestamp', 'time', 'datetime', 'dateTime',
  'punch_time', 'punchTime', 'event_time', 'eventTime', 'recordtime',
  'checktime', 'checkTime', 'date_time',
]

export const SERIAL_KEYS = [
  'device_serial', 'deviceSerial', 'serial_no', 'serialNo', 'serialNumber',
  'sn', 'SN', 'devicesn', 'deviceSn', 'cloud_id', 'cloudId', 'cloudid', 'devid',
  // Last, so a record's own serial always beats one inherited from the
  // envelope it arrived in. Set by inherit() below, never by a device.
  '__envelopeSerial',
]

// Note the absence of `mode`. It is ambiguous across these firmwares — on the
// EBKN family it carries the verification method, not the in/out state — and a
// key that means two different things must not be consulted for either. It
// lives in METHOD_KEYS below, where it is unambiguous.
export const DIRECTION_KEYS = [
  'direction', 'state', 'status', 'in_out', 'inOut', 'inout', 'type',
  'attendance_type', 'checktype', 'checkType',
]

export const METHOD_KEYS = [
  'verify_mode', 'verifyMode', 'verify', 'mode_verify', 'mode', 'inputtype',
  'verification', 'verification_method',
]

/** First key present with a non-blank value, trimmed. Null when none match. */
export function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return null
}

/**
 * Maps a device's in/out column to a direction.
 *
 * Returns null — not a guess — for anything unrecognised. Null means "the
 * device did not tell us", and the app then falls back to the direction
 * configured on the device row, which is the correct answer for a reader that
 * is physically the exit door. Guessing 'in' here would silently clock people
 * in when they leave.
 */
export function toDirection(value: string | null): Direction | null {
  if (value === null) return null
  const v = value.toLowerCase()

  // 0 and 4 are the common check-in codes across these firmwares, 1 and 5 the
  // check-out ones — the same mapping the app's zkteco adapter uses.
  if (['in', '0', '4', 'checkin', 'check-in', 'check_in', 'entry', 'i'].includes(v)) return 'in'
  if (['out', '1', '5', 'checkout', 'check-out', 'check_out', 'exit', 'o'].includes(v)) return 'out'
  if (['breakin', 'break-in', 'overtimein', 'overtime-in', 'mealin', 'meal-in'].includes(v)) return 'in'
  if (['breakout', 'break-out', 'overtimeout', 'overtime-out', 'mealout', 'meal-out'].includes(v)) return 'out'
  if (['both', 'any'].includes(v)) return 'both'
  return null
}

/** Human label for the verification method, kept in `raw` for the audit trail. */
export function toVerificationMethod(value: string | null): string | null {
  if (value === null) return null
  const v = value.toLowerCase()
  const byCode: Record<string, string> = {
    '0': 'password', '1': 'fingerprint', '2': 'card', '3': 'face',
    '4': 'palm', '15': 'face', '20': 'face',
  }
  if (byCode[v]) return byCode[v]
  if (['face', 'finger', 'fingerprint', 'card', 'rfid', 'password', 'pin', 'palm'].includes(v)) {
    return v === 'finger' ? 'fingerprint' : v
  }
  return v
}

/**
 * Coaxes a list of record-shaped objects out of an arbitrary parsed payload.
 *
 * Firmwares wrap their records in whatever key they felt like — `records`,
 * `data`, `list`, `AttLog` — or send a bare object, or a bare array. Rather
 * than a special case per vendor, this finds the array wherever it is.
 */
export function toRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []

  const WRAPPERS = ['events', 'records', 'record', 'data', 'list', 'logs', 'log',
    'attlog', 'AttLog', 'items', 'result', 'rows', 'table']

  for (const key of WRAPPERS) {
    const inner = payload[key]
    if (Array.isArray(inner)) return inner.filter(isRecord).map((row) => inherit(payload, row))
    // A single record under a wrapper key, but only if it looks like one —
    // otherwise a `data: { count: 3 }` envelope would be mistaken for a scan.
    if (isRecord(inner) && pick(inner, USER_KEYS) !== null) return [inherit(payload, inner)]
  }

  return [payload]
}

/**
 * Copies envelope-level identity down onto each record.
 *
 * The common device shape states the serial once and then lists the scans:
 *
 *   { "cmd": "sendlog", "sn": "ENS2025079", "record": [ { "enrollid": … } ] }
 *
 * Unwrapping to the records alone silently loses the serial, and every scan in
 * the batch is then dropped for having no device — which looks exactly like a
 * device that is not sending anything. Only the serial keys are inherited: a
 * timestamp or direction at envelope level would be an assumption, but a
 * terminal cannot report another terminal's scans.
 *
 * The record's own value always wins, so a genuinely multi-device batch still
 * attributes each scan correctly.
 */
function inherit(envelope: Record<string, unknown>, row: Record<string, unknown>): Record<string, unknown> {
  if (pick(row, SERIAL_KEYS) !== null) return row

  const serial = pick(envelope, SERIAL_KEYS)
  return serial === null ? row : { ...row, __envelopeSerial: serial }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Strips the synthetic key inherit() adds, for anything stored as `raw`.
 *
 * The archive is meant to be a faithful record of what the device sent. A field
 * the gateway invented sitting in it would mislead whoever reads it later.
 */
export function withoutSynthetic(row: Record<string, unknown>): Record<string, unknown> {
  if (!('__envelopeSerial' in row)) return row
  const copy = { ...row }
  delete copy.__envelopeSerial
  return copy
}
