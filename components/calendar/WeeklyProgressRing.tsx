// Same stroke-dasharray/-rotate-90 technique as TimeDial.tsx's progress
// ring, scaled down for a "this week vs target" hero stat.
import { WEEKLY_TARGET_HOURS } from '@/lib/targets'

export default function WeeklyProgressRing({
  hoursThisWeek,
  targetHours = WEEKLY_TARGET_HOURS,
}: {
  hoursThisWeek: number
  targetHours?: number
}) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const progress = Math.min(hoursThisWeek / Math.max(1, targetHours), 1)
  const offset = circumference * (1 - progress)

  return (
    <div data-tour="weekly-ring" className="relative mx-auto flex h-32 w-32 items-center justify-center sm:h-36 sm:w-36">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={radius} stroke="var(--border)" strokeWidth="10" fill="none" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          stroke="url(#weekly-ring-gradient)"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset,
            transition: 'stroke-dashoffset 600ms ease',
          }}
        />
        <defs>
          <linearGradient id="weekly-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--primary-strong)" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-foreground">{hoursThisWeek.toFixed(1)}h</span>
        <span className="text-xs text-muted-foreground">of {targetHours}h this week</span>
      </div>
    </div>
  )
}
