'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import MonthCalendar from './MonthCalendar'
import Legend from './Legend'

/**
 * The calendar view with a day-detail modal.
 *
 * Clicking a day opens a modal instead of navigating, keeping the month
 * view visible. This eliminates a page navigation and saves the back-button
 * UX.
 */
export default function CalendarView({
  year,
  month,
  hoursByDay,
  todayKey,
  dailyTargetHours,
  leaveDayKeys,
  monthLabel,
  monthTotal,
  prev,
  next,
  isCurrentMonth,
}: {
  year: number
  month: number
  hoursByDay: Map<string, number>
  todayKey: string
  dailyTargetHours: number
  leaveDayKeys: Set<string>
  monthLabel: string
  monthTotal: number
  prev: { year: number; month: number }
  next: { year: number; month: number }
  isCurrentMonth: boolean
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-2.5 shadow-card">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Link
            href={`/calendar?year=${prev.year}&month=${prev.month}`}
            className="rounded-full border border-border p-0.5 text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft className="h-3 w-3" />
          </Link>
          <div className="flex flex-col items-center">
            <span className="text-xs font-semibold text-foreground">{monthLabel}</span>
            <span className="text-[9px] text-primary-strong">{monthTotal.toFixed(1)}h</span>
          </div>
          {isCurrentMonth ? (
            <span className="rounded-full border border-transparent p-0.5 text-muted-foreground/30">
              <ChevronRight className="h-3 w-3" />
            </span>
          ) : (
            <Link
              href={`/calendar?year=${next.year}&month=${next.month}`}
              className="rounded-full border border-border p-0.5 text-muted-foreground hover:bg-accent"
            >
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        <MonthCalendar
          year={year}
          month={month}
          hoursByDay={hoursByDay}
          todayKey={todayKey}
          dailyTargetHours={dailyTargetHours}
          leaveDayKeys={leaveDayKeys}
          onSelectDate={setSelectedDate}
        />

        <div className="mt-1.5">
          <Legend dailyTargetHours={dailyTargetHours} />
        </div>
      </div>

      <Dialog
        open={!!selectedDate}
        onClose={() => setSelectedDate(null)}
        title={selectedDate ?? 'Day'}
        className="w-96"
      >
        <div className="space-y-2">
          <div>
            <p className="text-sm text-muted-foreground">Hours worked</p>
            <p className="text-2xl font-bold">
              {selectedDate ? (hoursByDay.get(selectedDate) ?? 0).toFixed(1) : '0'}h
            </p>
          </div>
          {selectedDate && leaveDayKeys.has(selectedDate) ? (
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <p className="text-base font-medium text-success">Approved leave</p>
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
