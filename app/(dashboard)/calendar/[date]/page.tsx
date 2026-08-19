import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, Plane } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { getPunchesForDay } from '@/lib/punches/queries'
import { getLeaveOnDay } from '@/lib/leave/queries'
import { getMyCorrections } from '@/lib/corrections/queries'
import { getSettings } from '@/lib/settings'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import CorrectionForm from '@/components/corrections/CorrectionForm'

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

export default async function DayDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

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

  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const [year, month] = date.split('-')

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div>
        <Link
          href={`/calendar?year=${year}&month=${Number(month)}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Calendar
        </Link>
        <h1 className="text-lg font-bold text-foreground">{label}</h1>
        <p className="text-xs text-muted-foreground">
          {totalHours.toFixed(1)}h worked of a {settings.dailyTargetHours}h target ·{' '}
          {punches.length === 1 ? '1 session' : `${punches.length} sessions`}
        </p>
      </div>

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
                      </span>
                    </div>

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
