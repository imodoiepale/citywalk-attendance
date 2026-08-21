import { notFound } from 'next/navigation'
import DaySheet from '@/components/calendar/DaySheet'
import DayDetail from '@/components/calendar/DayDetail'

// Intercepts /calendar/[date] when reached from the month grid.
//
// The matcher is `(..)calendar/[date]`, not `(.)[date]`. @sheet is a slot
// rather than a route segment, so it sits at the /calendar segment level;
// `(..)` steps up from there to the root and the rest of the path is spelled
// out normally. Putting the marker straight onto a dynamic segment instead
// fails at request time with "Invalid interception route: /calendar/(.)(.)…",
// because the marker has to lead a path, not a parameter.
//
// DaySheet is a Client Component and DayDetail is a Server Component passed to
// it as children — the split that lets an overlay show server-only data.
export default async function InterceptedDayPage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound()

  return (
    <DaySheet date={date}>
      <DayDetail date={date} />
    </DaySheet>
  )
}
