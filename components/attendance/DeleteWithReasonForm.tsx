'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      <Trash2 className="h-3.5 w-3.5" />
      Delete
    </Button>
  )
}

/**
 * A reason is required — the audit log's `summary` is built from it, and an
 * admin who can't say why they deleted something shouldn't be deleting it.
 */
export default function DeleteWithReasonForm({
  action,
  idField,
  idValue,
}: {
  action: (formData: FormData) => void | Promise<void>
  idField: string
  idValue: string
}) {
  const [reason, setReason] = useState('')

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name={idField} value={idValue} />
      <Input
        name="reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason (required)"
        required
        className="h-8 min-w-0 flex-1 text-xs sm:max-w-[16rem]"
      />
      <DeleteButton />
    </form>
  )
}
