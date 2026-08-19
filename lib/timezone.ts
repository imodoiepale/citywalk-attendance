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
