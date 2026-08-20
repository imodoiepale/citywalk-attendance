'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/toast'
import { celebrate } from '@/lib/celebrate'
import { acknowledgeLeaveDecisionsAction } from '@/lib/leave/actions'
import type { DecisionToAnnounce } from '@/lib/leave/queries'

function formatRange(startDate: string, endDate: string) {
  const fmt = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-KE', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
  return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`
}

/**
 * Announces leave decisions the requester has not seen, once.
 *
 * Renders nothing. Acknowledgement is only sent *after* the toasts are queued,
 * so a decision cannot be marked seen by a render that never made it to the
 * screen. The ref guards against React running the effect twice in Strict Mode
 * and firing the confetti twice for one approval.
 */
export default function LeaveDecisionAnnouncer({
  decisions,
}: {
  decisions: DecisionToAnnounce[]
}) {
  const { push } = useToast()
  const announced = useRef(false)

  useEffect(() => {
    if (announced.current || decisions.length === 0) return
    announced.current = true

    const approved = decisions.filter((d) => d.status === 'approved')

    for (const decision of decisions) {
      const isApproved = decision.status === 'approved'
      push({
        variant: isApproved ? 'success' : 'error',
        title: isApproved
          ? `Your ${decision.type} leave was approved`
          : `Your ${decision.type} leave was declined`,
        description: [
          formatRange(decision.startDate, decision.endDate),
          decision.decidedByName ? `by ${decision.decidedByName}` : null,
          decision.decisionNote ? `“${decision.decisionNote}”` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        duration: isApproved ? 9000 : 0,
      })
    }

    if (approved.length > 0) void celebrate()

    // Fire-and-forget: if this fails the decision simply gets announced again
    // next load, which is the safe direction to fail in.
    void acknowledgeLeaveDecisionsAction().catch(() => {})
  }, [decisions, push])

  return null
}
