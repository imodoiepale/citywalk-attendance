'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { PencilLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { requestCorrectionAction } from '@/lib/corrections/actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </Button>
  )
}

/**
 * Files a correction against one punch, or proposes a punch that was never
 * recorded at all (punchId = null). Times are entered in Nairobi local time;
 * the Server Action converts them.
 */
export default function CorrectionForm({
  dateKey,
  punchId,
  userId,
  defaultClockIn,
  defaultClockOut,
  label,
}: {
  dateKey: string
  punchId: string | null
  userId: string
  defaultClockIn?: string
  defaultClockOut?: string
  label: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setIsOpen(true)}>
        <PencilLine className="h-3.5 w-3.5" />
        {label}
      </Button>
    )
  }

  return (
    <form
      action={async (formData) => {
        await requestCorrectionAction(formData)
        setIsOpen(false)
      }}
      className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3"
    >
      <input type="hidden" name="dateKey" value={dateKey} />
      <input type="hidden" name="userId" value={userId} />
      {punchId ? <input type="hidden" name="punchId" value={punchId} /> : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`in-${punchId ?? 'new'}`} className="text-xs">
            Clock in
          </Label>
          <Input
            id={`in-${punchId ?? 'new'}`}
            name="clockIn"
            type="time"
            required
            defaultValue={defaultClockIn}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`out-${punchId ?? 'new'}`} className="text-xs">
            Clock out
          </Label>
          <Input
            id={`out-${punchId ?? 'new'}`}
            name="clockOut"
            type="time"
            defaultValue={defaultClockOut}
            className="h-8 text-xs"
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Leave clock-out empty if the shift is still open. A time earlier than clock-in is treated as
        the next morning.
      </p>

      <div className="space-y-1">
        <Label htmlFor={`why-${punchId ?? 'new'}`} className="text-xs">
          Reason
        </Label>
        <Textarea
          id={`why-${punchId ?? 'new'}`}
          name="reason"
          required
          rows={2}
          placeholder="e.g. Forgot to clock out — left at 5pm."
          className="text-xs"
        />
      </div>

      <div className="flex gap-2">
        <SubmitButton />
        <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
