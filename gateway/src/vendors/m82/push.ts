import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { toInstant } from '../../time.ts'
import { toVerificationMethod } from '../fields.ts'

// M82 firmware — the FK terminal protocol as the hardware actually speaks it.
//
// Verified directly against an EN-K190FTW reporting `M82 v3.15.988`, not
// derived from the vendor's Windows software. That distinction matters:
// AttendanceTracker 11.8 contains no trace of these request codes, so this is a
// newer generation than anything the PC client implements, and fkweb/push.ts —
// written from that client's IL — cannot parse it.
//
// The differences from fkweb are not cosmetic:
//
//   fkweb                          m82
//   -----------------------------  -----------------------------------------
//   bare JSON over raw TCP         TLS, HTTP/1.0, absolute-form request URI
//   routed by body content         routed by the `request_code` HEADER
//   serial in the body             serial in the `dev_id` HEADER
//   body is JSON                   body is <uint32 LE len><JSON>[blobs...]
//   `log_id` echoed to acknowledge no log_id exists at all
//
// TLS is terminated upstream (Traefik/Caddy in the production deployment), so
// by the time a payload reaches here it is a plain HTTP POST body. The parser
// therefore needs to know nothing about TLS — only about the framing.
//
// See docs/m82-protocol.md in the reverse-engineering workspace for the capture
// this was written from, including the negative results on acknowledgement.

/** Request codes the firmware sends, as the `request_code` header. */
export const M82_GLOG = 'realtime_glog'
export const M82_ENROLL = 'realtime_enroll_data'
export const M82_HEARTBEAT = 'receive_cmd'

export interface M82Raw {
  vendor: 'm82'
  requestCode: string
  /** Verbatim verify_mode as sent. A NUMBER on this firmware, and outside 0-4. */
  verifyMode: number | string | null
  /** Best-effort label, or the raw code as text when we have no mapping. */
  verificationMethod: string | null
  /** What the device called the direction. Recorded, deliberately not trusted. */
  ioMode: unknown
  record: Record<string, unknown>
}

export interface M82Body {
  /** The decoded JSON document, or null if the framing did not hold. */
  json: Record<string, unknown> | null
  /** Bytes following the JSON in this block — photo and template blobs. */
  blobs: Buffer
  /** Length the frame declared for its JSON, for diagnosing truncation. */
  declaredLength: number | null
}

/**
 * Splits the wire format: a uint32 little-endian length, that many bytes of
 * JSON, then any binary attachments.
 *
 * Returns nulls rather than throwing on anything malformed. A parser that
 * throws on an unexpected frame takes the whole listener down, and this one
 * runs against a device we cannot patch.
 */
