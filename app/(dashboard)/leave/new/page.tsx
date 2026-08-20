import { requirePermission } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getBranchStaff } from '@/lib/leave/queries'
import LeaveRequestForm from '@/components/leave/LeaveRequestForm'

export default async function NewLeaveRequestPage() {
  const user = await requirePermission('leave.request.own', 'own')

  const canFileOnBehalf = canAtLeast(
    user.permissions,
    user.role,
    'leave.request.on_behalf',
    'branch',
  )
  const orgWide = canAtLeast(user.permissions, user.role, 'leave.request.on_behalf', 'org')
  const staffOptions = canFileOnBehalf ? await getBranchStaff(user.branchId, orgWide) : []

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Request leave</h1>
          <p className="text-sm text-muted-foreground">
            Annual, sick, compassionate, unpaid, or other.
          </p>
        </div>
        <LeaveRequestForm
          currentUserId={user.id}
          currentUserName={user.fullName}
          canFileOnBehalf={canFileOnBehalf}
          staffOptions={staffOptions}
        />
      </div>
    </div>
  )
}
