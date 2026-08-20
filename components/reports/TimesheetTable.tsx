'use client'

import { useMemo, useState } from 'react'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Search } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  TableRowNumber,
  TableRowNumberHead,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// TanStack Table v9 (not v8): the table is built with useTable, and every
// capability has to be registered as a feature — sorting/filtering/pagination
// state simply does not exist until its feature appears in this object.
const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  columnVisibilityFeature,
})

export interface TimesheetTableRow {
  userId: string
  fullName: string
  branchName: string
  jobTitle: string | null
  days: Record<string, number>
  daysWorked: number
  overtimeHours: number
  totalHours: number
}

const EMPTY_ROWS: TimesheetTableRow[] = []

const TEXT_COLUMNS = new Set(['fullName', 'branchName', 'jobTitle'])

function formatHours(value: number): string {
  return value === 0 ? '·' : value.toFixed(1)
}

function dayHeader(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`)
  const weekday = date.toLocaleDateString('en-KE', { weekday: 'narrow', timeZone: 'UTC' })
  return `${weekday}${Number(dateKey.slice(8, 10))}`
}

export default function TimesheetTable({
  rows,
  dateKeys,
}: {
  rows: TimesheetTableRow[]
  dateKeys: string[]
}) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [showDayColumns, setShowDayColumns] = useState(true)

  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, TimesheetTableRow>()
    return helper.columns([
      helper.accessor('fullName', { id: 'fullName', header: 'Employee' }),
      helper.accessor('branchName', { id: 'branchName', header: 'Branch' }),
      helper.accessor((row) => row.jobTitle ?? '', { id: 'jobTitle', header: 'Job title' }),
      ...dateKeys.map((key) =>
        helper.accessor((row) => row.days[key] ?? 0, {
          id: `day:${key}`,
          header: dayHeader(key),
        })
      ),
      helper.accessor('daysWorked', { id: 'daysWorked', header: 'Days' }),
      helper.accessor('overtimeHours', { id: 'overtimeHours', header: 'Overtime' }),
      helper.accessor('totalHours', { id: 'totalHours', header: 'Total' }),
    ])
  }, [dateKeys])

  // A month of day columns is unreadable on a laptop, let alone a phone —
  // collapsing them leaves the Days/Overtime/Total summary, which is what most
  // people are actually reading.
  const columnVisibility = useMemo(
    () => (showDayColumns ? {} : Object.fromEntries(dateKeys.map((key) => [`day:${key}`, false]))),
    [showDayColumns, dateKeys]
  )

  const data = rows.length > 0 ? rows : EMPTY_ROWS

  const table = useTable({
    features,
    columns,
    data,
    state: { globalFilter, columnVisibility },
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageIndex: 0, pageSize: 25 } },
  })

  const visibleRows = table.getRowModel().rows
  const visibleColumns = table.getAllColumns().filter((column) => column.getIsVisible())

  const sumOf = (pick: (row: TimesheetTableRow) => number) =>
    visibleRows.reduce((total, row) => total + pick(row.original), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Search staff or branch…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDayColumns((shown) => !shown)}
        >
          <Columns3 className="h-3.5 w-3.5" />
          {showDayColumns ? 'Hide days' : 'Show days'}
        </Button>
      </div>

      <Table containerClassName="max-h-[60vh] overflow-y-auto rounded-xl border border-border">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              <TableRowNumberHead className="sticky top-0 z-10 bg-secondary" />
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted()
                const numeric = !TEXT_COLUMNS.has(header.column.id)
                return (
                  <TableHead
                    key={header.id}
                    className={cn('sticky top-0 z-10 bg-secondary', numeric && 'text-right')}
                  >
                    <button
                      type="button"
                      onClick={() => header.column.toggleSorting()}
                      className={cn(
                        'inline-flex w-full items-center gap-1 hover:text-primary-strong',
                        numeric && 'justify-end'
                      )}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      {sorted === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {visibleRows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={visibleColumns.length + 1}
                className="py-8 text-center text-muted-foreground"
              >
                No staff match this filter.
              </TableCell>
            </TableRow>
          ) : (
            visibleRows.map((row, index) => (
              <TableRow key={row.id}>
                {/* Numbering continues across pages: on page 2 the first row is
                    26, not 1, so a row number is unambiguous when quoted. */}
                <TableRowNumber
                  value={table.state.pagination.pageIndex * table.state.pagination.pageSize + index + 1}
                />
                {/* getVisibleCells, not getAllCells: the latter returns hidden
                    columns too, so with the day columns collapsed each row
                    rendered more cells than the header had and every value
                    after "Job title" sat under the wrong heading. */}
                {row.getVisibleCells().map((cell) => {
                  const id = cell.column.id
                  const isDay = id.startsWith('day:')
                  const numeric = !TEXT_COLUMNS.has(id)
                  const value = cell.getValue()
                  const showAsHours = isDay || id === 'overtimeHours' || id === 'totalHours'
                  return (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        numeric && 'text-right tabular-nums',
                        id === 'fullName' && 'font-medium',
                        id === 'totalHours' && 'font-semibold',
                        isDay && Number(value) === 0 && 'text-muted-foreground/50',
                        id === 'overtimeHours' && Number(value) > 0 && 'text-warning'
                      )}
                    >
                      {showAsHours ? formatHours(Number(value)) : String(value ?? '')}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>

        <TableFooter>
          <TableRow>
            <TableRowNumber value={0} className="text-transparent" aria-hidden="true" />
            {visibleColumns.map((column, index) => {
              const id = column.id
              if (index === 0) {
                return (
                  <TableCell key={id} className="font-semibold">
                    {visibleRows.length} staff
                  </TableCell>
                )
              }
              if (id.startsWith('day:')) {
                const key = id.slice(4)
                return (
                  <TableCell key={id} className="text-right tabular-nums">
                    {formatHours(sumOf((row) => row.days[key] ?? 0))}
                  </TableCell>
                )
              }
              if (id === 'daysWorked') {
                return (
                  <TableCell key={id} className="text-right font-semibold tabular-nums">
                    {sumOf((row) => row.daysWorked)}
                  </TableCell>
                )
              }
              if (id === 'overtimeHours' || id === 'totalHours') {
                return (
                  <TableCell key={id} className="text-right font-semibold tabular-nums">
                    {formatHours(
                      sumOf((row) => (id === 'overtimeHours' ? row.overtimeHours : row.totalHours))
                    )}
                  </TableCell>
                )
              }
              return <TableCell key={id} />
            })}
          </TableRow>
        </TableFooter>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Page {table.state.pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
