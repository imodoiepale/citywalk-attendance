import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import DayDetail from '@/components/calendar/DayDetail'
import { formatDayLabel } from '@/lib/timezone'

// The deep-link and refresh target for a single day.
//
// Reached by a hard load, a shared link, or a middle-click — a soft navigation
// from the month grid is intercepted by @sheet/(.)[date] and opens as an
// overlay instead. Both render the same DayDetail, so the two paths cannot
// drift apart; only the surrounding chrome differs.
export default async function DayDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  const [year, month] = date.split('-')

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div>
          <Link
            href={`/calendar?year=${year}&month=${Number(month)}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Calendar
          </Link>
          <h1 className="text-lg font-bold text-foreground">{formatDayLabel(date)}</h1>
        </div>

        <DayDetail date={date} />
      </div>
    </div>
  )
}
