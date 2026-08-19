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
    <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
      <span>Less</span>
      {samples.map((hours) => (
        <span
          key={hours}
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: bucketColor(hours, dailyTargetHours) }}
        />
      ))}
      <span>More</span>
      <span className="ml-2 flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm border-2" style={{ borderColor: 'var(--primary)' }} />
        Today
      </span>
      <span className="ml-2 flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-gold ring-1 ring-brand-ink/40" />
        Leave
      </span>
    </div>
  )
}
