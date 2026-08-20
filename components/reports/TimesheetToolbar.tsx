'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { FileSpreadsheet, FileText, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { PERIOD_OPTIONS } from '@/lib/reports/periods'

export interface BranchOption {
  id: string
  name: string
}

/**
 * Filters and export triggers. Filters drive the page via query params (the
 * page is a Server Component, so changing a filter refetches server-side); the
 * export buttons hand the same params to the API route, guaranteeing the
 * downloaded file matches exactly what's on screen.
 */
export default function TimesheetToolbar({
  branches,
  canChooseBranch,
  lockedBranchName,
}: {
  branches: BranchOption[]
  /** Org-wide viewers pick any branch; branch-scoped viewers are pinned. */
  canChooseBranch: boolean
  lockedBranchName: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [downloading, setDownloading] = useState<string | null>(null)

  const branch = searchParams.get('branch') ?? 'all'
  const period = searchParams.get('period') ?? 'this-month'
  const groupBy = searchParams.get('groupBy') ?? 'branch'
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => router.push(`/reports/timesheets?${next.toString()}`))
  }

  const exportHref = (format: 'csv' | 'xlsx' | 'pdf') => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('format', format)
    return `/api/reports/timesheet?${next.toString()}`
  }

  // A plain <a download> would be simpler, but the route can return a 403 and
  // a link would navigate away to an error page. Fetching lets us keep the
  // user in place and surface the failure.
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setDownloading(format)
    try {
      const response = await fetch(exportHref(format))
      if (!response.ok) {
        throw new Error(await response.text())
      }
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = match?.[1] ?? `timesheet.${format}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div data-tour="timesheet-filters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="branch" className="text-xs">
            Branch
          </Label>
          {canChooseBranch ? (
            <Select
              id="branch"
              value={branch}
              onChange={(event) => setParam('branch', event.target.value)}
              className="h-8 text-xs"
            >
              <option value="all">All branches</option>
              {branches.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={lockedBranchName} readOnly disabled className="h-8 text-xs" />
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="period" className="text-xs">
            Period
          </Label>
          <Select
            id="period"
            value={period}
            onChange={(event) => setParam('period', event.target.value)}
            className="h-8 text-xs"
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="groupBy" className="text-xs">
            Arrange by
          </Label>
          <Select
            id="groupBy"
            value={groupBy}
            onChange={(event) => setParam('groupBy', event.target.value)}
            className="h-8 text-xs"
          >
            <option value="branch">Branch, then name</option>
            <option value="name">Name</option>
          </Select>
        </div>

        {period === 'custom' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">
                From
              </Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(event) => setParam('from', event.target.value)}
                className="h-8 text-xs"
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
                className="h-8 text-xs"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-end">
            <p className="text-xs text-muted-foreground">
              {isPending ? 'Updating…' : 'Exports match the filters shown here.'}
            </p>
          </div>
        )}
      </div>

      <div data-tour="timesheet-export" className="flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          type="button"
          size="sm"
          onClick={() => download('xlsx')}
          disabled={downloading !== null}
        >
          {downloading === 'xlsx' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" />
          )}
          Excel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => download('pdf')}
          disabled={downloading !== null}
        >
          {downloading === 'pdf' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          PDF
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => download('csv')}
          disabled={downloading !== null}
        >
          {downloading === 'csv' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          CSV
        </Button>
      </div>
    </div>
  )
}
