'use client'

import Link from 'next/link'
import { CalendarDays, ClipboardList, CheckSquare, Timer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

// Replaces the old CapabilitiesGrid: staff get their own numbers, not a
// roadmap of features that don't exist yet.

export interface DashboardSummary {
  /** Rolling 7-day worked hours, and the target they're measured against. */
  weekHours: number
  weekTargetHours: number
  /** The user's own leave requests still awaiting a decision. */
  pendingLeaveCount: number
  /** Requests waiting on this user to approve — null if they can't approve. */
  awaitingApprovalCount: number | null
}

function formatHours(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Timer
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-0.5 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="h-4 w-4 text-primary-strong" strokeWidth={1.8} />
          {label}
        </div>
        <div className="text-base font-semibold tabular-nums text-foreground sm:text-lg">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

export default function TodaySummary({
  todaySeconds,
  sessionCount,
  summary,
}: {
  todaySeconds: number
  sessionCount: number
  summary: DashboardSummary
}) {
  const weekPercent =
    summary.weekTargetHours > 0
      ? Math.round((summary.weekHours / summary.weekTargetHours) * 100)
      : 0

  return (
    <div className="mx-auto w-full max-w-4xl space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat
          icon={Timer}
          label="Today"
          value={formatHours(todaySeconds)}
          hint={sessionCount === 1 ? '1 session' : `${sessionCount} sessions`}
        />
        <Stat
          icon={CalendarDays}
          label="Last 7 days"
          value={`${summary.weekHours.toFixed(1)}h`}
          hint={`${weekPercent}% of ${summary.weekTargetHours}h`}
        />
        <Stat
          icon={ClipboardList}
          label="My leave"
          value={String(summary.pendingLeaveCount)}
          hint={summary.pendingLeaveCount === 1 ? 'request pending' : 'requests pending'}
        />
        <Stat
          icon={CheckSquare}
          label="Branch"
          value={summary.awaitingApprovalCount === null ? '—' : String(summary.awaitingApprovalCount)}
          hint={summary.awaitingApprovalCount === null ? 'No approval rights' : 'awaiting your decision'}
        />
      </div>

      {summary.awaitingApprovalCount !== null && summary.awaitingApprovalCount > 0 ? (
        <Link
          href="/leave/approvals"
          className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <span>
            {summary.awaitingApprovalCount === 1
              ? '1 leave request is awaiting you'
              : `${summary.awaitingApprovalCount} leave requests are awaiting you`}
          </span>
          <span className="text-primary-strong">Review →</span>
        </Link>
      ) : null}
    </div>
  )
}
