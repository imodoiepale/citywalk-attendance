import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { getDailyHoursForMonth, getWeeklyHours } from '@/lib/punches/queries'
import { getApprovedLeaveDayKeys } from '@/lib/leave/queries'
import { nairobiMonthRangeUtc } from '@/lib/timezone'
import { toNairobiDateKey } from '@/lib/timezone'
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
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-bold text-foreground">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Your worked hours, day by day. Tap a day for detail.
          </p>
        </div>

        <WeeklyProgressRing hoursThisWeek={weeklyHours} targetHours={settings.weeklyTargetHours} />

        <div className="rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <Link
              href={`/calendar?year=${prev.year}&month=${prev.month}`}
              className="rounded-full border border-border p-1.5 text-muted-foreground hover:bg-accent"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <div className="flex flex-col items-center">
              <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
              <span className="text-xs text-primary-strong">{monthTotal.toFixed(1)}h total</span>
            </div>
            {isCurrentMonth ? (
              <span className="rounded-full border border-transparent p-1.5 text-muted-foreground/30">
                <ChevronRight className="h-4 w-4" />
              </span>
            ) : (
              <Link
                href={`/calendar?year=${next.year}&month=${next.month}`}
                className="rounded-full border border-border p-1.5 text-muted-foreground hover:bg-accent"
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

          <div className="mt-4">
            <Legend dailyTargetHours={settings.dailyTargetHours} />
          </div>
        </div>
      </div>
    </div>
  )
}
