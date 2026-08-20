import { bucketColor } from '@/lib/calendar-buckets'
import { DAILY_TARGET_HOURS } from '@/lib/targets'

export default function Legend({
  dailyTargetHours = DAILY_TARGET_HOURS,
}: {
  dailyTargetHours?: number
}) {
  // Sample points spread across the buckets relative to the target, so the
  // legend keeps showing four distinct swatches whatever the target is.
  const samples = [0, dailyTargetHours * 0.25, dailyTargetHours * 0.75, dailyTargetHours * 1.1]

  return (
    <div className="flex flex-wrap items-center justify-center gap-1 text-[8px] text-muted-foreground sm:text-[9px]">
      <span>Less</span>
      {samples.map((hours) => (
        <span
          key={hours}
          className="h-2 w-2 rounded-sm"
          style={{ backgroundColor: bucketColor(hours, dailyTargetHours) }}
        />
      ))}
      <span>More</span>
      <span className="ml-1 flex items-center gap-0.5">
        <span className="h-2 w-2 rounded-sm border-1" style={{ borderColor: 'var(--primary)' }} />
        <span className="hidden sm:inline">Today</span>
      </span>
      <span className="ml-1 flex items-center gap-0.5">
        <span className="h-1 w-1 rounded-full bg-brand-gold" />
        <span className="hidden sm:inline">Leave</span>
      </span>
    </div>
  )
}
