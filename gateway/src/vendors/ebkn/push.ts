import type { NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { toInstant } from '../../time.ts'
import { decode, toDelimitedRows } from '../decode.ts'
import {
  DIRECTION_KEYS, METHOD_KEYS, SERIAL_KEYS, TIME_KEYS, USER_KEYS,
  pick, toDirection, toRows, toVerificationMethod, withoutSynthetic,
} from '../fields.ts'

// EN-K190FTW / EBKN M82 push parser.
//
// IMPORTANT — read before "fixing" this.
//
// The exact wire format of this firmware is NOT yet confirmed. Phase 0
// (src/probe/capture.ts) exists to establish it from a real scan. Until a
// fixture from a real device lands in test/fixtures/, this parser is
// deliberately shape-driven rather than spec-driven: it accepts JSON, form
// encoding and delimited text, and finds the four facts it needs wherever they
// are, because being tolerant costs nothing and being confidently wrong about
// an unverified spec costs a week.
//
// Once a real capture exists, tighten this against it and keep the tolerant
// path as the fallback — the estate will not all be on one firmware build.

export function parseEbknPush(input: VendorInput): NormalizedEvent[] {
  const tz = input.timezone ?? 'Africa/Nairobi'
  const contentType = input.headers?.['content-type']
  const decoded = decode(input.body, contentType)

  // A serial in the query string or a header beats one in config: it is the
  // device identifying itself, and it is how a single endpoint serves a fleet.
  const serialFromTransport =
    pickFrom(input.query, SERIAL_KEYS) ?? pickFrom(input.headers, SERIAL_KEYS) ?? input.deviceSerial ?? null

  if (decoded.kind === 'binary') {
    // Not decodable as text. Keep the bytes; a parser gets written against them
    // once a capture shows what they are. Returning [] rather than throwing
    // means a heartbeat frame does not look like an outage.
    return []
  }

  if (decoded.kind === 'json' || decoded.kind === 'form') {
    const rows = decoded.kind === 'form' ? [decoded.value as Record<string, unknown>] : toRows(decoded.value)
    return rows
      .map((row) => fromRow(row, serialFromTransport, tz))
      .filter((e): e is NormalizedEvent => e !== null)
  }

  return fromDelimited(decoded.value, serialFromTransport, tz)
}

function pickFrom(
  source: Record<string, string> | undefined,
  keys: string[]
): string | null {
  if (!source) return null
  // Query and header names arrive in whatever case the firmware chose.
  const lowered: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) lowered[k.toLowerCase()] = v
  return pick(lowered, keys.map((k) => k.toLowerCase()))
}

function fromRow(
  row: Record<string, unknown>,
  fallbackSerial: string | null,
  tz: string
): NormalizedEvent | null {
  const deviceSerial = pick(row, SERIAL_KEYS) ?? fallbackSerial
  const externalUserId = pick(row, USER_KEYS)
  const rawTime = pick(row, TIME_KEYS)

  // All three are load-bearing. A record missing any of them cannot be turned
  // into a punch, and inventing a value — "now" for a missing timestamp, say —
  // would put a wrong time on someone's shift. Skipped records stay visible in
  // the capture log.
  if (!deviceSerial || !externalUserId || !rawTime) return null

  const scannedAt = toInstant(rawTime, tz)
  if (!scannedAt) return null

  const iso = scannedAt.toISOString()
  return {
    deviceSerial,
    externalUserId,
    scannedAt: iso,
    direction: toDirection(pick(row, DIRECTION_KEYS)),
    dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
    raw: {
      vendor: 'ebkn',
      verificationMethod: toVerificationMethod(pick(row, METHOD_KEYS)),
      record: withoutSynthetic(row),
    },
  }
}

/**
 * Delimited fallback: `<pin> <timestamp> <status> …`, tab or comma separated.
 *
 * The timestamp is found by shape rather than by column index, because the
 * column order varies between firmwares and a fixed index silently reads the
 * wrong field instead of failing loudly.
 */
function fromDelimited(text: string, fallbackSerial: string | null, tz: string): NormalizedEvent[] {
  if (!fallbackSerial) return []

  const events: NormalizedEvent[] = []
  for (const cols of toDelimitedRows(text)) {
    const timeIndex = cols.findIndex((c) => /\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}/.test(c))
    if (timeIndex < 1) continue

    const pin = cols[0]
    const rawTime = cols[timeIndex]
    if (!pin || !rawTime) continue

    const scannedAt = toInstant(rawTime, tz)
    if (!scannedAt) continue

    const iso = scannedAt.toISOString()
    events.push({
      deviceSerial: fallbackSerial,
      externalUserId: pin,
      scannedAt: iso,
      direction: toDirection(cols[timeIndex + 1] ?? null),
      dedupeKey: makeDedupeKey([fallbackSerial, pin, iso]),
      raw: {
        vendor: 'ebkn',
        verificationMethod: toVerificationMethod(cols[timeIndex + 2] ?? null),
        line: cols.join('\t'),
        cols,
      },
    })
  }
  return events
}

export const ebknParser: VendorParser = {
  name: 'ebkn',
  parse: parseEbknPush,
}
