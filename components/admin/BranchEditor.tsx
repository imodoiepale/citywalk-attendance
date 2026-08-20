'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { upsertBranchAction } from '@/lib/admin/actions'
import type { BranchRow } from '@/lib/admin/queries'

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save branch'}
    </Button>
  )
}

function BranchForm({ branch, onDone }: { branch: BranchRow | null; onDone: () => void }) {
  return (
    <form
      action={async (formData) => {
        await upsertBranchAction(formData)
        onDone()
      }}
      className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3"
    >
      {branch ? <input type="hidden" name="id" value={branch.id} /> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="code" className="text-xs">
            Code
          </Label>
          <Input
            id="code"
            name="code"
            required
            maxLength={8}
            defaultValue={branch?.code}
            placeholder="CWK"
            className="h-8 text-xs uppercase"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="name" className="text-xs">
            Name
          </Label>
          <Input
            id="name"
            name="name"
            required
            defaultValue={branch?.name}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="brand" className="text-xs">
            Brand
          </Label>
          <Input id="brand" name="brand" defaultValue={branch?.brand} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="town" className="text-xs">
            Town
          </Label>
          <Input
            id="town"
            name="town"
            defaultValue={branch?.town ?? ''}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="latitude" className="text-xs">
            Latitude
          </Label>
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="0.000001"
            defaultValue={branch?.latitude ?? ''}
            placeholder="-1.286389"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="longitude" className="text-xs">
            Longitude
          </Label>
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="0.000001"
            defaultValue={branch?.longitude ?? ''}
            placeholder="36.817223"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="geofenceRadiusM" className="text-xs">
            Geofence radius (m)
          </Label>
          <Input
            id="geofenceRadiusM"
            name="geofenceRadiusM"
            type="number"
            min="0"
            defaultValue={branch?.geofenceRadiusM ?? ''}
            placeholder="150"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end gap-2">
          <input
            id="isActive"
            name="isActive"
            type="checkbox"
            defaultChecked={branch?.isActive ?? true}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="isActive" className="text-xs">
            Active
          </Label>
        </div>
      </div>

      <div className="flex gap-2">
        <SaveButton />
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export default function BranchEditor({ branches }: { branches: BranchRow[] }) {
  // `null` = closed, `'new'` = creating, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {editing === 'new' ? (
        <BranchForm branch={null} onDone={() => setEditing(null)} />
      ) : (
        <Button type="button" size="sm" onClick={() => setEditing('new')}>
          <Plus className="h-3.5 w-3.5" />
          Add branch
        </Button>
      )}

      <Card>
        <CardContent className="p-0">
          <Table containerClassName="rounded-xl">
            <TableHeader sticky>
              <TableRow>
                <TableRowNumberHead />
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Town</TableHead>
                <TableHead className="text-right">Staff</TableHead>
                <TableHead>Geofence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((branch, index) => (
                <TableRow key={branch.id}>
                  <TableRowNumber value={index + 1} />
                  <TableCell className="font-mono text-xs">{branch.code}</TableCell>
                  <TableCell className="font-medium">{branch.name}</TableCell>
                  <TableCell className="text-muted-foreground">{branch.town ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{branch.staffCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {branch.latitude !== null && branch.longitude !== null
                      ? `${branch.geofenceRadiusM ?? '—'}m`
                      : 'Not set'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={branch.isActive ? 'success' : 'secondary'}>
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(editing === branch.id ? null : branch.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing && editing !== 'new' ? (
        <BranchForm
          branch={branches.find((b) => b.id === editing) ?? null}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </div>
  )
}
