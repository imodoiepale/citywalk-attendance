// Africa/Nairobi is a fixed UTC+3 offset year-round (no DST), so plain
// arithmetic is enough here — no date library needed.
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000

/** Start-of-day (00:00 Nairobi time) for the Nairobi-local day containing `date`, as a UTC instant. */
export function startOfNairobiDayUtc(date: Date = new Date()): Date {
  const nairobi = new Date(date.getTime() + NAIROBI_OFFSET_MS)
  const startOfDayNairobiMs = Date.UTC(
    nairobi.getUTCFullYear(),
    nairobi.getUTCMonth(),
    nairobi.getUTCDate()
  )
  return new Date(startOfDayNairobiMs - NAIROBI_OFFSET_MS)
}

/** "YYYY-MM-DD" for the Nairobi-local calendar day an ISO instant falls on. */
export function toNairobiDateKey(iso: string): string {
  const nairobi = new Date(new Date(iso).getTime() + NAIROBI_OFFSET_MS)
  const y = nairobi.getUTCFullYear()
  const m = String(nairobi.getUTCMonth() + 1).padStart(2, '0')
  const d = String(nairobi.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * UTC instants bounding a Nairobi calendar month — i.e. 00:00 Nairobi on the
 * 1st, up to (not including) 00:00 Nairobi on the 1st of the next month.
 *
 * Querying by plain `Date.UTC(...)` bounds while bucketing results by Nairobi
 * day skews the edges by 3 hours, which silently drops the first few hours of
 * a month and pulls in the tail of the previous one.
 */
export function nairobiMonthRangeUtc(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - NAIROBI_OFFSET_MS),
    end: new Date(Date.UTC(year, month, 1) - NAIROBI_OFFSET_MS),
  }
}

/** UTC instants bounding a single Nairobi calendar day, given a "YYYY-MM-DD" key. */
export function nairobiDayRangeUtc(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00.000Z`).getTime() - NAIROBI_OFFSET_MS
  return { start: new Date(start), end: new Date(start + 24 * 60 * 60 * 1000) }
}
