'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import TimesheetTable, { type TimesheetTableRow } from './TimesheetTable'
import type { Granularity } from '@/lib/reports/grouping'

/**
 * Connects the timesheet table's column grouping to the URL.
 *
 * Kept in the query string rather than component state so the export route
 * reads the same value — otherwise a download could silently disagree with the
 * page it was taken from.
 */
export default function TimesheetGrid({
  rows,
  dateKeys,
  granularity,
}: {
  rows: TimesheetTableRow[]
  dateKeys: string[]
  granularity: Granularity
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const setGranularity = useCallback(
    (next: Granularity) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === 'day') params.delete('granularity')
      else params.set('granularity', next)
      startTransition(() => router.replace(`/reports/timesheets?${params.toString()}`))
    },
    [router, searchParams]
  )

  return (
    <TimesheetTable
      rows={rows}
      dateKeys={dateKeys}
      granularity={granularity}
      onGranularityChange={setGranularity}
    />
  )
}
