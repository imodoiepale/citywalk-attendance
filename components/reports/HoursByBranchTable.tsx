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
import type { BranchHoursRow } from '@/lib/reports/analytics'

export default function HoursByBranchTable({
  rows,
  totalStaffByBranch,
}: {
  rows: BranchHoursRow[]
  totalStaffByBranch: Map<string, number>
}) {
  const totalHours = rows.reduce((sum, row) => sum + row.totalHours, 0)
  const totalActive = rows.reduce((sum, row) => sum + row.activeStaff, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hours worked by branch</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No punches in this period.</p>
        ) : (
          <Table containerClassName="border-t border-border">
            <TableHeader>
              <TableRow>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Active staff</TableHead>
                <TableHead className="text-right">Total hours</TableHead>
                <TableHead className="text-right">Avg hours / staff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.branchId}>
                  <TableCell className="font-medium text-foreground">
                    {row.branchName}{' '}
                    <span className="text-muted-foreground">({row.branchCode})</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.activeStaff} / {totalStaffByBranch.get(row.branchId) ?? row.activeStaff}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {row.totalHours.toFixed(1)}h
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {(row.totalHours / Math.max(1, row.activeStaff)).toFixed(1)}h
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">All branches</TableCell>
                <TableCell className="text-right tabular-nums">{totalActive}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {totalHours.toFixed(1)}h
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(totalHours / Math.max(1, totalActive)).toFixed(1)}h
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
