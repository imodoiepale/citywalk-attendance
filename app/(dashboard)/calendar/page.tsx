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
    <div className="h-screen w-full overflow-auto px-3 py-2 sm:px-4 lg:px-6">
      <div className="flex flex-col gap-2 lg:gap-3">
        <div className="flex flex-col items-start justify-between gap-2 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-foreground sm:text-xl">Calendar</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">Hours by day</p>
          </div>
          <div className="hidden lg:block">
            <WeeklyProgressRing hoursThisWeek={weeklyHours} targetHours={settings.weeklyTargetHours} />
          </div>
        </div>

        <div className="lg:hidden">
          <WeeklyProgressRing hoursThisWeek={weeklyHours} targetHours={settings.weeklyTargetHours} />
        </div>

        <div className="rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <Link
              href={`/calendar?year=${prev.year}&month=${prev.month}`}
              className="rounded-full border border-border p-1 text-muted-foreground hover:bg-accent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Link>
            <div className="flex flex-col items-center">
              <span className="text-xs font-semibold text-foreground sm:text-sm">{monthLabel}</span>
              <span className="text-[10px] text-primary-strong sm:text-xs">{monthTotal.toFixed(1)}h</span>
            </div>
            {isCurrentMonth ? (
              <span className="rounded-full border border-transparent p-1 text-muted-foreground/30">
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            ) : (
              <Link
                href={`/calendar?year=${next.year}&month=${next.month}`}
                className="rounded-full border border-border p-1 text-muted-foreground hover:bg-accent"
              >
                <ChevronRight className="h-3.5 w-3.5" />
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

          <div className="mt-2">
            <Legend dailyTargetHours={settings.dailyTargetHours} />
          </div>
        </div>
      </div>
    </div>
  )
}
