import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { getAllApprovals } from '@/lib/leave/queries'
import ApprovalsTable from '@/components/leave/ApprovalsTable'

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

  // Every status, not just pending: "what did we decide last month" is as real
  // a question as "what needs me today", and the tab counts have to come from
  // the same fetch as the rows or they would disagree.
  const requests = await getAllApprovals(user.branchId, orgWide)

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-5">
      <div>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Leave approvals</h1>
        <p className="text-xs text-muted-foreground">
          {orgWide ? 'Every branch' : user.branchName} ·{' '}
          {requests.filter((r) => r.status === 'pending').length} awaiting a decision.
        </p>
      </div>

      <ApprovalsTable requests={requests} canDecide />
    </div>
  )
}
