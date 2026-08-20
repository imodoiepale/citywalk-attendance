import Link from 'next/link'
import { ChevronLeft, DoorClosed, Fingerprint, TriangleAlert } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listDevices, summarise } from '@/lib/biometric/queries'
import { listBranches } from '@/lib/admin/queries'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import DeviceSheet from '@/components/devices/DeviceSheet'
import DeviceHealthBadge from '@/components/devices/DeviceHealthBadge'

function relative(iso: string | null) {
  if (!iso) return 'never'
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' | 'bad' }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={`text-lg font-semibold tabular-nums ${
            value === 0 ? 'text-foreground' : tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : 'text-foreground'
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function DevicesPage() {
  await requirePermission('admin.devices', 'full')
  const [devices, branches] = await Promise.all([listDevices(), listBranches()])
  const summary = summarise(devices)
  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }))

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Admin
          </Link>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Biometric devices</h1>
          <p className="text-xs text-muted-foreground">
            Every reader across branches, warehouses and restricted areas — whether or not it clocks
            attendance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/devices/enrollments"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Fingerprint className="h-4 w-4" />
            Enrollments
          </Link>
          <Link
            href="/admin/devices/unmatched"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            Unmatched scans
          </Link>
          <DeviceSheet branches={branchOptions} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Devices" value={summary.total} />
        <Stat label="Online" value={summary.online} />
        <Stat label="Not seen recently" value={summary.stale} tone="warn" />
        <Stat label="Offline" value={summary.offline} tone="bad" />
        <Stat label="Never reported" value={summary.neverSeen} tone="warn" />
        <Stat label="Scans (24h)" value={summary.events24h} />
      </div>

      {summary.unassigned > 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
          {summary.unassigned === 1
            ? '1 attendance device has no branch, so its scans cannot become punches.'
            : `${summary.unassigned} attendance devices have no branch, so their scans cannot become punches.`}
        </div>
      ) : null}

      {devices.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">No devices registered yet.</p>
            <p className="text-xs text-muted-foreground">
              Add one by serial number, then point it at{' '}
              <code className="rounded bg-secondary px-1 py-0.5">/api/biometric/iclock</code> or post
              its scans to <code className="rounded bg-secondary px-1 py-0.5">/api/biometric/events</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="rounded-xl border border-border">
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Serial</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>Used for</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead className="text-right">24h</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="font-medium">{device.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {device.serialNo}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {device.locationLabel ?? device.branchName ?? (
                    <span className="text-warning">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>
                  {device.purpose === 'access' ? (
                    <Badge variant="secondary">
                      <DoorClosed className="mr-1 h-3 w-3" />
                      Access
                    </Badge>
                  ) : (
                    <Badge variant="outline">Attendance</Badge>
                  )}
                </TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {device.direction === 'both' ? 'In / Out' : device.direction}
                </TableCell>
                <TableCell>
                  <DeviceHealthBadge health={device.health} />
                </TableCell>
                <TableCell className="text-muted-foreground">{relative(device.lastSeenAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{device.events24h}</TableCell>
                <TableCell>
                  <DeviceSheet
                    device={device}
                    branches={branchOptions}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
                    }
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
