import { bucketColor } from '@/lib/calendar-buckets'

export default function Legend() {
  return (
    <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
      <span>Less</span>
      {[0, 2, 6, 9].map((h) => (
        <span key={h} className="h-3 w-3 rounded-sm" style={{ backgroundColor: bucketColor(h) }} />
      ))}
      <span>More</span>
      <span className="ml-2 flex items-center gap-1">
        <span className="h-3 w-3 rounded-sm border-2" style={{ borderColor: 'var(--primary)' }} />
        Today
      </span>
    </div>
  )
}
