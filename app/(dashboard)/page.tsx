import { AlertTriangle } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getTodaysPunches, getWeeklyHours } from '@/lib/punches/queries'
import { countApprovalQueue, countMyPendingLeave } from '@/lib/leave/queries'
import DashboardClient from '@/components/DashboardClient'
import { hoursToSeconds } from '@/lib/targets'
import { getSettings } from '@/lib/settings'

// requirePermission() bounces unauthorized users here with ?error=forbidden.
// Without reading it back out, that redirect lands silently on the dashboard
// and the user is left wondering why the page they clicked never opened.
const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "You don't have permission to open that page.",
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireUser()
  const params = await searchParams
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] : undefined

  const canApproveOrg = canAtLeast(user.permissions, user.role, 'leave.approve.org', 'org')
  const canApproveBranch = canAtLeast(user.permissions, user.role, 'leave.approve.branch', 'branch')

  const [settings, punches, weekHours, pendingLeaveCount, awaitingApprovalCount] = await Promise.all([
    getSettings(),
    getTodaysPunches(user.id),
    getWeeklyHours(user.id),
    countMyPendingLeave(user.id),
    canApproveOrg || canApproveBranch
      ? countApprovalQueue(user.branchId, canApproveOrg)
      : Promise.resolve(null),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4 sm:space-y-6 sm:py-6">
      {errorMessage ? (
        <div className="mx-auto flex max-w-md items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          {errorMessage}
        </div>
      ) : null}

      <div className="text-center">
        <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-2xl">
          Hi {user.fullName.split(' ')[0]}
        </h1>
        <p className="text-xs text-muted-foreground sm:text-sm">{user.branchName}</p>
      </div>

      <DashboardClient
        punches={punches}
        summary={{
          weekHours,
          weekTargetHours: settings.weeklyTargetHours,
          pendingLeaveCount,
          awaitingApprovalCount,
        }}
        targetSeconds={hoursToSeconds(settings.dailyTargetHours)}
        approachingSeconds={hoursToSeconds(settings.approachingThresholdHours)}
      />
    </div>
  )
}
