import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getApprovalQueue } from '@/lib/leave/queries'
import LeaveRequestList from '@/components/leave/LeaveRequestList'

export default async function LeaveApprovalsPage() {
  const user = await requireUser()

  // Approval reach can come from either a branch-scoped or an org-wide
  // grant — requirePermission() only checks one permission, so this page
  // gates manually against the "or" of both.
  const branchScoped = canAtLeast(user.permissions, user.role, 'leave.approve.branch', 'branch')
  const orgWide = canAtLeast(user.permissions, user.role, 'leave.approve.org', 'org')
  if (!branchScoped && !orgWide) {
    redirect('/?error=forbidden')
  }

  const requests = await getApprovalQueue(user.branchId, orgWide)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Leave approvals</h1>
        <p className="text-sm text-muted-foreground">
          {orgWide ? 'Pending requests across every branch.' : `Pending requests for ${user.branchName}.`}
        </p>
      </div>
      <LeaveRequestList requests={requests} currentUserId={user.id} showApprovalActions />
    </div>
  )
}
