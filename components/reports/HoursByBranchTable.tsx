import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BranchHoursRow } from '@/lib/reports/analytics'

export default function HoursByBranchTable({
  rows,
  totalStaffByBranch,
}: {
  rows: BranchHoursRow[]
  totalStaffByBranch: Map<string, number>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hours worked by branch</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No punches in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Branch</th>
                  <th className="px-5 py-2 font-medium">Active staff</th>
                  <th className="px-5 py-2 font-medium">Total hours</th>
                  <th className="px-5 py-2 font-medium">Avg hours / staff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.branchId} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-foreground">
                      {row.branchName} <span className="text-muted-foreground">({row.branchCode})</span>
                    </td>
                    <td className="px-5 py-2.5 font-mono text-muted-foreground">
                      {row.activeStaff} / {totalStaffByBranch.get(row.branchId) ?? row.activeStaff}
                    </td>
                    <td className="px-5 py-2.5 font-mono">{row.totalHours.toFixed(1)}h</td>
                    <td className="px-5 py-2.5 font-mono text-muted-foreground">
                      {(row.totalHours / Math.max(1, row.activeStaff)).toFixed(1)}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
