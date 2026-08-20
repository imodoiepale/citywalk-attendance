'use client'

import { useCallback, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import LeaveRequestForm from './LeaveRequestForm'
import type { BranchStaffOption } from '@/lib/leave/queries'

/**
 * Files leave without leaving the page. The action's revalidatePath('/leave')
 * refreshes the list underneath, so on success the dialog just closes and the
 * new row is already there — no navigation, no full re-render.
 */
export default function RequestLeaveDialog({
  currentUserId,
  currentUserName,
  canFileOnBehalf,
  staffOptions,
}: {
  currentUserId: string
  currentUserName: string
  canFileOnBehalf: boolean
  staffOptions: BranchStaffOption[]
}) {
  const [open, setOpen] = useState(false)
  const firstFieldRef = useRef<HTMLSelectElement>(null)

  // Stable identity: LeaveRequestForm calls this from an effect keyed on the
  // action result, so a new function each render would re-fire it.
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <Button size="sm" data-tour="request-leave" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Request leave
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Request leave"
        description={
          canFileOnBehalf
            ? 'For yourself, or on behalf of someone in your branch.'
            : 'Your branch manager or HR will review it.'
        }
        initialFocusRef={firstFieldRef}
      >
        <LeaveRequestForm
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          canFileOnBehalf={canFileOnBehalf}
          staffOptions={staffOptions}
          firstFieldRef={firstFieldRef}
          onSuccess={close}
          renderFooter={(submit) => (
            <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              {submit}
            </div>
          )}
        />
      </Dialog>
    </>
  )
}
