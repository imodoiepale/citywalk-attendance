import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getCorrectionQueue, getRecentCorrectionDecisions } from '@/lib/corrections/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import CorrectionDecisionButtons from '@/components/corrections/CorrectionDecisionButtons'

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'secondary'> = {
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
}

export default async function CorrectionsPage() {
  const user = await requireUser()

  const orgWide = canAtLeast(user.permissions, user.role, 'attendance.correct.org', 'org')
  const branchScoped = canAtLeast(user.permissions, user.role, 'attendance.correct.branch', 'branch')
  if (!orgWide && !branchScoped) {
    redirect('/?error=forbidden')
  }

  const [queue, decided] = await Promise.all([
    getCorrectionQueue(user.branchId, orgWide),
    getRecentCorrectionDecisions(user.branchId, orgWide),
  ])

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      <div>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Punch corrections</h1>
        <p className="text-xs text-muted-foreground">
          {orgWide ? 'Every branch' : user.branchName} · {queue.length} awaiting a decision.
          Approving rewrites the punch and updates every report.
        </p>
      </div>

      {queue.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nothing awaiting a decision.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {queue.map((correction) => (
            <li key={correction.id}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        {correction.userName}
                        <span className="ml-2 font-normal text-muted-foreground">
                          {correction.branchName}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Filed by {correction.requestedByName} · {formatDateTime(correction.createdAt)}
                      </p>
                    </div>
                    <Badge variant={correction.punchId ? 'warning' : 'secondary'}>
                      {correction.punchId ? 'Edit punch' : 'Missing punch'}
                    </Badge>
                  </div>

                  <Table containerClassName="rounded-lg border border-border">
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead>Clock in</TableHead>
                        <TableHead>Clock out</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="text-muted-foreground">Recorded</TableCell>
                        <TableCell className="tabular-nums">
                          {formatDateTime(correction.originalClockInAt)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatDateTime(correction.originalClockOutAt)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Proposed</TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {formatDateTime(correction.proposedClockInAt)}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {formatDateTime(correction.proposedClockOutAt)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  <p className="rounded-lg bg-secondary/40 px-3 py-2 text-sm text-foreground">
                    {correction.reason}
                  </p>

                  <CorrectionDecisionButtons id={correction.id} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Recent decisions</h2>
          <Table containerClassName="rounded-xl border border-border">
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead>Proposed</TableHead>
                <TableHead>Decided</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided.map((correction) => (
                <TableRow key={correction.id}>
                  <TableCell className="font-medium">{correction.userName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(correction.proposedClockInAt)} →{' '}
                    {formatDateTime(correction.proposedClockOutAt)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(correction.decidedAt)}
                  </TableCell>
                  <TableCell>{correction.decidedByName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[correction.status] ?? 'secondary'}>
                      {correction.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}
