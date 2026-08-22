// Terminals almost never send a timezone. They send "2026-08-22 13:48:32" and
// mean their own wall clock. Interpreting that as the *server's* local time is
// the classic way to shift a whole estate's punches by however far the VPS is
// from Nairobi, so every naive timestamp is resolved against an explicit IANA
// zone from config instead.

const NAIVE =
  /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Offset, in ms, that `timeZone` was from UTC at the given instant.
 *
 * Derived from Intl rather than hardcoded so a reader in a DST zone works too;
 * Nairobi is a fixed +03:00 and converges on the first pass.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  // Intl renders midnight as hour 24 in some ICU versions.
  const hour = get('hour') % 24

  const asIfUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second')
  )
  return asIfUtc - at.getTime()
}

/**
 * Resolves a device's naive local timestamp to an absolute instant.
 *
 * Returns null rather than an Invalid Date so callers are forced to decide what
 * an unparseable timestamp means — dropping a scan silently is never right.
 */
export function naiveToInstant(value: string, timeZone: string): Date | null {
  const m = NAIVE.exec(value.trim())
  if (!m) return null

  const [, y, mo, d, h, mi, s] = m
  const naiveAsUtc = Date.UTC(
    Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0')
  )
  if (Number.isNaN(naiveAsUtc)) return null

  // Two passes: the first offset is looked up at roughly the right instant, the
  // second corrects it if that guess landed on the far side of a DST boundary.
  let guess = new Date(naiveAsUtc - zoneOffsetMs(new Date(naiveAsUtc), timeZone))
  guess = new Date(naiveAsUtc - zoneOffsetMs(guess, timeZone))
  return Number.isNaN(guess.getTime()) ? null : guess
}

/**
 * Best-effort timestamp parse for payloads that might already carry a zone.
 *
 * An explicit offset or trailing Z is honoured as-is; anything naive falls
 * through to the configured zone.
 */
export function toInstant(value: string, timeZone: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const explicit = new Date(trimmed)
    return Number.isNaN(explicit.getTime()) ? null : explicit
  }

  // Epoch seconds or milliseconds, which a few firmwares send instead.
  if (/^\d{10}$/.test(trimmed)) return new Date(Number(trimmed) * 1000)
  if (/^\d{13}$/.test(trimmed)) return new Date(Number(trimmed))

  return naiveToInstant(trimmed, timeZone)
}
