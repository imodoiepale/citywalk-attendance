import 'server-only'
import type { Timesheet, TimesheetRow } from '@/lib/reports/timesheets'

// The single flattening step every export format shares. XLSX, PDF and CSV all
// consume this — so a column added here appears in all three, and none of them
// can drift into showing different numbers.

export interface ExportColumn {
  key: string
  header: string
  /** Rough character width, used for XLSX auto-fit and PDF column sizing. */
  width: number
  align: 'left' | 'right'
  numeric: boolean
}

export interface ExportTable {
  title: string
  subtitle: string
  generatedAt: string
  columns: ExportColumn[]
  rows: (string | number)[][]
  /** Row indices that begin a new branch, for group headings in XLSX/PDF. */
  groupBreaks: { index: number; label: string }[]
  totals: (string | number)[]
}

function shortDayHeader(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`)
  const weekday = date.toLocaleDateString('en-KE', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} ${dateKey.slice(8, 10)}`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function buildExportTable(timesheet: Timesheet): ExportTable {
  const columns: ExportColumn[] = [
    { key: 'name', header: 'Employee', width: 26, align: 'left', numeric: false },
    { key: 'branch', header: 'Branch', width: 18, align: 'left', numeric: false },
    { key: 'jobTitle', header: 'Job title', width: 18, align: 'left', numeric: false },
    ...timesheet.dateKeys.map((key) => ({
      key,
      header: shortDayHeader(key),
      width: 8,
      align: 'right' as const,
      numeric: true,
    })),
    { key: 'daysWorked', header: 'Days', width: 7, align: 'right', numeric: true },
    { key: 'overtime', header: 'Overtime', width: 10, align: 'right', numeric: true },
    { key: 'total', header: 'Total hrs', width: 11, align: 'right', numeric: true },
  ]

  const toCells = (row: TimesheetRow): (string | number)[] => [
    row.fullName,
    row.branchName,
    row.jobTitle ?? '',
    ...timesheet.dateKeys.map((key) => round1(row.days[key] ?? 0)),
    row.daysWorked,
    round1(row.overtimeHours),
    round1(row.totalHours),
  ]

  const groupBreaks: { index: number; label: string }[] = []
  if (timesheet.groupBy === 'branch') {
    let current: string | null = null
    timesheet.rows.forEach((row, index) => {
      if (row.branchName !== current) {
        groupBreaks.push({ index, label: row.branchName })
        current = row.branchName
      }
    })
  }

  const dayTotals = timesheet.dateKeys.map((key) =>
    round1(timesheet.rows.reduce((sum, row) => sum + (row.days[key] ?? 0), 0))
  )

  const totals: (string | number)[] = [
    `Total — ${timesheet.rows.length} staff`,
    '',
    '',
    ...dayTotals,
    timesheet.rows.reduce((sum, row) => sum + row.daysWorked, 0),
    round1(timesheet.grandOvertimeHours),
    round1(timesheet.grandTotalHours),
  ]

  const fromLabel = timesheet.from.slice(0, 10)
  const toLabel = timesheet.to.slice(0, 10)

  return {
    title: 'Citywalk Attendance — Timesheet',
    subtitle: `${timesheet.branchLabel} · ${fromLabel} to ${toLabel} · grouped by ${timesheet.groupBy}`,
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    columns,
    rows: timesheet.rows.map(toCells),
    groupBreaks,
    totals,
  }
}

/** Safe, descriptive download filename stem. */
export function exportFileStem(timesheet: Timesheet): string {
  const slug = timesheet.branchLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `citywalk-timesheet-${slug}-${timesheet.from.slice(0, 10)}-to-${timesheet.to.slice(0, 10)}`
}
