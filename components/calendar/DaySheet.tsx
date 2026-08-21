'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sheet, SHEET_DURATION_MS } from '@/components/ui/sheet'
import { formatDayLabel } from '@/lib/timezone'

/**
 * The client shell the intercepted day route renders into.
 *
 * Holds no data of its own — `children` is the server-rendered `DayDetail`,
 * which is the only reason the sheet can show punches and correction forms at
 * all (those queries are server-only).
 *
 * Closing goes through `router.back()` rather than a local flag so the sheet
 * and the URL cannot disagree: the panel exists because the route matched, and
 * it should stop existing when that stops being true. `open` is held in state
 * purely so the exit animation has something to run against before the
 * navigation tears the route down.
 */
export default function DaySheet({ date, children }: { date: string; children: React.ReactNode }) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  const close = useCallback(() => {
    setOpen(false)
    // Matches the sheet's own transition, so the panel is off-screen before
    // the route unmounts underneath it.
    window.setTimeout(() => router.back(), SHEET_DURATION_MS)
  }, [router])

  return (
    <Sheet open={open} onClose={close} title={formatDayLabel(date)}>
      {children}
    </Sheet>
  )
}
