import { DAILY_TARGET_HOURS } from '@/lib/targets'

// Discrete color buckets by hours worked, ported from DepthMe's
// minutes-meditated calendar heatmap — using the Citywalk gold/ink tokens
// instead of DepthMe's purple scale.
//
// The break points are derived from the org's daily target rather than
// hardcoded at 4h/8h, so a branch on a 6h day still gets a meaningful spread
// instead of every day rendering as "full".
export function bucketColor(hours: number, dailyTargetHours: number = DAILY_TARGET_HOURS): string {
  if (hours <= 0) return 'var(--muted)'
  if (hours < dailyTargetHours / 2) return 'color-mix(in srgb, var(--brand-gold) 30%, var(--muted))'
  if (hours < dailyTargetHours) return 'var(--primary)'
  return 'var(--primary-strong)'
}
