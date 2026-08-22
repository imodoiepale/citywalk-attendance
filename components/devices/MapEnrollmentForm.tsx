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
  fixedVendor,
  label = 'Map',
  compact = false,
}: {
  staff: { id: string; fullName: string; branchName: string | null }[]
  fixedDeviceUserId?: string
  fixedVendor?: string
  label?: string
  compact?: boolean
}) {
  const [state, formAction] = useActionState<MapEnrollmentState, FormData>(mapEnrollmentAction, {})

  return (
    <form action={formAction} className={compact ? 'flex flex-wrap items-center gap-2' : 'space-y-3'}>
      {fixedVendor ? (
        <input type="hidden" name="vendor" value={fixedVendor} />
      ) : (
        <Select name="vendor" required defaultValue="zkteco" className={compact ? 'h-8 w-32 text-xs' : ''}>
          <option value="zkteco">ZKTeco</option>
          <option value="ebkn">EBKN / EN-K190</option>
          <option value="cams">Cams</option>
          <option value="face">Face camera</option>
          <option value="generic">Generic</option>
        </Select>
      )}
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
