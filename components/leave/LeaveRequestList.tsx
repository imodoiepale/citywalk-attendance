'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import DecisionButtons from './DecisionButtons'
import { cancelLeaveRequestAction } from '@/lib/leave/actions'
import type { LeaveRequestRecord } from '@/lib/leave/queries'

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'secondary',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface LeaveRequestListProps {
  requests: LeaveRequestRecord[]
  currentUserId: string
  showCancel?: boolean
  /**
   * Render approve/reject controls on pending rows.
   *
   * A plain boolean, not a render prop: this is a Client Component, and a
   * function prop cannot be serialized across the server/client boundary — it
   * throws "Functions cannot be passed directly to Client Components" and takes
   * the page down. DecisionButtons is a client component too, so it is simply
   * imported here rather than injected.
   */
  showApprovalActions?: boolean
}

export default function LeaveRequestList({
  requests,
  currentUserId,
  showCancel,
  showApprovalActions,
}: LeaveRequestListProps) {
  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Nothing here yet.
      </p>
    )
  }

  return (
    <ul data-tour="leave-list" className="space-y-3">
      {requests.map((req) => {
        const canCancel =
          showCancel &&
          req.status === 'pending' &&
          (req.requesterId === currentUserId || req.filedById === currentUserId)

        return (
          <li key={req.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold capitalize text-foreground">{req.type}</span>
                  <Badge variant={STATUS_VARIANT[req.status] ?? 'secondary'} className="capitalize">
                    {req.status}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatDate(req.startDate)} – {formatDate(req.endDate)}
                </p>
                {req.requesterId !== req.filedById && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    For {req.requesterName}, filed by {req.filedByName}
                  </p>
                )}
                {req.reason && <p className="mt-2 text-sm text-foreground/80">{req.reason}</p>}
                {req.status !== 'pending' && req.decidedByName && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {req.status === 'approved' ? 'Approved' : 'Rejected'} by {req.decidedByName}
                    {req.decisionNote ? ` — "${req.decisionNote}"` : ''}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {canCancel && (
                  <form action={cancelLeaveRequestAction}>
                    <input type="hidden" name="id" value={req.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </form>
                )}
                {showApprovalActions && req.status === 'pending' && (
                  <DecisionButtons requestId={req.id} />
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
