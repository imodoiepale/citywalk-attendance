import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LeaveSummaryRow } from '@/lib/reports/analytics'

export default function LeaveSummaryTable({ rows }: { rows: LeaveSummaryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Approved leave by type</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No approved leave in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Branch</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Requests</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.branchId}-${row.type}`} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-2.5 font-medium text-foreground">{row.branchName}</td>
                    <td className="px-5 py-2.5 capitalize text-muted-foreground">{row.type}</td>
                    <td className="px-5 py-2.5 font-mono">{row.count}</td>
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
