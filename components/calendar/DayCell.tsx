import Link from 'next/link'
import { DAILY_TARGET_HOURS } from '@/lib/targets'

interface DayCellProps {
  day: number | null
  dateKey: string | null
  hours: number
  isToday: boolean
  dailyTargetHours?: number
  /** Approved leave covers this day — shown as a corner marker. */
  onLeave?: boolean
}

// One day tile.
//
// Two things here are load-bearing rather than cosmetic:
//
// `aspect-square` survives only below `lg`. On a desktop it was the entire
// reason the calendar scrolled — a square cell in a seven-column grid ties its
// *height* to the viewport's *width*, so on a 1900px display each cell came out
// ~225px tall and six rows needed roughly twice the available height. Above
// `lg` the cell fills whatever height the grid row gives it instead.
//
// And this is a `<Link>`, not a button with an onClick. That keeps
// middle-click, cmd-click and copy-link-address working, and it is what lets
// the intercepting route open the day as a sheet while a hard load of the same
// URL still renders the full page.

export default function DayCell({
  day,
  dateKey,
  hours,
  isToday,
  dailyTargetHours = DAILY_TARGET_HOURS,
  onLeave = false,
}: DayCellProps) {
  if (day === null || dateKey === null) {
    return <div className="aspect-square lg:aspect-auto lg:h-full" />
  }

  const progress = Math.min(hours / Math.max(1, dailyTargetHours), 1)

  return (
    <Link
      href={`/calendar/${dateKey}`}
      aria-label={`${dateKey} — ${hours.toFixed(1)} hours worked${onLeave ? ', on approved leave' : ''}`}
      className="flex aspect-square flex-col justify-between rounded-xl border border-border/50 bg-card-soft/40 p-2 transition-colors duration-200 ease-standard hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:aspect-auto lg:h-full"
    >
      <div className="flex items-start justify-between gap-1">
        {/* Today is a filled disc behind the number rather than a ring around
            the whole tile — it reads at a glance without outlining the cell. */}
        <span
          className={
            isToday
              ? 'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold tabular-nums text-primary-foreground'
              : 'text-sm font-semibold tabular-nums text-foreground/70'
          }
        >
          {day}
        </span>
        {onLeave ? (
          <span
            title="Approved leave"
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-gold"
          />
        ) : null}
      </div>

      {/* Days with no hours stay quiet — just the number. */}
      {hours > 0 ? (
        <div className="space-y-1">
          <p className="text-base font-semibold tabular-nums text-foreground">
            {hours.toFixed(1)}h
          </p>
          <div className="h-1 w-full overflow-hidden rounded-full bg-border">
            {/* Capped at the target: a full bar means "target met", and
                letting it overflow would make 12h and 9h look equally done. */}
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      ) : null}
    </Link>
  )
}
