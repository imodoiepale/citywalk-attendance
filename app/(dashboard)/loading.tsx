export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-12">
      <div className="mx-auto h-6 w-40 animate-pulse rounded-md bg-secondary" />
      <div className="mx-auto h-64 w-64 animate-pulse rounded-full bg-secondary" />
      <div className="mx-auto h-14 w-full max-w-md animate-pulse rounded-full bg-secondary" />
    </div>
  )
}
