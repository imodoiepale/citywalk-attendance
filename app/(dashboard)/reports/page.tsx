import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChartColumnBig, TableProperties } from 'lucide-react'
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
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Reports</h1>
            <p className="text-sm text-muted-foreground">
              {orgWide
                ? 'Hours and leave across every branch'
                : `Hours and leave for ${user.branchName}`}{' '}
              — last {days} days.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/reports/builder"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card-hover"
            >
              <ChartColumnBig className="h-4 w-4" />
              Build a report
            </Link>
            <Link
              href="/reports/timesheets"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/85"
            >
              <TableProperties className="h-4 w-4" />
              Timesheets &amp; export
            </Link>
          </div>
        </div>
        <HoursByBranchTable
          rows={analytics.hoursByBranch}
          totalStaffByBranch={analytics.totalStaffByBranch}
        />
        <LeaveSummaryTable rows={analytics.leaveByBranchType} />
      </div>
    </div>
  )
}
