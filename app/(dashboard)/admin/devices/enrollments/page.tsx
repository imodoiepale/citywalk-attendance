import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listEnrollments } from '@/lib/biometric/queries'
import { listAllUsers } from '@/lib/admin/queries'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import MapEnrollmentForm from '@/components/devices/MapEnrollmentForm'

export default async function EnrollmentsPage() {
  await requirePermission('admin.devices', 'full')
  const [enrollments, users] = await Promise.all([listEnrollments(), listAllUsers()])

  const staff = users
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, fullName: u.fullName, branchName: u.branchName }))

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <div>
        <Link
          href="/admin/devices"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Devices
        </Link>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Enrollments</h1>
        <p className="text-xs text-muted-foreground">
          A reader knows a person only as a number. This is what turns that number into their
          attendance. Numbers are fleet-wide, so someone keeps theirs when they move branch.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold text-foreground">Map a number to someone</h2>
          <MapEnrollmentForm staff={staff} label="Save mapping" />
        </CardContent>
      </Card>

      {enrollments.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nothing mapped yet. Until a number is mapped, its scans wait in{' '}
            <Link href="/admin/devices/unmatched" className="underline">
              unmatched scans
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="rounded-xl border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>Enrollment</TableHead>
              <TableHead>Staff</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {enrollments.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.deviceUserId}</TableCell>
                <TableCell>
                  <div className="font-medium text-foreground">{row.fullName}</div>
                  <div className="text-xs text-muted-foreground">{row.email}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.branchName ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{row.note ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
