'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { decideLeaveRequestAction } from '@/lib/leave/actions'

export default function DecisionButtons({ requestId }: { requestId: string }) {
  const [showNote, setShowNote] = useState(false)

  return (
    <form action={decideLeaveRequestAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="id" value={requestId} />
      {showNote && <Input name="note" placeholder="Note (optional)" className="w-40" />}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowNote((v) => !v)}>
          Note
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="outline" size="sm">
          Reject
        </Button>
        <Button type="submit" name="decision" value="approved" size="sm">
          Approve
        </Button>
      </div>
    </form>
  )
}
