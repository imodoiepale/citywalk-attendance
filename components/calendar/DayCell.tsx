import { bucketColor } from '@/lib/calendar-buckets'

interface DayCellProps {
  day: number | null
  hours: number
  isToday: boolean
}

export default function DayCell({ day, hours, isToday }: DayCellProps) {
  if (day === null) {
    return <div className="aspect-square rounded-lg" />
  }

  return (
    <div
      className="relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-medium"
      style={{
        backgroundColor: bucketColor(hours),
        boxShadow: isToday
          ? '0 0 0 2px var(--primary), 0 0 8px color-mix(in srgb, var(--primary) 40%, transparent)'
          : undefined,
      }}
    >
      <span className={hours >= 4 ? 'text-primary-foreground' : 'text-foreground/80'}>{day}</span>
      {hours > 0 && (
        <span className={`text-[9px] ${hours >= 4 ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
          {hours.toFixed(1)}h
        </span>
      )}
      {isToday && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-brand-gold" />}
    </div>
  )
}
