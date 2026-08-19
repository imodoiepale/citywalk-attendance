// Pay-period resolution, shared by the timesheet page and the export route so
// a download always covers exactly the range shown on screen.

export type PeriodPreset = 'this-month' | 'last-month' | 'first-half' | 'second-half' | 'last-7' | 'last-30' | 'custom'

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'first-half', label: '1st – 15th (this month)' },
  { value: 'second-half', label: '16th – end (this month)' },
  { value: 'last-7', label: 'Last 7 days' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000

/** A Nairobi-local Y-M-D as a UTC instant at 00:00 Nairobi. */
function nairobiDayUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - NAIROBI_OFFSET_MS)
}

export function resolvePeriod(
  preset: PeriodPreset,
  custom?: { from?: string; to?: string }
): { from: string; to: string; label: string } {
  const now = new Date(Date.now() + NAIROBI_OFFSET_MS)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  const iso = (date: Date) => date.toISOString()
  // `to` is exclusive throughout, so a period always ends at 00:00 of the day
  // after the last day it covers.
  const monthName = (m: number, y: number) =>
    new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-KE', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

  switch (preset) {
    case 'last-month': {
      const prevMonth = month === 0 ? 11 : month - 1
      const prevYear = month === 0 ? year - 1 : year
      return {
        from: iso(nairobiDayUtc(prevYear, prevMonth, 1)),
        to: iso(nairobiDayUtc(year, month, 1)),
        label: monthName(prevMonth, prevYear),
      }
    }
    case 'first-half':
      return {
        from: iso(nairobiDayUtc(year, month, 1)),
        to: iso(nairobiDayUtc(year, month, 16)),
        label: `1–15 ${monthName(month, year)}`,
      }
    case 'second-half':
      return {
        from: iso(nairobiDayUtc(year, month, 16)),
        to: iso(nairobiDayUtc(year, month + 1, 1)),
        label: `16–end ${monthName(month, year)}`,
      }
    case 'last-7':
      return {
        from: iso(nairobiDayUtc(year, month, now.getUTCDate() - 6)),
        to: iso(nairobiDayUtc(year, month, now.getUTCDate() + 1)),
        label: 'Last 7 days',
      }
    case 'last-30':
      return {
        from: iso(nairobiDayUtc(year, month, now.getUTCDate() - 29)),
        to: iso(nairobiDayUtc(year, month, now.getUTCDate() + 1)),
        label: 'Last 30 days',
      }
    case 'custom': {
      // Fall back to this month if either bound is missing or unparseable.
      const from = custom?.from ? new Date(`${custom.from}T00:00:00+03:00`) : null
      const to = custom?.to ? new Date(`${custom.to}T00:00:00+03:00`) : null
      if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from) {
        // Make `to` exclusive by advancing a day past the user's last date.
        const exclusiveTo = new Date(to.getTime() + 24 * 60 * 60 * 1000)
        return { from: iso(from), to: iso(exclusiveTo), label: `${custom!.from} to ${custom!.to}` }
      }
      return resolvePeriod('this-month')
    }
    case 'this-month':
    default:
      return {
        from: iso(nairobiDayUtc(year, month, 1)),
        to: iso(nairobiDayUtc(year, month + 1, 1)),
        label: monthName(month, year),
      }
  }
}

export function isPeriodPreset(value: string | undefined): value is PeriodPreset {
  return PERIOD_OPTIONS.some((option) => option.value === value)
}
