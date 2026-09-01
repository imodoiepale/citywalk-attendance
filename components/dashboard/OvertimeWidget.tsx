import { AlarmClockOff } from 'lucide-react'
import { getLiveOvertime } from '@/lib/reports/overtime'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/**
 * Real-time: who is currently clocked in and already past their shift's
 * clock-out window. Nobody is blocked by this — it's visibility only, the
 * same "never block, only flag" rule that governs every other shift surface.
 */
export default async function OvertimeWidget({
  branchId,
  orgWide,
}: {
  branchId: string
  orgWide: boolean
}) {
  const rows = await getLiveOvertime(branchId, orgWide)
  if (rows.length === 0) return null

  return (
    <Card className="border-warning/30 bg-warning/5">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <AlarmClockOff className="h-4 w-4 text-warning" />
          <h2 className="text-sm font-semibold text-foreground">
            {rows.length === 1 ? '1 person is' : `${rows.length} people are`} currently over their
            shift
          </h2>
        </div>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.punchId} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {row.fullName}{' '}
                {orgWide ? <span className="text-xs text-muted-foreground">{row.branchName}</span> : null}
              </span>
              <Badge variant="warning">+{row.minutesOver}m</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
