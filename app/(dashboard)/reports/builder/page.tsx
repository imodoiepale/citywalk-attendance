import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, ChevronLeft } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { createClient } from '@/lib/supabase/server'
import { isPeriodPreset, resolvePeriod } from '@/lib/reports/periods'
import { runReport } from '@/lib/reports/builder/datasets'
import { DATASETS, DIMENSION_LABELS, parseSpec } from '@/lib/reports/builder/spec'
import BuilderToolbar from '@/components/reports/builder/BuilderToolbar'
import ResultTable from '@/components/reports/builder/ResultTable'
import ReportChart from '@/components/reports/charts/ReportChart'
import { Card, CardContent } from '@/components/ui/card'

export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const user = await requireUser()

  const orgWide = canAtLeast(user.permissions, user.role, 'report.view.org', 'org')
  const branchScoped = canAtLeast(user.permissions, user.role, 'report.view.branch', 'branch')
  if (!orgWide && !branchScoped) {
    redirect('/?error=forbidden')
  }

  const params = await searchParams
  const spec = parseSpec(params)
  const meta = DATASETS[spec.dataset]

  const { from, to, label: periodLabel } = resolvePeriod(
    isPeriodPreset(params.period) ? params.period : 'this-month',
    { from: params.from, to: params.to }
  )

  // Same pinning rule as every other report surface: a branch-scoped viewer
  // cannot widen the scope past their own branch by editing the URL.
  const scopedSpec = { ...spec, branchId: orgWide ? spec.branchId : user.branchId }

  const supabase = await createClient()
  const { data: branchRows } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  const branches = (branchRows ?? []).map((row) => ({ id: row.id, name: row.name }))

  const result = await runReport(scopedSpec, { from, to })
  const groupLabel = DIMENSION_LABELS[scopedSpec.groupBy]

  const branchLabel = scopedSpec.branchId
    ? (branches.find((option) => option.id === scopedSpec.branchId)?.name ?? user.branchName)
    : 'All branches'

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div className="min-w-0">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Reports
          </Link>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Report builder</h1>
          <p className="text-sm text-muted-foreground">
            {meta.label} by {groupLabel.toLowerCase()} · {branchLabel}
            {meta.periodFiltered ? ` · ${periodLabel}` : ''}
          </p>
        </div>

        {/* useSearchParams in the toolbar needs a Suspense boundary. */}
        <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-secondary" />}>
          <BuilderToolbar
            spec={scopedSpec}
            branches={branches}
            canChooseBranch={orgWide}
            lockedBranchName={user.branchName}
          />
        </Suspense>

        {result.truncated ? (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This report hit the {result.cap.toLocaleString('en-KE')}-row limit, so the totals
              below are incomplete. Narrow the period or pick a single branch.
            </span>
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Total {meta.valueLabel.toLowerCase()}
              </p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {result.total.toLocaleString('en-KE')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{groupLabel}s</p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {result.rows.length.toLocaleString('en-KE')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Average per {groupLabel.toLowerCase()}
              </p>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {result.rows.length === 0
                  ? '—'
                  : (Math.round((result.total / result.rows.length) * 10) / 10).toLocaleString(
                      'en-KE'
                    )}
              </p>
            </CardContent>
          </Card>
        </div>

        {scopedSpec.chart !== 'table' ? (
          <Card>
            <CardContent className="p-4">
              <ReportChart
                chart={scopedSpec.chart}
                rows={result.rows}
                series={result.series}
                valueLabel={result.valueLabel}
                groupLabel={groupLabel}
              />
            </CardContent>
          </Card>
        ) : null}

        <ResultTable result={result} groupLabel={groupLabel} />
      </div>
    </div>
  )
}
