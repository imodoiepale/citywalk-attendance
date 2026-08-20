'use client'

import { useOptimistic, useTransition } from 'react'
import TimeDial from './TimeDial'
import ClockHeader from './ClockHeader'
import ClockInOutCard from './ClockInOutCard'
import TodaySummary, { type DashboardSummary } from './TodaySummary'
import { useTodayShiftClock } from '@/lib/useShiftClock'
import { clockInAction, clockOutAction } from '@/lib/punches/actions'
import type { PunchRecord } from '@/lib/punches/queries'

type OptimisticAction = { type: 'clock-in' } | { type: 'clock-out' }

function applyOptimisticUpdate(state: PunchRecord[], action: OptimisticAction): PunchRecord[] {
  if (action.type === 'clock-in') {
    return [{ id: 'optimistic-in', clockInAt: new Date().toISOString(), clockOutAt: null }, ...state]
  }
  return state.map((p) => (p.clockOutAt === null ? { ...p, clockOutAt: new Date().toISOString() } : p))
}

export default function DashboardClient({
  punches,
  summary,
  targetSeconds,
  approachingSeconds,
}: {
  punches: PunchRecord[]
  summary: DashboardSummary
  targetSeconds: number
  approachingSeconds: number
}) {
  const [isPending, startTransition] = useTransition()
  const [optimisticPunches, applyOptimistic] = useOptimistic(punches, applyOptimisticUpdate)

  const activePunch = optimisticPunches.find((p) => p.clockOutAt === null) ?? null
  const { todaySeconds, sessionSeconds, isClockedIn, nowSeconds } =
    useTodayShiftClock(optimisticPunches)

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
      <ClockHeader nowSeconds={nowSeconds} />
      <TimeDial
        isClockedIn={isClockedIn}
        todaySeconds={todaySeconds}
        sessionSeconds={sessionSeconds}
        nowSeconds={nowSeconds}
        targetSeconds={targetSeconds}
        approachingSeconds={approachingSeconds}
      />
      <ClockInOutCard
        isClockedIn={isClockedIn}
        activePunch={activePunch}
        todaysPunches={optimisticPunches}
        onClockIn={handleClockIn}
        onClockOut={handleClockOut}
        isPending={isPending}
      />
      <TodaySummary
        todaySeconds={todaySeconds}
        sessionCount={optimisticPunches.length}
        summary={summary}
      />
    </>
  )
}
