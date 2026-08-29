import type { Direction, NormalizedEvent, VendorInput, VendorParser } from '../../types.ts'
import { makeDedupeKey } from '../../types.ts'
import { naiveToInstant } from '../../time.ts'
import { buildM50Response, m50TimeParts, parseM50Message } from './protocol.ts'
import { isRecord } from '../fields.ts'

// M50 WebSocket family — the punch-carrying half of the protocol.
//
// This module is stateless on purpose: it turns one `TimeLog`/`TimeLog_v2`
// frame into events and produces the reply. The Register/Login handshake that
// has to happen first is a per-connection concern and lives in session.ts.
//
// Registered as a vendor so that a frame arriving by any transport — the raw
// archive, a replayed capture, an HTTP relay — parses identically to one that
// arrived on the live socket.

/** Frames that carry a scan. AdminLog is device housekeeping, not attendance. */
const LOG_EVENTS = new Set(['TimeLog', 'TimeLog_v2'])

/**
 * `AttendStat` → direction.
 *
 * The vocabulary is `<activity> On|Off`, where On opens the interval and Off
 * closes it. "Go Out On" is therefore the start of a break — the person is
 * leaving — and "Go Out Off" is their return.
 *
 * Anything unrecognised, and the very common case of a device configured with
 * no attendance states at all, yields null so the app falls back to the
 * device row. Guessing here would put people through the wrong door.
 */
const ATTEND_DIRECTION: Record<string, Direction> = {
  'duty on': 'in',
  'duty off': 'out',
  'overtime on': 'in',
  'overtime off': 'out',
  'go out on': 'out',
  'go out off': 'in',
  in: 'in',
  out: 'out',
}

export interface M50Raw {
  vendor: 'm50'
  event: string
  logId: string | null
  /** Echoed in the acknowledgement; the device matches replies to records by it. */
  transId: string | null
  /** Verification method as the firmware names it: FP, FACE, CD, QR, FP+CD… */
  action: string | null
  attendStat: string | null
  terminalType: string | null
  hasImage: boolean
  /**
   * How `Time` was read. `offset` means the device told us its own UTC offset
   * in the frame; `zone` means we fell back to the timezone on the device row.
   */
  timeBasis: 'offset' | 'zone'
  record: Record<string, string>
}

/**
 * Resolve the frame's `Time` to a real instant.
 *
 * The timestamp arrives as `2013-05-06-T11:09:30Z`. That trailing `Z` is not
 * to be trusted: the malformed `-T` shows the firmware is formatting a string
 * rather than emitting ISO-8601, and the vendor added `<UtcTimezoneMinutes>` to
 * `TimeLog_v2` in December 2024 — a field with no purpose whatsoever if `Time`
 * were already UTC. So it is read as device-local wall clock, offset by
 * `UtcTimezoneMinutes` when the device supplies it and by the configured zone
 * on the device row when it does not.
 *
 * This is the one judgement in this module that hardware can overturn. If a
 * punch lands hours out, this is the function to look at first — the frame's
 * raw `Time` and the chosen instant are both kept in the event, so the archive
 * is enough to tell which reading was right without recapturing anything.
 */
function resolveTime(
  fields: Record<string, string>,
  tz: string
): { at: Date; basis: 'offset' | 'zone' } | null {
  const parts = m50TimeParts(fields.Time ?? '')
  if (!parts) return null

  const offsetText = fields.UtcTimezoneMinutes
  const offset = offsetText === undefined ? Number.NaN : Number(offsetText)
  if (Number.isFinite(offset) && Math.abs(offset) <= 16 * 60) {
    const wall = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s)
    const at = new Date(wall - offset * 60_000)
    return Number.isNaN(at.getTime()) ? null : { at, basis: 'offset' }
  }

  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const naive = `${pad(parts.y, 4)}-${pad(parts.mo)}-${pad(parts.d)} ${pad(parts.h)}:${pad(parts.mi)}:${pad(parts.s)}`
  const at = naiveToInstant(naive, tz)
  return at ? { at, basis: 'zone' } : null
}

export function parseM50Push(input: VendorInput): NormalizedEvent[] {
  const tz = input.timezone ?? 'Africa/Nairobi'

  let text: string
  try {
    text = input.body.toString('utf8')
  } catch {
    return []
  }

  const message = parseM50Message(text)
  if (!message || message.kind !== 'event' || !LOG_EVENTS.has(message.name)) return []

  const f = message.fields
  const deviceSerial = f.DeviceSerialNo || input.deviceSerial || ''
  const externalUserId = f.UserID ?? ''
  const time = resolveTime(f, tz)

  // All three are load-bearing. A scan without one of them is not a scan we can
  // put on a timesheet, and inventing any of them would be worse than dropping
  // it — the frame stays in the raw archive either way.
  if (!deviceSerial || !externalUserId || !time) return []

  const iso = time.at.toISOString()

  // The capture photo is base64 and routinely hundreds of kilobytes. It is
  // dropped from the event — which gets copied into every destination's spool
  // and every third-party webhook — while the verbatim frame stays in the raw
  // archive. A face image should not travel by default.
  const record: Record<string, string> = {}
  for (const [k, v] of Object.entries(f)) {
    if (k === 'LogImage') continue
    record[k] = v
  }

  const raw: M50Raw = {
    vendor: 'm50',
    event: message.name,
    logId: f.LogID ?? null,
    transId: f.TransID ?? null,
    action: f.Action ?? null,
    attendStat: f.AttendStat ?? null,
    terminalType: f.TerminalType ?? null,
    hasImage: typeof f.LogImage === 'string' && f.LogImage.length > 0,
    timeBasis: time.basis,
    record,
  }

  return [{
    deviceSerial,
    externalUserId,
    scannedAt: iso,
    direction: ATTEND_DIRECTION[(f.AttendStat ?? '').trim().toLowerCase()] ?? null,
    // Identical formula to every other vendor module, so the same scan arriving
    // by a second route is one punch and not two.
    dedupeKey: makeDedupeKey([deviceSerial, externalUserId, iso]),
    raw,
  }]
}

/**
 * The reply the device waits for before it stops re-sending the record.
 *
 * Shape and tag order taken from the reference server's `process_log`:
 *
 *   <Message><Response>TimeLog_v2</Response><Result>OK</Result><TransID>x</TransID></Message>
 *
 * The response name must echo the event name — a `TimeLog` frame answered with
 * `TimeLog_v2` is an unmatched reply — and `TransID` is how the device ticks
 * off which buffered record was accepted.
 */
export function m50Ack(_input: VendorInput, events: NormalizedEvent[]): string | null {
  const raw = events[0]?.raw
  if (!isRecord(raw) || raw.vendor !== 'm50') return null

  const event = typeof raw.event === 'string' ? raw.event : 'TimeLog_v2'
  const transId = typeof raw.transId === 'string' ? raw.transId : null
  return buildM50Response(event, [['Result', 'OK'], ['TransID', transId]])
}

export const m50Parser: VendorParser = {
  name: 'm50',
  parse: parseM50Push,
  ack: m50Ack,
}
