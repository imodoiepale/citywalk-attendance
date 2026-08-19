import { requireUser } from '@/lib/auth'
import { getTodaysPunches } from '@/lib/punches/queries'
import DashboardClient from '@/components/DashboardClient'

export default async function DashboardPage() {
  const user = await requireUser()
  const punches = await getTodaysPunches(user.id)

  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:py-12">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Hi {user.fullName.split(' ')[0]}
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
          {user.branchName} — punch in, watch the dial fill, punch out.
        </p>
      </div>

      <DashboardClient punches={punches} />
    </div>
  )
}
