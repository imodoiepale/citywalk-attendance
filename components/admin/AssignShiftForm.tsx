'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { assignShiftAction } from '@/lib/admin/actions'
import type { ShiftTemplateRow } from '@/lib/admin/queries'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Assigning…' : 'Assign'}
    </Button>
  )
}

export default function AssignShiftForm({
  profileId,
  templates,
  currentTemplateId,
}: {
  profileId: string
  templates: ShiftTemplateRow[]
  currentTemplateId?: string
}) {
  return (
    <form action={assignShiftAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="profileId" value={profileId} />
      <Select
        name="shiftTemplateId"
        required
        defaultValue={currentTemplateId ?? ''}
        className="h-8 max-w-xs text-xs"
      >
        <option value="" disabled>
          Select a shift…
        </option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </Select>
      <SubmitButton />
    </form>
  )
}
