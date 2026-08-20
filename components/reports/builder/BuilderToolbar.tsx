'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { PERIOD_OPTIONS } from '@/lib/reports/periods'
import {
  CHART_LABELS,
  DATASETS,
  DATASET_LIST,
  DIMENSION_LABELS,
  isTimeDimension,
  type ChartType,
  type ReportSpec,
} from '@/lib/reports/builder/spec'
import type { BranchOption } from '@/components/reports/TimesheetToolbar'

/**
 * The report controls.
 *
 * Everything lives in the query string, so a report is a URL: it can be
 * bookmarked, shared with the accounts team, or saved as a preset without any
 * extra plumbing. The controls only ever offer combinations the chosen dataset
 * actually supports — the alternative is letting someone build a chart that
 * renders but means nothing.
 */
export default function BuilderToolbar({
  spec,
  branches,
  canChooseBranch,
  lockedBranchName,
}: {
  spec: ReportSpec
  branches: BranchOption[]
  canChooseBranch: boolean
  lockedBranchName: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const meta = DATASETS[spec.dataset]
  const period = searchParams.get('period') ?? 'this-month'
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const push = (mutate: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString())
    mutate(next)
    startTransition(() => router.push(`/reports/builder?${next.toString()}`))
  }

  const setParam = (key: string, value: string) =>
    push((params) => {
      if (value) params.set(key, value)
      else params.delete(key)
    })

  // Switching dataset drops the dimensions, since they rarely carry over —
  // leaving a stale `groupBy=health` on the hours dataset would silently fall
  // back and show a chart the controls claim is something else.
  const setDataset = (value: string) =>
    push((params) => {
      params.set('dataset', value)
      params.delete('groupBy')
      params.delete('splitBy')
    })

  const chartOptions = (Object.keys(CHART_LABELS) as ChartType[]).filter(
    // A line implies an ordered axis; offering it for a ranking would invite a
    // trend reading that the categories cannot support.
    (type) => type !== 'line' || isTimeDimension(spec.groupBy)
  )

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="dataset" className="text-xs">
            Data
          </Label>
          <Select
            id="dataset"
            value={spec.dataset}
            onChange={(event) => setDataset(event.target.value)}
            className="h-9"
          >
            {DATASET_LIST.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="groupBy" className="text-xs">
            Group by
          </Label>
          <Select
            id="groupBy"
            value={spec.groupBy}
            onChange={(event) => setParam('groupBy', event.target.value)}
            className="h-9"
          >
            {meta.dimensions.map((dimension) => (
              <option key={dimension} value={dimension}>
                {DIMENSION_LABELS[dimension]}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="chart" className="text-xs">
            Show as
          </Label>
          <Select
            id="chart"
            value={spec.chart}
            onChange={(event) => setParam('chart', event.target.value)}
            className="h-9"
          >
            {chartOptions.map((type) => (
              <option key={type} value={type}>
                {CHART_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>

        {spec.chart === 'stacked' ? (
          <div className="space-y-1">
            <Label htmlFor="splitBy" className="text-xs">
              Split by
            </Label>
            <Select
              id="splitBy"
              value={spec.splitBy ?? ''}
              onChange={(event) => setParam('splitBy', event.target.value)}
              className="h-9"
            >
              {meta.splits
                .filter((dimension) => dimension !== spec.groupBy)
                .map((dimension) => (
                  <option key={dimension} value={dimension}>
                    {DIMENSION_LABELS[dimension]}
                  </option>
                ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="branch" className="text-xs">
              Branch
            </Label>
            {canChooseBranch ? (
              <Select
                id="branch"
                value={spec.branchId ?? 'all'}
                onChange={(event) => setParam('branch', event.target.value)}
                className="h-9"
              >
                <option value="all">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={lockedBranchName} disabled className="h-9" />
            )}
          </div>
        )}
      </div>

      {meta.periodFiltered ? (
        <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="period" className="text-xs">
              Period
            </Label>
            <Select
              id="period"
              value={period}
              onChange={(event) => setParam('period', event.target.value)}
              className="h-9"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>

          {period === 'custom' ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="from" className="text-xs">
                  From
                </Label>
                <Input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(event) => setParam('from', event.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to" className="text-xs">
                  To
                </Label>
                <Input
                  id="to"
                  type="date"
                  value={to}
                  onChange={(event) => setParam('to', event.target.value)}
                  className="h-9"
                />
              </div>
            </>
          ) : null}

          {spec.chart === 'stacked' && canChooseBranch ? (
            <div className="space-y-1">
              <Label htmlFor="branch-stacked" className="text-xs">
                Branch
              </Label>
              <Select
                id="branch-stacked"
                value={spec.branchId ?? 'all'}
                onChange={(event) => setParam('branch', event.target.value)}
                className="h-9"
              >
                <option value="all">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Device state is current, so this report ignores the date range.
        </p>
      )}

      {isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Updating…
        </p>
      ) : null}
    </div>
  )
}
