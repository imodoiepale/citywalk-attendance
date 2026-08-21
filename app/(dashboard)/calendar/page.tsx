import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { getDailyHoursForMonth, getWeeklyHours } from '@/lib/punches/queries'
import { getApprovedLeaveDayKeys } from '@/lib/leave/queries'
import { nairobiMonthRangeUtc, toNairobiDateKey } from '@/lib/timezone'
import { getSettings } from '@/lib/settings'
import MonthCalendar from '@/components/calendar/MonthCalendar'
import WeeklyProgressRing from '@/components/calendar/WeeklyProgressRing'
import Legend from '@/components/calendar/Legend'

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>
}) {
  const user = await requireUser()
  const params = await searchParams

  const now = new Date()
  const year = params.year ? parseInt(params.year, 10) : now.getUTCFullYear()
  const month = params.month ? parseInt(params.month, 10) : now.getUTCMonth() + 1

  const monthRange = nairobiMonthRangeUtc(year, month)
  const [settings, hoursByDay, weeklyHours, leaveDayKeys] = await Promise.all([
    getSettings(),
    getDailyHoursForMonth(user.id, year, month),
    getWeeklyHours(user.id),
    getApprovedLeaveDayKeys(user.id, monthRange.start.toISOString(), monthRange.end.toISOString()),
  ])

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-KE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1
  const monthTotal = Array.from(hoursByDay.values()).reduce((sum, h) => sum + h, 0)

  return (
    // Height-constrained only from `lg` up. The 3.5rem+1px is AppShell's h-14
    // header plus its border — without subtracting it, a plain `h-screen` here
    // sits 57px below the top of the viewport and overflows the body by
    // exactly that much even with no content. On phones the page scrolls
    // normally, which also avoids the 100vh/URL-bar problem.
    <div className="flex w-full flex-col gap-2 px-4 py-3 sm:px-6 lg:h-[calc(100vh-3.5rem-1px)] lg:overflow-hidden lg:px-8">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Calendar</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Your worked hours, day by day.
          </p>
        </div>
        <WeeklyProgressRing
          hoursThisWeek={weeklyHours}
          targetHours={settings.weeklyTargetHours}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
          <Link
            href={`/calendar?year=${prev.year}&month=${prev.month}`}
            aria-label="Previous month"
            className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div className="flex flex-col items-center">
            <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
            <span className="text-xs tabular-nums text-primary-strong">
              {monthTotal.toFixed(1)}h total
            </span>
          </div>
          {isCurrentMonth ? (
            <span className="rounded-full border border-transparent p-1.5 text-muted-foreground/30">
              <ChevronRight className="h-4 w-4" />
            </span>
          ) : (
            <Link
              href={`/calendar?year=${next.year}&month=${next.month}`}
              aria-label="Next month"
              className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        <MonthCalendar
          year={year}
          month={month}
          hoursByDay={hoursByDay}
          todayKey={toNairobiDateKey(new Date().toISOString())}
          dailyTargetHours={settings.dailyTargetHours}
          leaveDayKeys={leaveDayKeys}
        />

        <div className="mt-2 shrink-0">
          <Legend />
        </div>
      </div>
    </div>
  )
}
