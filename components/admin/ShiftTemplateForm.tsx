'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { saveShiftTemplateAction, type ShiftTemplateFormState } from '@/lib/admin/actions'
import type { ShiftTemplateRow } from '@/lib/admin/queries'
import { ROLES, ROLE_META, type Role } from '@/lib/rbac-catalog'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save shift'}
    </Button>
  )
}

function ShiftForm({
  template,
  branches,
  onSuccess,
  onCancel,
  firstFieldRef,
}: {
  template?: ShiftTemplateRow
  branches: { id: string; name: string }[]
  onSuccess: () => void
  onCancel: () => void
  firstFieldRef: React.RefObject<HTMLInputElement | null>
}) {
  const [state, formAction] = useActionState<ShiftTemplateFormState, FormData>(
    saveShiftTemplateAction,
    {}
  )

  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state, onSuccess])

  return (
    <form action={formAction} className="space-y-4">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          required
          ref={firstFieldRef}
          defaultValue={template?.name}
          placeholder="HQ — day shift"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="branchId">Branch</Label>
          <Select id="branchId" name="branchId" defaultValue={template?.branchId ?? ''}>
            <option value="">Any branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue={template?.role ?? ''}>
            <option value="">Any role</option>
            {ROLES.map((role: Role) => (
              <option key={role} value={role}>
                {ROLE_META[role].label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        At least one of branch or role is required. Both set is the most specific match; leaving
        both as &quot;Any&quot; creates an explicit org-wide fallback.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="clockInStart">Clock-in window start</Label>
          <Input
            id="clockInStart"
            name="clockInStart"
            type="time"
            required
            defaultValue={template?.clockInWindowStart ?? '08:00'}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clockInEnd">Clock-in window end</Label>
          <Input
            id="clockInEnd"
            name="clockInEnd"
            type="time"
            required
            defaultValue={template?.clockInWindowEnd ?? '09:00'}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clockOutStart">Clock-out window start</Label>
          <Input
            id="clockOutStart"
            name="clockOutStart"
            type="time"
            required
            defaultValue={template?.clockOutWindowStart ?? '17:00'}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clockOutEnd">Clock-out window end</Label>
          <Input
            id="clockOutEnd"
            name="clockOutEnd"
            type="time"
            required
            defaultValue={template?.clockOutWindowEnd ?? '18:00'}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="graceMinutes">Grace period (minutes)</Label>
        <Input
          id="graceMinutes"
          name="graceMinutes"
          type="number"
          min="0"
          defaultValue={template?.graceMinutes ?? 10}
          className="max-w-[8rem]"
        />
        <p className="text-[11px] text-muted-foreground">
          Allowance either side of a window before a punch is labelled late/early. Punches are
          never blocked, regardless of this setting — only labelled, with overtime tracked past
          the clock-out window plus this grace.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={template?.isActive ?? true}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="isActive" className="text-sm">
          Active
        </Label>
      </div>

      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton />
      </div>
    </form>
  )
}

export default function ShiftTemplateForm({
  template,
  branches,
  trigger,
}: {
  template?: ShiftTemplateRow
  branches: { id: string; name: string }[]
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          Add shift
        </Button>
      )}

      <Dialog
        open={open}
        onClose={close}
        title={template ? `Edit ${template.name}` : 'Add a shift'}
        description="Never blocks a punch — only labels it late/early/out-of-window and tracks overtime past the clock-out window."
        initialFocusRef={firstFieldRef}
      >
        {open ? (
          <ShiftForm
            key={template?.id ?? 'new'}
            template={template}
            branches={branches}
            firstFieldRef={firstFieldRef}
            onSuccess={close}
            onCancel={close}
          />
        ) : null}
      </Dialog>
    </>
  )
}
