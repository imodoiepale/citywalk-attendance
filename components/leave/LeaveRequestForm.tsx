'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fileLeaveRequestAction, type LeaveFormState } from '@/lib/leave/actions'
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

function SubmitButton({ className }: { className?: string }) {
  // Same split as SignOutSubmit and CorrectionForm: useFormStatus only reads
  // the enclosing <form>, so it has to be a child of it.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className={className} disabled={pending}>
      {pending ? 'Submitting…' : 'Submit request'}
    </Button>
  )
}

export interface LeaveRequestFormProps {
  currentUserId: string
  currentUserName: string
  canFileOnBehalf: boolean
  staffOptions: BranchStaffOption[]
  /** Called once the request is filed — the dialog uses it to close itself. */
  onSuccess?: () => void
  /** Rendered inside the <form> so the submit button can sit in a dialog footer. */
  renderFooter?: (submit: React.ReactNode) => React.ReactNode
  firstFieldRef?: React.RefObject<HTMLSelectElement | null>
}

export default function LeaveRequestForm({
  currentUserId,
  currentUserName,
  canFileOnBehalf,
  staffOptions,
  onSuccess,
  renderFooter,
  firstFieldRef,
}: LeaveRequestFormProps) {
  const [state, formAction] = useActionState<LeaveFormState, FormData>(fileLeaveRequestAction, {})
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!state.ok) return
    formRef.current?.reset()
    onSuccess?.()
  }, [state, onSuccess])

  const errorMessage = state.error ? (ERROR_MESSAGES[state.error] ?? state.error) : null

  const fields = (
    <div className="space-y-4">
      {errorMessage && (
        <p
          role="alert"
          className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {errorMessage}
        </p>
      )}

      {canFileOnBehalf && (
        <div className="space-y-1.5">
          <Label htmlFor="requester_id">Requesting for</Label>
          <Select
            id="requester_id"
            name="requester_id"
            defaultValue={currentUserId}
            ref={firstFieldRef}
          >
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
        <Select
          id="type"
          name="type"
          required
          defaultValue=""
          ref={canFileOnBehalf ? undefined : firstFieldRef}
        >
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
    </div>
  )

  // In a dialog the submit button belongs in the pinned footer, but it must
  // still be inside this <form> for useFormStatus and native submission to
  // work — hence a render prop rather than lifting the button out.
  if (renderFooter) {
    return (
      <form ref={formRef} action={formAction} className="flex min-h-0 flex-1 flex-col">
        {fields}
        {renderFooter(<SubmitButton />)}
      </form>
    )
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-card"
    >
      {fields}
      <SubmitButton className="w-full" />
    </form>
  )
}
