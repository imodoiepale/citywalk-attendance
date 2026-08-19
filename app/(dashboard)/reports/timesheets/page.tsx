import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { createClient } from '@/lib/supabase/server'
import { loadTimesheet, type GroupBy } from '@/lib/reports/timesheets'
import { isPeriodPreset, resolvePeriod } from '@/lib/reports/periods'
import TimesheetTable from '@/components/reports/TimesheetTable'
import TimesheetToolbar from '@/components/reports/TimesheetToolbar'

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    branch?: string
    period?: string
    groupBy?: string
    from?: string
    to?: string
  }>
}) {
  const user = await requireUser()

  const orgWide = canAtLeast(user.permissions, user.role, 'report.view.org', 'org')
  const branchScoped = canAtLeast(user.permissions, user.role, 'report.view.branch', 'branch')
  if (!orgWide && !branchScoped) {
    redirect('/?error=forbidden')
  }

  const params = await searchParams
  const { from, to, label: periodLabel } = resolvePeriod(
    isPeriodPreset(params.period) ? params.period : 'this-month',
    { from: params.from, to: params.to }
  )
  const groupBy: GroupBy = params.groupBy === 'name' ? 'name' : 'branch'

  // Same pinning rule as the export route: only org-wide viewers may widen the
  // scope past their own branch.
  const branchId = orgWide ? (params.branch && params.branch !== 'all' ? params.branch : null) : user.branchId

  const supabase = await createClient()
  const { data: branchRows } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  const branches = (branchRows ?? []).map((row) => ({ id: row.id, name: row.name }))

  const branchLabel = branchId
    ? (branches.find((option) => option.id === branchId)?.name ?? user.branchName)
    : 'All branches'

  const timesheet = await loadTimesheet({ branchId, from, to, groupBy, branchLabel })

  return (
    <div className="mx-auto max-w-[100rem] space-y-4 px-3 py-4 sm:px-4 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Reports
          </Link>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Timesheets</h1>
          <p className="text-xs text-muted-foreground">
            {branchLabel} · {periodLabel} · {timesheet.rows.length} staff ·{' '}
            {timesheet.grandTotalHours.toFixed(1)}h total
          </p>
        </div>
      </div>

      {/* useSearchParams in the toolbar needs a Suspense boundary. */}
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-secondary" />}>
        <TimesheetToolbar
          branches={branches}
          canChooseBranch={orgWide}
          lockedBranchName={user.branchName}
        />
      </Suspense>

      <TimesheetTable
        rows={timesheet.rows.map((row) => ({
          userId: row.userId,
          fullName: row.fullName,
          branchName: row.branchName,
          jobTitle: row.jobTitle,
          days: row.days,
          daysWorked: row.daysWorked,
          overtimeHours: row.overtimeHours,
          totalHours: row.totalHours,
        }))}
        dateKeys={timesheet.dateKeys}
      />
    </div>
  )
}
