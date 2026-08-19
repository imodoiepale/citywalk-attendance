// Discrete color buckets by hours worked, ported from DepthMe's
// minutes-meditated calendar heatmap — using the Citywalk gold/ink tokens
// instead of DepthMe's purple scale.
export function bucketColor(hours: number): string {
  if (hours <= 0) return 'var(--muted)'
  if (hours < 4) return 'color-mix(in srgb, var(--brand-gold) 30%, var(--muted))'
  if (hours < 8) return 'var(--primary)'
  return 'var(--primary-strong)'
}
