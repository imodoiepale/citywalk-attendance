import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { loadAttendanceAnalytics } from '@/lib/reports/analytics'
import HoursByBranchTable from '@/components/reports/HoursByBranchTable'
import LeaveSummaryTable from '@/components/reports/LeaveSummaryTable'

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const user = await requireUser()

  const branchScoped = canAtLeast(user.permissions, user.role, 'report.view.branch', 'branch')
  const orgWide = canAtLeast(user.permissions, user.role, 'report.view.org', 'org')
  if (!branchScoped && !orgWide) {
    redirect('/?error=forbidden')
  }

  const params = await searchParams
  const days = params.days ? parseInt(params.days, 10) : 30
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const analytics = await loadAttendanceAnalytics({
    branchId: orgWide ? null : user.branchId,
    from: from.toISOString(),
    to: to.toISOString(),
  })

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          {orgWide ? 'Hours and leave across every branch' : `Hours and leave for ${user.branchName}`} — last{' '}
          {days} days.
        </p>
      </div>
      <HoursByBranchTable rows={analytics.hoursByBranch} totalStaffByBranch={analytics.totalStaffByBranch} />
      <LeaveSummaryTable rows={analytics.leaveByBranchType} />
    </div>
  )
}
