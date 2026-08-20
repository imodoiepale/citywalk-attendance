import { Badge } from '@/components/ui/badge'
import type { DeviceHealth } from '@/lib/biometric/queries'

// Wording is about what to do, not about the value in the column: "Not seen
// today" tells a manager something is wrong; "stale" does not.
const HEALTH: Record<DeviceHealth, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  online: { label: 'Online', variant: 'success' },
  stale: { label: 'Not seen recently', variant: 'warning' },
  offline: { label: 'Offline', variant: 'destructive' },
  never_seen: { label: 'Never reported', variant: 'secondary' },
  disabled: { label: 'Disabled', variant: 'secondary' },
}

export default function DeviceHealthBadge({ health }: { health: DeviceHealth }) {
  const meta = HEALTH[health] ?? HEALTH.never_seen
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}
