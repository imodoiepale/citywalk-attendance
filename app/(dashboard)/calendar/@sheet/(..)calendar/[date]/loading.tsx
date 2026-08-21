// Shown inside the sheet while the day's punches load.
//
// Without this the slot stays empty during the fetch, so clicking a day looks
// like nothing happened until the data lands.
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/60 backdrop-blur-sm sm:items-stretch sm:justify-end">
      <div className="flex w-full flex-col gap-3 rounded-t-2xl border border-border bg-popover p-4 sm:h-full sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl">
        <div className="h-5 w-48 animate-pulse rounded bg-secondary" />
        <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
        <div className="h-24 w-full animate-pulse rounded-xl bg-secondary" />
        <div className="h-24 w-full animate-pulse rounded-xl bg-secondary" />
      </div>
    </div>
  )
}
