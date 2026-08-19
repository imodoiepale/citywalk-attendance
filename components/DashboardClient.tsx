'use client'

import { useOptimistic, useTransition } from 'react'
import TimeDial from './TimeDial'
import ClockInOutCard from './ClockInOutCard'
import CapabilitiesGrid from './CapabilitiesGrid'
import { useShiftClock } from '@/lib/useShiftClock'
import { clockInAction, clockOutAction } from '@/lib/punches/actions'
import type { PunchRecord } from '@/lib/punches/queries'

type OptimisticAction = { type: 'clock-in' } | { type: 'clock-out' }

function applyOptimisticUpdate(state: PunchRecord[], action: OptimisticAction): PunchRecord[] {
  if (action.type === 'clock-in') {
    return [{ id: 'optimistic-in', clockInAt: new Date().toISOString(), clockOutAt: null }, ...state]
  }
  return state.map((p) => (p.clockOutAt === null ? { ...p, clockOutAt: new Date().toISOString() } : p))
}

export default function DashboardClient({ punches }: { punches: PunchRecord[] }) {
  const [isPending, startTransition] = useTransition()
  const [optimisticPunches, applyOptimistic] = useOptimistic(punches, applyOptimisticUpdate)

  const activePunch = optimisticPunches.find((p) => p.clockOutAt === null) ?? null
  const elapsedSeconds = useShiftClock(activePunch?.clockInAt ?? null)

  const handleClockIn = () => {
    startTransition(async () => {
      applyOptimistic({ type: 'clock-in' })
      await clockInAction()
    })
  }

  const handleClockOut = () => {
    startTransition(async () => {
      applyOptimistic({ type: 'clock-out' })
      await clockOutAction()
    })
  }

  return (
    <>
      <TimeDial isClockedIn={activePunch !== null} elapsedSeconds={elapsedSeconds} />
      <ClockInOutCard
        isClockedIn={activePunch !== null}
        activePunch={activePunch}
        todaysPunches={optimisticPunches}
        onClockIn={handleClockIn}
        onClockOut={handleClockOut}
        isPending={isPending}
      />
      <CapabilitiesGrid />
    </>
  )
}
