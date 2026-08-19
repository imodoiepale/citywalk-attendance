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
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {WEEKDAY_LABELS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {weeks.map((week, i) => (
        <div key={i} className="grid grid-cols-7 gap-1.5">
          {week.map((day, j) => {
            const dateKey = day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null
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
  )
}
