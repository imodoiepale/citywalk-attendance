import { Plane } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { getPunchesForDay } from '@/lib/punches/queries'
import { getLeaveOnDay } from '@/lib/leave/queries'
import { getMyCorrections } from '@/lib/corrections/queries'
import { getSettings } from '@/lib/settings'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import CorrectionForm from '@/components/corrections/CorrectionForm'

// One day's punches, leave and correction affordances.
//
// Extracted from the /calendar/[date] page so the full page and the day sheet
// render the *same* component rather than two drifting copies. That matters
// more than it looks: every query below is `server-only`, so a client-side
// panel could not fetch this at all — the sheet has to wrap a Server
// Component, which is exactly what the intercepting route arranges.
//
// Deliberately renders no page chrome (no outer padding, no <h1>, no back
// link). The page and the sheet each supply their own heading, because one is
// a document and the other is an overlay with its own title bar.

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

/** "HH:MM" in Nairobi time, for prefilling the correction form's inputs. */
function timeInputValue(iso: string) {
  return formatTime(iso)
}

function hoursBetween(startIso: string, endIso: string | null) {
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  return Math.max(0, (end - new Date(startIso).getTime()) / 3_600_000)
}

const FLAG_VARIANT: Record<string, 'warning' | 'destructive'> = {
  early: 'warning',
  late: 'warning',
  out_of_window: 'destructive',
}

/** Nothing rendered for on_time or no shift configured — only worth flagging. */
function ShiftFlagBadge({ label, flag }: { label: string; flag?: string | null }) {
  if (!flag || flag === 'on_time') return null
  return (
    <Badge variant={FLAG_VARIANT[flag] ?? 'secondary'}>
      {label} {flag.replace('_', ' ')}
    </Badge>
  )
}

export default async function DayDetail({ date }: { date: string }) {
  const user = await requireUser()
  const [settings, punches, leave, myCorrections] = await Promise.all([
    getSettings(),
    getPunchesForDay(user.id, date),
    getLeaveOnDay(user.id, date),
    getMyCorrections(user.id),
  ])

  const totalHours = punches.reduce((sum, p) => sum + hoursBetween(p.clockInAt, p.clockOutAt), 0)
  const pendingByPunch = new Map(
    myCorrections.filter((c) => c.status === 'pending' && c.punchId).map((c) => [c.punchId, c])
  )

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {totalHours.toFixed(1)}h worked of a {settings.dailyTargetHours}h target ·{' '}
        {punches.length === 1 ? '1 session' : `${punches.length} sessions`}
      </p>

      {leave ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm">
          <Plane className="h-4 w-4 text-primary-strong" />
          <span className="capitalize">{leave.type} leave</span>
          <Badge variant="success">Approved</Badge>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-foreground">Punches</h2>

          {punches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No punches recorded on this day.</p>
          ) : (
            <ul className="space-y-3">
              {punches.map((punch) => {
                const pending = pendingByPunch.get(punch.id)
                return (
                  <li key={punch.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium tabular-nums">
                        {formatTime(punch.clockInAt)} →{' '}
                        {punch.clockOutAt ? formatTime(punch.clockOutAt) : 'still open'}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {hoursBetween(punch.clockInAt, punch.clockOutAt).toFixed(1)}h
                        {punch.overtimeMinutes ? ` · ${punch.overtimeMinutes}m overtime` : ''}
                      </span>
                    </div>

                    {punch.clockInFlag !== 'on_time' || punch.clockOutFlag !== 'on_time' ? (
                      <div className="flex flex-wrap gap-1.5">
                        <ShiftFlagBadge label="in" flag={punch.clockInFlag} />
                        <ShiftFlagBadge label="out" flag={punch.clockOutFlag} />
                      </div>
                    ) : null}

                    {pending ? (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="warning">Correction pending</Badge>
                        <span className="text-muted-foreground">
                          {formatTime(pending.proposedClockInAt)} →{' '}
                          {pending.proposedClockOutAt
                            ? formatTime(pending.proposedClockOutAt)
                            : 'open'}
                        </span>
                      </div>
                    ) : (
                      <CorrectionForm
                        dateKey={date}
                        punchId={punch.id}
                        userId={user.id}
                        defaultClockIn={timeInputValue(punch.clockInAt)}
                        defaultClockOut={
                          punch.clockOutAt ? timeInputValue(punch.clockOutAt) : undefined
                        }
                        label="Request a correction"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-border pt-3">
            <CorrectionForm
              dateKey={date}
              punchId={null}
              userId={user.id}
              label="Add a missing punch"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
