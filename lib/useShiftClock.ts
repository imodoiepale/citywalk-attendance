'use client'

import { useSyncExternalStore } from 'react'
import type { PunchRecord } from '@/lib/punches/queries'

// Pure client display-tick logic. The store below is the single 1s heartbeat
// for every live-updating surface on the dashboard — the dial's wall clock,
// the day total, and the current-session counter all read from it, so they
// tick in lockstep rather than each owning a drifting setInterval.

function subscribeTick(callback: () => void) {
  const id = setInterval(callback, 1000)
  return () => clearInterval(id)
}

function getTickSnapshot() {
  return Math.floor(Date.now() / 1000)
}

// 0 is the "not hydrated yet" sentinel: the server has no meaningful clock,
// and anything derived from the live time must render identically on both
// sides or hydration mismatches. Consumers check for it explicitly.
function getTickServerSnapshot() {
  return 0
}

/** Unix seconds, ticking once a second. 0 until hydrated. */
export function useNowSeconds(): number {
  return useSyncExternalStore(subscribeTick, getTickSnapshot, getTickServerSnapshot)
}

function toUnixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000)
}

export interface ShiftClock {
  /** Total worked seconds today, across every punch — survives clocking out and back in. */
  todaySeconds: number
  /** Seconds elapsed on the currently open punch only; 0 when clocked out. */
  sessionSeconds: number
  isClockedIn: boolean
  /** Unix seconds for the shared wall clock; 0 until hydrated. */
  nowSeconds: number
}

/**
 * The pure half of the hook, split out so it can be exercised without React.
 * Accumulates the day rather than the current punch: someone who clocks out
 * for lunch and back in again continues from their running total instead of
 * restarting at zero — the punch rows are the record, the dial is the sum.
 *
 * `nowSeconds === 0` means not hydrated; the live portion stays at 0 so the
 * server and client agree on first render.
 */
export function shiftClockFor(punches: PunchRecord[], nowSeconds: number): ShiftClock {
  const openPunch = punches.find((p) => p.clockOutAt === null) ?? null

  // Closed punches are fixed durations — safe to sum on the server too.
  let closedSeconds = 0
  for (const punch of punches) {
    if (!punch.clockOutAt) continue
    closedSeconds += Math.max(0, toUnixSeconds(punch.clockOutAt) - toUnixSeconds(punch.clockInAt))
  }

  const sessionSeconds =
    openPunch && nowSeconds !== 0 ? Math.max(0, nowSeconds - toUnixSeconds(openPunch.clockInAt)) : 0

  return {
    todaySeconds: closedSeconds + sessionSeconds,
    sessionSeconds,
    isClockedIn: openPunch !== null,
    nowSeconds,
  }
}

export function useTodayShiftClock(punches: PunchRecord[]): ShiftClock {
  return shiftClockFor(punches, useNowSeconds())
}
