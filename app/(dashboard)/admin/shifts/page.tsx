import { requirePermission } from '@/lib/auth'
import { listShiftTemplates } from '@/lib/admin/queries'
import { listBranches } from '@/lib/admin/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import ShiftTemplateForm from '@/components/admin/ShiftTemplateForm'
import { ROLE_META, type Role } from '@/lib/rbac-catalog'

export default async function AdminShiftsPage() {
  await requirePermission('admin.shifts', 'full')
  const [templates, branches] = await Promise.all([listShiftTemplates(), listBranches()])
  const branchOptions = branches.map((b) => ({ id: b.id, name: b.name }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Shift windows</h1>
          <p className="text-xs text-muted-foreground">
            Expected clock-in/out times, per branch and/or role. Punches are never blocked by
            these — only labelled late/early/out-of-window, with overtime tracked past the
            clock-out window and grace.
          </p>
        </div>
        <ShiftTemplateForm branches={branchOptions} />
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No shifts configured yet. Until one exists for a person&rsquo;s branch/role, their punches
            carry no late/early/overtime labels at all.
          </CardContent>
        </Card>
      ) : (
        <Table containerClassName="rounded-xl border border-border">
          <TableHeader sticky>
            <TableRow>
              <TableRowNumberHead />
              <TableHead>Name</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Clock in</TableHead>
              <TableHead>Clock out</TableHead>
              <TableHead className="text-right">Grace</TableHead>
              <TableHead>Active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((t, index) => (
              <TableRow key={t.id}>
                <TableRowNumber value={index + 1} />
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {t.branchName ?? 'Any branch'}
                  {t.role ? ` · ${ROLE_META[t.role as Role].label}` : ' · Any role'}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {t.clockInWindowStart}–{t.clockInWindowEnd}
                </TableCell>
                <TableCell className="tabular-nums text-muted-foreground">
                  {t.clockOutWindowStart}–{t.clockOutWindowEnd}
                </TableCell>
                <TableCell className="text-right tabular-nums">{t.graceMinutes}m</TableCell>
                <TableCell>
                  <Badge variant={t.isActive ? 'success' : 'secondary'}>
                    {t.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <ShiftTemplateForm
                    template={t}
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
