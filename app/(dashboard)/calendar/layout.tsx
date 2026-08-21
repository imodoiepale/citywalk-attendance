// The calendar owns a parallel `@sheet` slot so a day can open as an overlay
// on top of the month grid instead of replacing it.
//
// `children` stays on the month grid during a client-side navigation to
// /calendar/[date]; the intercepting route inside @sheet renders the day on
// top. On a hard load of that URL the slot has nothing to match, falls back to
// @sheet/default.tsx (null), and `children` resolves to the real [date] page.
export default function CalendarLayout({
  children,
  sheet,
}: {
  children: React.ReactNode
  sheet: React.ReactNode
}) {
  return (
    <>
      {children}
      {sheet}
    </>
  )
}
