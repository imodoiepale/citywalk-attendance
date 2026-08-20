import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listUnmatchedScans } from '@/lib/biometric/queries'
import { listAllUsers } from '@/lib/admin/queries'
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
import MapEnrollmentForm from '@/components/devices/MapEnrollmentForm'

function when(iso: string) {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

export default async function UnmatchedScansPage() {
  await requirePermission('admin.devices', 'full')
  const [scans, users] = await Promise.all([listUnmatchedScans(), listAllUsers()])

  const staff = users
    .filter((u) => u.isActive)
    .map((u) => ({ id: u.id, fullName: u.fullName, branchName: u.branchName }))

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/devices"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Devices
        </Link>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Unmatched scans</h1>
        <p className="text-xs text-muted-foreground">
          Scans from enrollment numbers nobody is mapped to. Nothing here is lost — assign a number
          to someone and every scan it has ever made is applied to their timesheet.
        </p>
      </div>

      {scans.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No unmatched scans. Every scan received so far belongs to someone.
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="rounded-xl border border-border">
          <TableHeader sticky>
            <TableRow>
              <TableRowNumberHead />
              <TableHead>Enrollment</TableHead>
              <TableHead>Device</TableHead>
              <TableHead className="text-right">Scans</TableHead>
              <TableHead>First</TableHead>
              <TableHead>Latest</TableHead>
              <TableHead>Assign to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scans.map((scan, index) => (
              <TableRow key={`${scan.externalUserId}-${scan.deviceSerial}`}>
                  <TableRowNumber value={index + 1} />
                <TableCell className="font-mono text-xs font-medium">
                  {scan.externalUserId}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {scan.deviceName ?? (
                    <span className="font-mono text-xs">{scan.deviceSerial}</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{scan.scans}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {when(scan.firstSeen)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {when(scan.lastSeen)}
                </TableCell>
                <TableCell>
                  <MapEnrollmentForm
                    staff={staff}
                    fixedDeviceUserId={scan.externalUserId}
                    label="Assign"
                    compact
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
