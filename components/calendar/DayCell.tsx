import Link from 'next/link'
import { bucketColor } from '@/lib/calendar-buckets'
import { DAILY_TARGET_HOURS } from '@/lib/targets'

interface DayCellProps {
  day: number | null
  dateKey: string | null
  hours: number
  isToday: boolean
  dailyTargetHours?: number
  /** Approved leave covers this day — shown as a corner marker, not a colour swap. */
  onLeave?: boolean
}

export default function DayCell({
  day,
  dateKey,
  hours,
  isToday,
  dailyTargetHours = DAILY_TARGET_HOURS,
  onLeave = false,
}: DayCellProps) {
  if (day === null || dateKey === null) {
    return <div className="aspect-square rounded-lg" />
  }

  // Half the target is where the tile's fill gets dark enough to need light
  // text — the same threshold bucketColor() steps at.
  const isFilled = hours >= dailyTargetHours / 2

  return (
    <Link
      href={`/calendar/${dateKey}`}
      aria-label={`${dateKey} — ${hours.toFixed(1)} hours worked${onLeave ? ', on approved leave' : ''}`}
      className="relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{
        backgroundColor: bucketColor(hours, dailyTargetHours),
        boxShadow: isToday
          ? '0 0 0 2px var(--primary), 0 0 8px color-mix(in srgb, var(--primary) 40%, transparent)'
          : undefined,
      }}
    >
      <span className={isFilled ? 'text-primary-foreground' : 'text-foreground/80'}>{day}</span>
      {hours > 0 && (
        <span
          className={`text-[9px] ${isFilled ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
        >
          {hours.toFixed(1)}h
        </span>
      )}
      {onLeave && (
        <span
          title="Approved leave"
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-gold ring-1 ring-brand-ink/40"
        />
      )}
      {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brand-gold" />}
    </Link>
  )
}
