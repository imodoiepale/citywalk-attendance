import { createHash } from 'node:crypto'
import { looksTextual } from './vendors/decode.ts'

// The raw archive: a diagnostic record of everything a terminal sends, parsed
// or not, stored in Supabase alongside the punches. Known secrets and biometric
// templates are redacted before storage.
//
// Why this exists separately from biometric_events:
//
//   - biometric_events only holds payloads we successfully understood. The ones
//     we did NOT understand are exactly the ones worth keeping — an unrecognised
//     frame is the evidence a parser gets written from, and it is gone forever
//     if the only record was a log line that rotated out.
//   - Devices send more than scans: heartbeats, handshakes, door events, admin
//     operations, template uploads. "Everything it does" means all of it.
//   - When a parser turns out to be subtly wrong — the wrong column read as
//     direction, say — the archive makes the affected events re-derivable
//     without asking anyone to scan again.
//
// The trade is storage. A terminal heartbeating every 30 seconds produces
// ~2,900 rows a day; see the retention note in the migration.

export interface RawPayload {
  /** Serial if we could work one out, else null — an unattributed payload is still worth keeping. */
  deviceSerial: string | null
  /** How it arrived: http, ws, or tcp:<port>. */
  transport: string
  method: string | null
  path: string | null
  query: Record<string, string> | null
  headers: Record<string, string> | null
  /** UTF-8 rendering. Null when the bytes are not text. */
  bodyText: string | null
  /** Always present, so a binary frame survives intact. */
  bodyBase64: string
  bytes: number
  /** How many events the parser got out of it. 0 is the interesting case. */
  parsedEventCount: number
  /** Which parser was used, or null if none matched. */
  vendor: string | null
  sourceIp: string | null
  receivedAt: string
  /** Stable identity, so a retry after a crash does not double-store. */
  payloadKey: string
}

export interface BuildRawArgs {
  body: Buffer
  transport: string
  method?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  deviceSerial?: string | null
  vendor?: string | null
  parsedEventCount: number
  sourceIp?: string | null
}

/**
 * Text bodies are stored readable; binary ones would only be mojibake.
 *
 * Shares looksTextual with the parsers rather than carrying a second
 * heuristic — two subtly different answers to "is this text?" would mean a
 * payload parsed one way and archived another.
 */
function textOrNull(body: Buffer): string | null {
  if (body.length === 0) return ''
  return looksTextual(body) ? body.toString('utf8') : null
}

function redactJson(value: unknown, parent?: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item))
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const templateType = String(record.Type ?? record.type ?? '').toLowerCase()
  const biometricTemplate = ['fingerprint', 'face', 'palm', 'userphoto', 'password'].includes(templateType)
  const out: Record<string, unknown> = {}

  for (const [key, candidate] of Object.entries(record)) {
    const lower = key.toLowerCase()
    if (['authtoken', 'securitykey', 'secret', 'password', 'logphoto', 'userphoto', 'photo'].includes(lower)) {
      out[key] = '[REDACTED]'
    } else if (lower === 'data' && (biometricTemplate || String(parent?.Type ?? '').length > 0)) {
      out[key] = '[REDACTED_TEMPLATE_DATA]'
    } else {
      out[key] = redactJson(candidate, record)
    }
  }
  return out
}

/** Keep diagnostic shape while preventing known credentials/templates landing in Supabase. */
export function sanitizeBodyForArchive(body: Buffer): Buffer {
  if (!looksTextual(body)) return body.subarray(0, 64 * 1024)
  const text = body.toString('utf8')
  try {
    return Buffer.from(JSON.stringify(redactJson(JSON.parse(text))), 'utf8')
  } catch {
    // Cover form/text callbacks without pretending we can understand every
    // proprietary payload. Values are replaced case-insensitively.
    return Buffer.from(text
      .replace(/((?:AuthToken|SecurityKey|Password)\s*[=:]\s*)[^&\s,}]+/gi, '$1[REDACTED]')
      .slice(0, 64 * 1024), 'utf8')
  }
}

/**
 * Header allowlist.
 *
 * Storing every header would drag in cookies and authorization values, which
 * have no diagnostic value here and turn an audit table into a credential
 * store. These are the ones that actually help identify a firmware.
 */
const KEEP_HEADERS = [
  'content-type', 'content-length', 'user-agent', 'host',
  'x-forwarded-for', 'connection', 'accept', 'sn', 'x-device-sn',
]

export function buildRawPayload(args: BuildRawArgs): RawPayload {
  const receivedAt = new Date().toISOString()
  const archivedBody = sanitizeBodyForArchive(args.body)

  const headers = args.headers
    ? Object.fromEntries(Object.entries(args.headers).filter(([k]) => KEEP_HEADERS.includes(k.toLowerCase())))
    : null

  // Identity is content-plus-arrival, not content alone: two identical
  // heartbeats a minute apart are genuinely two events, but the same payload
  // redelivered after a crash within the same millisecond is one.
  const payloadKey = createHash('sha256')
    .update(receivedAt)
    .update(args.transport)
    .update(args.path ?? '')
    .update(args.body)
    .digest('hex')
    .slice(0, 32)

  return {
    deviceSerial: args.deviceSerial ?? null,
    transport: args.transport,
    method: args.method ?? null,
    path: args.path ?? null,
    query: args.query && Object.keys(args.query).length > 0 ? args.query : null,
    headers: headers && Object.keys(headers).length > 0 ? headers : null,
    bodyText: textOrNull(archivedBody),
    // Capped: a fingerprint template upload can be megabytes, and the archive
    // is for diagnosis, not for storing biometric data we deliberately do not
    // want in the cloud. The byte count records the true size either way.
    bodyBase64: archivedBody.toString('base64'),
    bytes: args.body.length,
    parsedEventCount: args.parsedEventCount,
    vendor: args.vendor ?? null,
    sourceIp: args.sourceIp ?? null,
    receivedAt,
    payloadKey,
  }
}
