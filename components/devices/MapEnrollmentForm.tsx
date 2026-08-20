'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { mapEnrollmentAction, type MapEnrollmentState } from '@/lib/biometric/actions'

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : label}
    </Button>
  )
}

/**
 * Assigns a device enrollment number to a person.
 *
 * Used both standalone (on the enrollments screen) and inline per row on the
 * unmatched queue, where the number is already known and fixed.
 */
export default function MapEnrollmentForm({
  staff,
  fixedDeviceUserId,
  label = 'Map',
  compact = false,
}: {
  staff: { id: string; fullName: string; branchName: string | null }[]
  fixedDeviceUserId?: string
  label?: string
  compact?: boolean
}) {
  const [state, formAction] = useActionState<MapEnrollmentState, FormData>(mapEnrollmentAction, {})

  return (
    <form action={formAction} className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
      {fixedDeviceUserId ? (
        <input type="hidden" name="device_user_id" value={fixedDeviceUserId} />
      ) : (
        <Input
          name="device_user_id"
          required
          placeholder="Enrollment number"
          className={compact ? 'h-8 w-40 text-xs' : ''}
        />
      )}

      <Select
        name="profile_id"
        required
        defaultValue=""
        className={compact ? 'h-8 min-w-52 text-xs' : ''}
      >
        <option value="" disabled>
          Select staff…
        </option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.fullName}
            {s.branchName ? ` — ${s.branchName}` : ''}
          </option>
        ))}
      </Select>

      <Submit label={label} />

      {state.error ? (
        <span role="alert" className="text-xs text-destructive">
          {state.error}
        </span>
      ) : null}
      {state.ok ? (
        <span className="text-xs text-success">
          {/* The replay count is the reassuring part: scans taken before this
              person was mapped are not lost, they become punches now. */}
          Mapped{state.replayed ? ` — ${state.replayed} earlier scan${state.replayed === 1 ? '' : 's'} applied` : ''}
        </span>
      ) : null}
    </form>
  )
}
