'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fileLeaveRequestAction } from '@/lib/leave/actions'
import type { BranchStaffOption } from '@/lib/leave/queries'

const LEAVE_TYPES: { value: string; label: string }[] = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'compassionate', label: 'Compassionate' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'other', label: 'Other' },
]

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Fill in every required field.',
  forbidden: "You don't have permission to file leave for someone else.",
}

interface LeaveRequestFormProps {
  currentUserId: string
  currentUserName: string
  canFileOnBehalf: boolean
  staffOptions: BranchStaffOption[]
  error?: string
}

export default function LeaveRequestForm({
  currentUserId,
  currentUserName,
  canFileOnBehalf,
  staffOptions,
  error,
}: LeaveRequestFormProps) {
  return (
    <form
      action={fileLeaveRequestAction}
      className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card"
    >
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {ERROR_MESSAGES[error] ?? error}
        </p>
      )}

      {canFileOnBehalf && (
        <div className="space-y-1.5">
          <Label htmlFor="requester_id">Requesting for</Label>
          <Select id="requester_id" name="requester_id" defaultValue={currentUserId}>
            <option value={currentUserId}>{currentUserName} (me)</option>
            {staffOptions
              .filter((s) => s.id !== currentUserId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="type">Type</Label>
        <Select id="type" name="type" required defaultValue="">
          <option value="" disabled>
            Select a type
          </option>
          {LEAVE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="start_date">Start date</Label>
          <Input id="start_date" name="start_date" type="date" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="end_date">End date</Label>
          <Input id="end_date" name="end_date" type="date" required />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason (optional)</Label>
        <Textarea id="reason" name="reason" rows={3} />
      </div>

      <Button type="submit" className="w-full">
        Submit request
      </Button>
    </form>
  )
}
