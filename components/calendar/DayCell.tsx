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
  onSelect?: (dateKey: string) => void
}

export default function DayCell({
  day,
  dateKey,
  hours,
  isToday,
  dailyTargetHours = DAILY_TARGET_HOURS,
  onLeave = false,
  onSelect,
}: DayCellProps) {
  if (day === null || dateKey === null) {
    return <div className="aspect-square rounded-md" />
  }

  // Half the target is where the tile's fill gets dark enough to need light
  // text — the same threshold bucketColor() steps at.
  const isFilled = hours >= dailyTargetHours / 2

  return (
    <button
      type="button"
      onClick={() => dateKey && onSelect?.(dateKey)}
      aria-label={`${dateKey} — ${hours.toFixed(1)} hours worked${onLeave ? ', on approved leave' : ''}`}
      className="relative flex aspect-square flex-col items-center justify-center gap-0 rounded-md text-[11px] font-medium transition-all hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className={`text-[7px] leading-tight ${isFilled ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
        >
          {hours.toFixed(1)}h
        </span>
      )}
      {onLeave && (
        <span
          title="Approved leave"
          className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-brand-gold"
        />
      )}
      {isToday && <span className="absolute bottom-0.5 h-0.5 w-0.5 rounded-full bg-brand-gold" />}
    </button>
  )
}
