import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { LeaveSummaryRow } from '@/lib/reports/analytics'

export default function LeaveSummaryTable({ rows }: { rows: LeaveSummaryRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approved leave by type</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            No approved leave in this period.
          </p>
        ) : (
          <Table containerClassName="border-t border-border">
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Requests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.branchId}-${row.type}`}>
                  <TableCell className="font-medium text-foreground">{row.branchName}</TableCell>
                  <TableCell className="capitalize text-muted-foreground">{row.type}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total</TableCell>
                <TableCell />
                <TableCell className="text-right font-semibold tabular-nums">{total}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
