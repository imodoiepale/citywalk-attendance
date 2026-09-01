import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { listRecentPunches } from '@/lib/attendance/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowNumber,
  TableRowNumberHead,
} from '@/components/ui/table'
import DeleteWithReasonForm from '@/components/attendance/DeleteWithReasonForm'
import { deletePunchAction } from '@/lib/attendance/actions'

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

const FLAG_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  on_time: 'success',
  early: 'warning',
  late: 'warning',
  out_of_window: 'destructive',
}

function FlagBadge({ label, flag }: { label: string; flag: string | null }) {
  if (!flag || flag === 'on_time') return null
  return (
    <Badge variant={FLAG_VARIANT[flag] ?? 'secondary'} className="ml-1">
      {label} {flag.replace('_', ' ')}
    </Badge>
  )
}

export default async function PunchesPage() {
  const user = await requireUser()

  const orgWide = canAtLeast(user.permissions, user.role, 'attendance.delete.org', 'org')
  const branchScoped = canAtLeast(user.permissions, user.role, 'attendance.delete.branch', 'branch')
  if (!orgWide && !branchScoped) {
    redirect('/?error=forbidden')
  }

  const punches = await listRecentPunches(user.branchId, orgWide)

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Punches</h1>
          <p className="text-xs text-muted-foreground">
            {orgWide ? 'Every branch' : user.branchName} · recent punches. Deleting one is
            permanent and requires a reason — it&rsquo;s recorded in{' '}
            <a href="/admin/audit" className="underline">
              the audit log
            </a>{' '}
            either way. Use this for a rogue double-clock-in or a genuine mistake; for a missed or
            wrong time, prefer{' '}
            <a href="/attendance/corrections" className="underline">
              a correction
            </a>{' '}
            instead, which keeps both the original and the fix on record.
          </p>
        </div>

        {punches.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No punches yet.
            </CardContent>
          </Card>
        ) : (
          <Table containerClassName="rounded-xl border border-border">
            <TableHeader sticky>
              <TableRow>
                <TableRowNumberHead />
                <TableHead>Staff</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Clock in</TableHead>
                <TableHead>Clock out</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">OT (min)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {punches.map((punch, index) => (
                <TableRow key={punch.id}>
                  <TableRowNumber value={index + 1} />
                  <TableCell className="font-medium">{punch.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{punch.branchName}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(punch.clockInAt)}
                    <FlagBadge label="in" flag={punch.clockInFlag} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTime(punch.clockOutAt)}
                    <FlagBadge label="out" flag={punch.clockOutFlag} />
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">{punch.method}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {punch.overtimeMinutes > 0 ? punch.overtimeMinutes : '—'}
                  </TableCell>
                  <TableCell>
                    <DeleteWithReasonForm action={deletePunchAction} idField="id" idValue={punch.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
