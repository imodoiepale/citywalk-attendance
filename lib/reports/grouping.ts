// Folding day columns into weeks, months, quarters or years.
//
// The timesheet stores hours per Nairobi calendar day (`days: Record<dateKey,
// hours>`). Every granularity above that is a pure regrouping of those same
// numbers — no re-query, and no separate code path that could disagree with the
// daily view. A roll-up that changes the total is a bug, and the test asserts
// exactly that.

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

export const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

export function isGranularity(value: string | undefined): value is Granularity {
  return GRANULARITIES.some((g) => g.value === value)
}

export interface Bucket {
  /** Stable id used as the column key. */
  key: string
  /** Short header, e.g. "W34" or "Aug". */
  label: string
  /** Longer form for a tooltip or an export header. */
  title: string
  /** The day keys folded into this bucket. */
  dateKeys: string[]
}

/** Parsed as UTC noon so a timezone shift can never move the calendar day. */
function asDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`)
}

/**
 * ISO week: weeks start Monday and belong to the year containing their Thursday.
 *
 * Deliberately not the Sunday-first convention the calendar heatmap uses — a
 * payroll week is a working week, and Monday is where one starts. The Thursday
 * rule is what keeps the turn of the year from producing a stray one-day week.
 */
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Shift to the Thursday of this week. getUTCDay() is 0 for Sunday, so map it
  // to 7 to make Monday the first day.
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/** Monday of the ISO week containing `date`, as a YYYY-MM-DD key. */
function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - (day - 1))
  return d.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function bucketFor(dateKey: string, granularity: Granularity): Omit<Bucket, 'dateKeys'> {
  const date = asDate(dateKey)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()

  switch (granularity) {
    case 'week': {
      const { year: isoYear, week } = isoWeek(date)
      const monday = mondayOf(date)
      const sunday = new Date(asDate(monday).getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
      return {
        key: `${isoYear}-W${String(week).padStart(2, '0')}`,
        label: `W${week}`,
        title: `Week ${week}, ${isoYear} (${monday} to ${sunday})`,
      }
    }
    case 'month':
      return {
        key: `${year}-${String(month + 1).padStart(2, '0')}`,
        label: MONTHS[month],
        title: `${MONTHS[month]} ${year}`,
      }
    case 'quarter': {
      const quarter = Math.floor(month / 3) + 1
      return { key: `${year}-Q${quarter}`, label: `Q${quarter}`, title: `Q${quarter} ${year}` }
    }
    case 'year':
      return { key: String(year), label: String(year), title: String(year) }
    default: {
      const weekday = date.toLocaleDateString('en-KE', { weekday: 'narrow', timeZone: 'UTC' })
      return {
        key: dateKey,
        label: `${weekday}${date.getUTCDate()}`,
        title: date.toLocaleDateString('en-KE', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }),
      }
    }
  }
}

/**
 * Groups day keys into buckets, preserving chronological order.
 *
 * Every input key lands in exactly one bucket, which is what makes the totals
 * identical at every granularity.
 */
export function groupKeysFor(dateKeys: string[], granularity: Granularity): Bucket[] {
  const buckets = new Map<string, Bucket>()

  for (const dateKey of [...dateKeys].sort()) {
    const meta = bucketFor(dateKey, granularity)
    const existing = buckets.get(meta.key)
    if (existing) existing.dateKeys.push(dateKey)
    else buckets.set(meta.key, { ...meta, dateKeys: [dateKey] })
  }

  return [...buckets.values()]
}

/** Sums a row's per-day hours across a bucket. */
export function bucketHours(days: Record<string, number>, bucket: Bucket): number {
  return bucket.dateKeys.reduce((sum, key) => sum + (days[key] ?? 0), 0)
}
