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
import type { BuilderResult } from '@/lib/reports/builder/datasets'

/**
 * The same numbers the chart draws, as a table.
 *
 * Always rendered, not only for the "Table" view: a chart is for seeing the
 * shape, but the figure someone types into a payroll sheet should be readable
 * exactly, not estimated off an axis.
 */
export default function ResultTable({
  result,
  groupLabel,
}: {
  result: BuilderResult
  groupLabel: string
}) {
  if (result.rows.length === 0) return null

  const multiSeries = result.series.length > 1
  const columnTotal = (series: string) =>
    result.rows.reduce((sum, row) => sum + Number(row[series] ?? 0), 0)
  const rowTotal = (row: (typeof result.rows)[number]) =>
    result.series.reduce((sum, series) => sum + Number(row[series] ?? 0), 0)

  return (
    <Table containerClassName="rounded-xl border border-border">
      <TableHeader sticky>
        <TableRow>
          <TableRowNumberHead />
          <TableHead>{groupLabel}</TableHead>
          {result.series.map((series) => (
            <TableHead key={series} className="text-right">
              {series}
            </TableHead>
          ))}
          {multiSeries ? <TableHead className="text-right">Total</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row, index) => (
          <TableRow key={row.group}>
            <TableRowNumber value={index + 1} />
            <TableCell className="font-medium text-foreground">{row.group}</TableCell>
            {result.series.map((series) => (
              <TableCell key={series} className="text-right tabular-nums">
                {Number(row[series] ?? 0).toLocaleString('en-KE')}
              </TableCell>
            ))}
            {multiSeries ? (
              <TableCell className="text-right font-semibold tabular-nums">
                {Math.round(rowTotal(row) * 10) / 10}
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableRowNumber value={0} className="text-transparent" aria-hidden="true" />
          <TableCell className="font-semibold">All {result.rows.length} rows</TableCell>
          {result.series.map((series) => (
            <TableCell key={series} className="text-right font-semibold tabular-nums">
              {(Math.round(columnTotal(series) * 10) / 10).toLocaleString('en-KE')}
            </TableCell>
          ))}
          {multiSeries ? (
            <TableCell className="text-right font-semibold tabular-nums">
              {result.total.toLocaleString('en-KE')}
            </TableCell>
          ) : null}
        </TableRow>
      </TableFooter>
    </Table>
  )
}
