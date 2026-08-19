'use client'

import { LogIn, LogOut, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { PunchRecord } from '@/lib/punches/queries'

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function formatDuration(startIso: string, endIso: string | null) {
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const totalMinutes = Math.max(0, Math.round((end - new Date(startIso).getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

interface ClockInOutCardProps {
  isClockedIn: boolean
  activePunch: PunchRecord | null
  todaysPunches: PunchRecord[]
  onClockIn: () => void
  onClockOut: () => void
  isPending?: boolean
}

export default function ClockInOutCard({
  isClockedIn,
  activePunch,
  todaysPunches,
  onClockIn,
  onClockOut,
  isPending,
}: ClockInOutCardProps) {
  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          variant={isClockedIn ? 'destructive' : 'default'}
          className="h-14 w-full rounded-full text-base font-semibold shadow-card"
          onClick={isClockedIn ? onClockOut : onClockIn}
          disabled={isPending}
        >
          {isClockedIn ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
          {isClockedIn ? 'Clock Out' : 'Clock In'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {isClockedIn && activePunch
            ? `Clocked in since ${formatTime(activePunch.clockInAt)}`
            : 'Tap Clock In to start today’s shift'}
        </p>
      </div>

      <Card>
        <CardContent className="p-4 md:p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Timer className="h-4 w-4 text-primary-strong" />
            Today&rsquo;s punch log
          </div>
          {todaysPunches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No punches recorded yet today.</p>
          ) : (
            <ul className="space-y-2">
              {todaysPunches.map((punch) => (
                <li
                  key={punch.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {formatTime(punch.clockInAt)}
                    {' → '}
                    {punch.clockOutAt ? formatTime(punch.clockOutAt) : 'now'}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {formatDuration(punch.clockInAt, punch.clockOutAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
