import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { getMyLeaveRequests } from '@/lib/leave/queries'
import { buttonVariants } from '@/components/ui/button'
import LeaveRequestList from '@/components/leave/LeaveRequestList'

export default async function MyLeavePage() {
  const user = await requirePermission('leave.request.own', 'own')
  const requests = await getMyLeaveRequests(user.id)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">My leave</h1>
          <p className="text-sm text-muted-foreground">
            Requests you&rsquo;ve made, or that were filed on your behalf.
          </p>
        </div>
        <Link href="/leave/new" className={buttonVariants()}>
          Request leave
        </Link>
      </div>
      <LeaveRequestList requests={requests} currentUserId={user.id} showCancel />
    </div>
  )
}
