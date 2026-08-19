'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { decideCorrectionAction } from '@/lib/corrections/actions'

function DecideButton({
  decision,
  variant,
}: {
  decision: 'approved' | 'rejected'
  variant: 'default' | 'destructive'
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={variant}
      disabled={pending}
    >
      {decision === 'approved' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {decision === 'approved' ? 'Approve' : 'Reject'}
    </Button>
  )
}

/**
 * Approving is the only path that rewrites a punch, so the note field sits
 * inline with the buttons — an approver should be able to say why without a
 * second screen.
 */
export default function CorrectionDecisionButtons({ id }: { id: string }) {
  const [note, setNote] = useState('')

  return (
    <form action={decideCorrectionAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note (optional)"
        className="h-8 min-w-0 flex-1 text-xs sm:max-w-xs"
      />
      <DecideButton decision="approved" variant="default" />
      <DecideButton decision="rejected" variant="destructive" />
    </form>
  )
}
