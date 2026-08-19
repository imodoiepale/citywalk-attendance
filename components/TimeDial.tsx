'use client'

import { Clock as ClockIcon } from 'lucide-react'
import { APPROACHING_THRESHOLD_SECONDS, DAILY_TARGET_SECONDS } from '@/lib/targets'
import './clock-dial.css'

const PLACEHOLDER_CLOCK = '--:--:--'

function formatClock(nowSeconds: number) {
  // 0 means "not hydrated yet" (see useShiftClock's server snapshot) — render
  // a placeholder rather than a server-side time that won't match the client's.
  if (nowSeconds === 0) return PLACEHOLDER_CLOCK
  return new Date(nowSeconds * 1000).toLocaleTimeString('en-KE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

interface TimeDialProps {
  isClockedIn: boolean
  /** Worked seconds across every punch today — what the ring and the caption track. */
  todaySeconds: number
  /** Seconds on the currently open punch only. */
  sessionSeconds: number
  nowSeconds: number
}

export default function TimeDial({
  isClockedIn,
  todaySeconds,
  sessionSeconds,
  nowSeconds,
}: TimeDialProps) {
  const radius = 148
  const circumference = 2 * Math.PI * radius
  // The ring fills toward a full day, not a single punch, so it keeps its
  // position across a lunch break instead of snapping back to empty.
  const progress = Math.min(todaySeconds / DAILY_TARGET_SECONDS, 1)
  const offset = circumference * (1 - progress)

  const state = !isClockedIn
    ? 'idle'
    : todaySeconds >= DAILY_TARGET_SECONDS
      ? 'overtime'
      : todaySeconds >= APPROACHING_THRESHOLD_SECONDS
        ? 'approaching'
        : 'normal'

  return (
    <div className="time-dial-scope" data-state={state}>
      <div className={`time-dial ${isClockedIn ? 'is-active' : ''}`} aria-label="Shift time dial">
        <div className="time-dial__ambient" aria-hidden="true" />

        <svg className="time-dial__ring" viewBox="0 0 320 320" aria-hidden="true">
          <defs>
            <linearGradient id="dial-ring-gradient" x1="0" y1="0.5" x2="1" y2="0.5">
              <stop offset="0" stopColor="var(--dial-accent-start)" />
              <stop offset="0.5" stopColor="#E3D5FF" stopOpacity="0.5" />
              <stop offset="1" stopColor="var(--dial-accent-end)" />
            </linearGradient>
            <filter id="dial-ring-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4.5" />
            </filter>
            <filter id="dial-ring-aura" x="-70%" y="-70%" width="240%" height="240%">
              <feGaussianBlur stdDeviation="11" />
            </filter>
          </defs>

          <circle className="time-dial__track" cx="160" cy="160" r={radius} />

          <circle
            className="time-dial__progress-aura"
            cx="160"
            cy="160"
            r={radius}
            pathLength={circumference}
            stroke="url(#dial-ring-gradient)"
            filter="url(#dial-ring-aura)"
            style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
          />
          <circle
            className="time-dial__progress-glow"
            cx="160"
            cy="160"
            r={radius}
            pathLength={circumference}
            stroke="url(#dial-ring-gradient)"
            filter="url(#dial-ring-glow)"
            style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
          />
          <circle
            className="time-dial__progress"
            cx="160"
            cy="160"
            r={radius}
            pathLength={circumference}
            stroke="url(#dial-ring-gradient)"
            style={{ strokeDasharray: circumference, strokeDashoffset: offset }}
          />
        </svg>

        <div className="time-dial__sunburst-wrap" aria-hidden="true">
          <div className="time-dial__sunburst" />
        </div>
        <div className="time-dial__overlay" aria-hidden="true" />
        <div className="time-dial__glass" aria-hidden="true" />

        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="time-dial__tick"
            style={{
              transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateY(calc(-0.47 * var(--dial-size)))`,
            }}
          />
        ))}

        <div className="time-dial__content">
          <span className="time-dial__time">{formatClock(nowSeconds)}</span>
          <span className="time-dial__caption">
            <ClockIcon size={14} strokeWidth={1.8} aria-hidden="true" />
            {isClockedIn || todaySeconds > 0
              ? `Today: ${formatElapsed(todaySeconds)}`
              : 'Not clocked in'}
          </span>
          {isClockedIn && (
            <span className="time-dial__subcaption">
              This session: {formatElapsed(sessionSeconds)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
