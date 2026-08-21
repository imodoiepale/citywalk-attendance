import { requireUser } from '@/lib/auth'
import { getDailyHoursForMonth, getWeeklyHours } from '@/lib/punches/queries'
import { getApprovedLeaveDayKeys } from '@/lib/leave/queries'
import { nairobiMonthRangeUtc } from '@/lib/timezone'
import { toNairobiDateKey } from '@/lib/timezone'
import { getSettings } from '@/lib/settings'
import CalendarView from '@/components/calendar/CalendarView'
import WeeklyProgressRing from '@/components/calendar/WeeklyProgressRing'

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
    <div className="h-screen w-full overflow-auto px-2 py-1.5 sm:px-3 lg:px-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-foreground sm:text-lg">Calendar</h1>
            <p className="text-[11px] text-muted-foreground sm:text-xs">Hours by day</p>
          </div>
          <div>
            <WeeklyProgressRing hoursThisWeek={weeklyHours} targetHours={settings.weeklyTargetHours} />
          </div>
        </div>

        <CalendarView
          year={year}
          month={month}
          hoursByDay={hoursByDay}
          todayKey={toNairobiDateKey(new Date().toISOString())}
          dailyTargetHours={settings.dailyTargetHours}
          leaveDayKeys={leaveDayKeys}
          monthLabel={monthLabel}
          monthTotal={monthTotal}
          prev={prev}
          next={next}
          isCurrentMonth={isCurrentMonth}
        />
      </div>
    </div>
  )
}
