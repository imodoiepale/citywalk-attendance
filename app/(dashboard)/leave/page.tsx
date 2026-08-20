import { requirePermission } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getBranchStaff, getMyLeaveRequests } from '@/lib/leave/queries'
import LeaveRequestList from '@/components/leave/LeaveRequestList'
import RequestLeaveDialog from '@/components/leave/RequestLeaveDialog'

export default async function MyLeavePage() {
  const user = await requirePermission('leave.request.own', 'own')

  // The on-behalf picker's data has to be resolved here: getBranchStaff is
  // server-only, so the dialog (a Client Component) cannot fetch it itself.
  const canFileOnBehalf = canAtLeast(
    user.permissions,
    user.role,
    'leave.request.on_behalf',
    'branch',
  )
  const orgWide = canAtLeast(user.permissions, user.role, 'leave.request.on_behalf', 'org')

  const [requests, staffOptions] = await Promise.all([
    getMyLeaveRequests(user.id),
    canFileOnBehalf ? getBranchStaff(user.branchId, orgWide) : Promise.resolve([]),
  ])

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-foreground sm:text-xl">My leave</h1>
            <p className="text-xs text-muted-foreground">
              Requests you&rsquo;ve made, or that were filed on your behalf.
            </p>
          </div>
          <RequestLeaveDialog
            currentUserId={user.id}
            currentUserName={user.fullName}
            canFileOnBehalf={canFileOnBehalf}
            staffOptions={staffOptions}
          />
        </div>
        <LeaveRequestList requests={requests} currentUserId={user.id} showCancel />
      </div>
    </div>
  )
}
