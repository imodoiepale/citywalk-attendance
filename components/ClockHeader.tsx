'use client'

import { CalendarDays } from 'lucide-react'

const PLACEHOLDER = '--:--:--'

function formatDate(nowSeconds: number) {
  if (nowSeconds === 0) return '\u00a0'
  return new Date(nowSeconds * 1000).toLocaleDateString('en-KE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Nairobi',
  })
}

function formatWallClock(nowSeconds: number) {
  if (nowSeconds === 0) return PLACEHOLDER
  return new Date(nowSeconds * 1000).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Africa/Nairobi',
  })
}

/**
 * Date and wall clock above the dial.
 *
 * Both read `nowSeconds` from the single shared tick in useShiftClock rather
 * than starting an interval of their own, so this stays in lockstep with the
 * dial's counter instead of drifting a second apart from it.
 *
 * Times are pinned to Africa/Nairobi rather than the device locale: a branch
 * tablet with a wrong timezone should not show a different clock from the one
 * the punches are actually recorded against.
 */
export default function ClockHeader({ nowSeconds }: { nowSeconds: number }) {
  return (
    <div data-tour="clock-header" className="flex flex-col items-center gap-0.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        {formatDate(nowSeconds)}
      </span>
      <span
        className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl"
        suppressHydrationWarning
      >
        {formatWallClock(nowSeconds)}
      </span>
    </div>
  )
}
