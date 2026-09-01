import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listRecentDuplicates } from '@/lib/biometric/queries'
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
import { deleteDuplicateEventAction } from '@/lib/attendance/actions'

function when(iso: string) {
  return new Date(iso).toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

export default async function DuplicateScansPage() {
  await requirePermission('admin.devices', 'full')
  const duplicates = await listRecentDuplicates()

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
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Duplicate scans</h1>
        <p className="text-xs text-muted-foreground">
          Same device+person scans close together — a device retry storm or a literal double-tap,
          not two separate visits. None of these became a second punch.{' '}
          <span className="font-medium text-foreground">Exact match</span> means the terminal sent
          the identical scan again and nothing new was even stored.{' '}
          <span className="font-medium text-foreground">Within window</span> means a real scan
          landed a few seconds apart from an earlier one — recorded, but never punched.
        </p>
      </div>

      {duplicates.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No duplicate scans recorded yet.
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="rounded-xl border border-border">
          <TableHeader sticky>
            <TableRow>
              <TableRowNumberHead />
              <TableHead>Person</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead className="text-right">Gap</TableHead>
              <TableHead>Scanned at</TableHead>
              <TableHead>Received</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {duplicates.map((dup, index) => (
              <TableRow key={dup.id}>
                <TableRowNumber value={index + 1} />
                <TableCell className="font-medium">
                  {dup.personName ?? <span className="font-mono text-xs">{dup.externalUserId}</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dup.deviceName ?? <span className="font-mono text-xs">{dup.deviceSerial}</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={dup.matchKind === 'window' ? 'warning' : 'secondary'}>
                    {dup.matchKind === 'window' ? 'Within window' : 'Exact match'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {dup.matchKind === 'window' ? `${dup.gapSeconds.toFixed(1)}s` : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{when(dup.scannedAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{when(dup.receivedAt)}</TableCell>
                <TableCell>
                  {dup.duplicateEventId ? (
                    <DeleteWithReasonForm
                      action={deleteDuplicateEventAction}
                      idField="id"
                      idValue={dup.duplicateEventId}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