export function decodeM82Body(body: Buffer): M82Body {
  if (body.length < 4) return { json: null, blobs: Buffer.alloc(0), declaredLength: null }

  const declaredLength = body.readUInt32LE(0)

  // A length longer than the buffer means a truncated or mis-framed block, not
  // a frame to guess at.
  if (declaredLength > body.length - 4) {
    return { json: null, blobs: Buffer.alloc(0), declaredLength }
  }

  let json: Record<string, unknown> | null = null
  try {
    const parsed: unknown = JSON.parse(body.subarray(4, 4 + declaredLength).toString('utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      json = parsed as Record<string, unknown>
    }
  } catch {
    json = null
  }

  return { json, blobs: body.subarray(4 + declaredLength), declaredLength }
}

/** The `request_code` header, which is how this firmware says what it wants. */
export function m82RequestCode(input: VendorInput): string | null {
  const value = input.headers?.['request_code']
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** The `dev_id` header — the serial, which never appears in the body. */
function m82DeviceId(input: VendorInput): string | null {
  const value = input.headers?.['dev_id']
  return typeof value === 'string' && value.length > 0 ? value : null
}

const asText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value)

/**
 * One `realtime_glog` document to one event.
 *
 * Observed shape:
 *   {"fk_bin_data_lib":"M50","user_id":"00000001","verify_mode":10,
 *    "io_mode":1,"io_time":"20251106123055"}
 */
function fromGlog(
  row: Record<string, unknown>,
  serial: string | null,
  tz: string
): NormalizedEvent | null {
  const externalUserId = asText(row['user_id'])
  const rawTime = asText(row['io_time'])

  // Both load-bearing, plus the serial. Substituting "now" for a missing
  // timestamp would put a wrong time on someone's shift, and this firmware
  // replays months-old records, so a receipt-time fallback is actively wrong.
  if (!serial || !externalUserId || !rawTime) return null

  const scannedAt = toInstant(rawTime, tz)
  if (!scannedAt) return null
  const iso = scannedAt.toISOString()

  const verifyModeRaw = row['verify_mode']
  const verifyMode =
    typeof verifyModeRaw === 'number' || typeof verifyModeRaw === 'string' ? verifyModeRaw : null

  const raw: M82Raw = {
    vendor: 'm82',
    requestCode: M82_GLOG,
    verifyMode,
    // toVerificationMethod returns the code as text when it has no mapping,
    // which is what we want: an unlabelled code beats a confidently wrong
    // label. This firmware reported 10, outside the 0-4 table every other
    // module assumes, so most values here pass through unmapped until the real
    // vocabulary is observed. See docs/m82-protocol.md section 4.
    verificationMethod: toVerificationMethod(asText(verifyMode)),
    ioMode: row['io_mode'] ?? null,
    record: { ...row },
  }

  return {
    deviceSerial: serial,
    externalUserId,
    scannedAt: iso,
    // DELIBERATELY null, even though `io_mode` is present.
    //
    // The shared mapper reads 1 as "out". We have observed exactly one value of
    // io_mode from one device and have no way to confirm which way it points,
    // and null means "let the app's device row decide" — which is correct for a
    // reader physically wired as a single door. Guessing here would silently
    // stamp every punch in the estate as an exit. Populate this only once the
    // mapping is confirmed against a device scanned deliberately in and out.
    direction: null,
    // Identical formula to every other vendor module, so a scan arriving twice
    // — and this firmware retries relentlessly — is one punch, not two.
    dedupeKey: makeDedupeKey([serial, externalUserId, iso]),
    raw,
  }
}

export function parseM82Push(input: VendorInput): NormalizedEvent[] {
  const requestCode = m82RequestCode(input)
  // No request_code means this is not M82. Claiming it would let this parser
  // win the candidate race in server.ts against the vendor that really owns it.
  if (!requestCode) return []

  const serial = m82DeviceId(input) ?? input.deviceSerial ?? null
  const tz = input.timezone ?? 'UTC'
  const { json } = decodeM82Body(input.body)
  if (!json) return []

  switch (requestCode) {
    case M82_GLOG: {
      const event = fromGlog(json, serial, tz)
      return event ? [event] : []
    }

    // Both are normal traffic that produce no attendance event. The heartbeat
    // carries a device inventory and the enrolment push carries biometric
    // data; neither is a punch, and returning [] for them is correct rather
    // than a failure. Enrolment is handled by readM82Enrollment below, which
    // is wired separately precisely so biometric payloads take a different
    // path from attendance events.
    case M82_HEARTBEAT:
    case M82_ENROLL:
      return []

    default:
      return []
  }
}

export interface M82DeviceInfo {
  serial: string | null
  model: string | null
  firmware: string | null
  /** Which credential types this unit supports: FP, PASSWORD, IDCARD, QR, FACE. */
  supportedEnrollData: string[]
  /** The device's own clock, naive local time as it reported it. */
  deviceTime: string | null
}

/**
 * Reads the inventory the device volunteers on every `receive_cmd`.
 *
 * Worth having because it answers, per device and without asking, which
 * credentials that unit can even hold — the thing a UI needs in order to avoid
 * offering face enrolment on a fingerprint-only reader.
 */
export function readM82DeviceInfo(input: VendorInput): M82DeviceInfo | null {
  if (m82RequestCode(input) !== M82_HEARTBEAT) return null
  const { json } = decodeM82Body(input.body)
  if (!json) return null

  const info = json['fk_info']
  const infoRecord = info && typeof info === 'object' ? (info as Record<string, unknown>) : {}
  const supported = infoRecord['supported_enroll_data']

  return {
    serial: m82DeviceId(input) ?? input.deviceSerial ?? null,
    model: asText(json['fk_name']),
    firmware: asText(infoRecord['firmware']),
    supportedEnrollData: Array.isArray(supported) ? supported.map(String) : [],
    deviceTime: asText(json['fk_time']),
  }
}

export interface M82Credential {
  /** Credential slot: finger index, or the model's card / password / face slot. */
  backupNumber: number
  /** The blob name the JSON referenced, e.g. "BIN_2". */
  blobRef: string
}

export interface M82Enrollment {
  serial: string | null
  externalUserId: string
  name: string | null
  privilege: number | null
  enabled: boolean
  departmentId: number | null
  /** Blob name of the enrolment photo, when one was attached. */
  photoRef: string | null
  credentials: M82Credential[]
  /** Attachment bytes present in THIS block. See the note on blk_no below. */
  blobBytes: number
}

/**
 * Reads a `realtime_enroll_data` push: the device volunteering one of its own
 * users, complete with templates and face photo, without being asked.
 *
 * This is the capability that makes onboarding an already-enrolled estate cheap
 * — the terminals seed the central record rather than only receiving from it.
 * It is also why this path is kept separate from attendance parsing: these
 * payloads are biometric personal data and must be sealed before they come to
 * rest. See cloud/crypto.ts.
 *
 * NOTE ON ATTACHMENTS. The blobs are chunked across requests, indexed by the
 * `blk_no` header, and we have never observed a block beyond the first —
 * because the device re-sends block 1 forever until acknowledged, and the
 * acknowledgement is unsolved (docs/m82-protocol.md section 6). So the metadata
 * below is decoded and trusted; the attachment bytes are reported as a count
 * only. Reassembling them is deliberately not attempted, because a reassembly
 * routine that has never seen a second block is fiction, not code.
 */
export function readM82Enrollment(input: VendorInput): M82Enrollment | null {
  if (m82RequestCode(input) !== M82_ENROLL) return null
  const { json, blobs } = decodeM82Body(input.body)
  if (!json) return null

  const externalUserId = asText(json['user_id'])
  if (!externalUserId) return null

  const array = json['enroll_data_array']
  const credentials: M82Credential[] = Array.isArray(array)
    ? array.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const row = entry as Record<string, unknown>
        const backup = Number(row['backup_number'])
        const ref = asText(row['enroll_data'])
        if (!Number.isFinite(backup) || !ref) return []
        return [{ backupNumber: backup, blobRef: ref }]
      })
    : []

  const privilege = Number(json['user_privilege'])
  const department = Number(json['user_depart_id'])

  return {
    serial: m82DeviceId(input) ?? input.deviceSerial ?? null,
    externalUserId,
    name: asText(json['user_name']),
    privilege: Number.isFinite(privilege) ? privilege : null,
    enabled: json['user_enabled'] !== 0,
    departmentId: Number.isFinite(department) ? department : null,
    photoRef: asText(json['user_photo']),
    credentials,
    blobBytes: blobs.length,
  }
}

export const m82Parser: VendorParser = {
  name: 'm82',
  parse: parseM82Push,
  // No application-level acknowledgement is emitted, and that is a finding
  // rather than an omission.
  //
  // Held against the live device six seconds at a time, nine JSON body shapes
  // (length-prefixed and bare), an EMPTY body, and eight response-header
  // variants all produced an identical retry rate. An empty body performing
  // exactly as well as a well-formed one means the device is not reading our
  // reply for its acknowledgement at all — so there is no string to return here
  // that would help. The confirmation evidently travels by another route, most
  // likely a command issued in reply to `receive_cmd`.
  //
  // Consequence to plan around: this device re-sends indefinitely. Ingestion
  // must stay idempotent, which dedupeKey above ensures.
  ack: () => null,
}
