import DayCell from './DayCell'

interface MonthCalendarProps {
  year: number
  month: number // 1-12
  hoursByDay: Map<string, number> // "YYYY-MM-DD" -> hours
  todayKey: string
  dailyTargetHours: number
  /** Nairobi date keys the user has approved leave on. */
  leaveDayKeys?: Set<string>
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Six weeks of seven days. See TOTAL_CELLS for why it is always six. */
const TOTAL_CELLS = 42

export default function MonthCalendar({
  year,
  month,
  hoursByDay,
  todayKey,
  dailyTargetHours,
  leaveDayKeys,
}: MonthCalendarProps) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const firstWeekday = firstOfMonth.getUTCDay() // 0 = Sunday

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Always six rows, not "however many this month needs". A month that fits in
  // five would otherwise render shorter, and since the grid now divides a
  // fixed height, the cells would visibly change size as you page through the
  // year.
  while (cells.length < TOTAL_CELLS) cells.push(null)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return (
    <div data-tour="month-calendar" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="grid shrink-0 grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* On a desktop the six rows split the leftover height between them, so
          the month always fits exactly. Below `lg` there is no height to
          divide and the square cells set the height instead. */}
      <div className="grid min-h-0 flex-1 gap-1.5 lg:grid-rows-6">
        {weeks.map((week, i) => (
          <div key={i} className="grid min-h-0 grid-cols-7 gap-1.5">
            {week.map((day, j) => {
              const dateKey = day
                ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                : null
              return (
                <DayCell
                  key={j}
                  day={day}
                  dateKey={dateKey}
                  hours={dateKey ? (hoursByDay.get(dateKey) ?? 0) : 0}
                  isToday={dateKey === todayKey}
                  dailyTargetHours={dailyTargetHours}
                  onLeave={dateKey ? (leaveDayKeys?.has(dateKey) ?? false) : false}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
