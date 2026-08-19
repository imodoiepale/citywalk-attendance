'use client'

import { useSyncExternalStore } from 'react'

// Pure client display-tick logic, split out of the old localStorage-backed
// useClockState hook — this half never owned persistence, so it survives
// the move to server-backed punches unchanged in spirit, just taking the
// active punch's clock-in time as a prop instead of reading its own store.

function subscribeTick(callback: () => void) {
  const id = setInterval(callback, 1000)
  return () => clearInterval(id)
}

function getTickSnapshot() {
  return Math.floor(Date.now() / 1000)
}

function getTickServerSnapshot() {
  return 0
}

export function useShiftClock(activeClockInAt: string | null): number {
  const nowSeconds = useSyncExternalStore(subscribeTick, getTickSnapshot, getTickServerSnapshot)
  if (!activeClockInAt || nowSeconds === 0) return 0
  const clockInSeconds = Math.floor(new Date(activeClockInAt).getTime() / 1000)
  return Math.max(0, nowSeconds - clockInSeconds)
}
