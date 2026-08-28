import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, Cpu, TriangleAlert } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { getDeviceDetail, listDeviceCommands } from '@/lib/biometric/queries'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import DeviceHealthBadge from '@/components/devices/DeviceHealthBadge'
import DeviceActions from '@/components/devices/DeviceActions'

// One reader in detail: what it is, what it holds, and what has been done to it.
//
// The capability set shown here is driven by `protocol`, because a terminal
// speaks one device family's dialect and the others' features simply do not
// exist on it. An action button that cannot work is worse than no button.

function relative(iso: string | null) {
  if (!iso) return 'never'
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Whether a timestamp is within the last `ms`.
 *
 * A function rather than an inline `Date.now()` in the component body: reading
 * the clock during render is impure, and the lint rule that catches it is
 * right — the same page rendered twice would otherwise disagree with itself.
 */
function within(iso: string | null, ms: number): boolean {
  return iso !== null && Date.now() - new Date(iso).getTime() < ms
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value ?? '—'}</dd>
    </div>
  )
}

/**
 * Capacity as a used/total bar.
 *
 * Worth surfacing because "the reader is full" is a real and confusing failure:
 * enrolments simply stop working, and the device says DatabaseFull to a screen
 * nobody is watching.
 */
function Capacity({ label, used, total }: { label: string; used?: number; total?: number }) {
  if (typeof total !== 'number' || total <= 0) return null
  const usedN = typeof used === 'number' ? used : 0
  const pct = Math.min(100, Math.round((usedN / total) * 100))
  const tone = pct >= 90 ? 'bg-destructive' : pct >= 75 ? 'bg-warning' : 'bg-primary'

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{usedN.toLocaleString()} / {total.toLocaleString()}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  succeeded: 'success',
  queued: 'secondary',
  sent: 'warning',
  failed: 'destructive',
  expired: 'destructive',
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ serial: string }>
}) {
  await requirePermission('admin.devices', 'full')
  const { serial } = await params

  const device = await getDeviceDetail(decodeURIComponent(serial))
  if (!device) notFound()

  const commands = await listDeviceCommands(device.id)

  // "Connected" is not the same as "seen recently": the cloud channel holds a
  // socket open, and that is what decides whether a command goes out now.
  const connected = within(device.cloudConnectedAt, 5 * 60_000)
  const manageable = device.protocol === 'cloud'
  const capacity = device.capacity ?? {}

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/admin/devices"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            All devices
          </Link>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">{device.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{device.serialNo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DeviceHealthBadge health={device.health} />
          {connected ? <Badge variant="success">Connected</Badge> : null}
          {device.protocol ? <Badge variant="secondary">{device.protocol}</Badge> : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Device</h2>
            </div>

            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Model" value={device.model} />
              <Field label="Firmware" value={device.firmware} />
              <Field label="Branch" value={device.branchName ?? device.locationLabel} />
              <Field label="Purpose" value={device.purpose} />
              <Field label="Direction" value={device.direction} />
              <Field label="Last scan" value={relative(device.lastEventAt)} />
              <Field label="Scans (24h)" value={device.events24h.toLocaleString()} />
              <Field label="Last connected" value={relative(device.cloudConnectedAt)} />
              <Field
                label="Template algorithm"
                value={device.fpAlgo ?? <span className="text-muted-foreground">unknown</span>}
              />
            </dl>

            {Object.keys(capacity).length > 0 ? (
              <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                <Capacity label="Users" used={capacity.useduser} total={capacity.usersize} />
                <Capacity label="Fingerprints" used={capacity.usedfp} total={capacity.fpsize} />
                <Capacity label="Cards" used={capacity.usedcard} total={capacity.cardsize} />
                <Capacity label="Log storage" used={capacity.usedlog} total={capacity.logsize} />
              </div>
            ) : null}

            {typeof capacity.usednewlog === 'number' && capacity.usednewlog > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />
                {capacity.usednewlog.toLocaleString()} scans on the device have not been collected.
                Use <span className="font-medium">Pull missed scans</span>.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Actions</h2>
            {manageable ? (
              <DeviceActions serialNo={device.serialNo} online={connected} />
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  This device is registered as{' '}
                  <span className="font-medium text-foreground">{device.protocol ?? device.vendor}</span>,
                  which is a push-only path: it reports scans but accepts no commands.
                </p>
                <p>
                  Remote management needs the device connected on the cloud channel (TCP 7788). If
                  this model offers a cloud or ADMS server mode, point it there and it will appear
                  here automatically.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Command history</h2>
          {commands.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing has been sent to this device yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Command</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commands.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.command}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{c.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{c.requestedBy ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relative(c.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {c.error ?? c.reason ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
