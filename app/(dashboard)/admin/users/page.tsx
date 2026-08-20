import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { canAtLeast } from '@/lib/rbac-catalog'
import { listAllUsers } from '@/lib/admin/queries'
import { buttonVariants } from '@/components/ui/button'
import AdminUserTable from '@/components/admin/AdminUserTable'

export default async function AdminUsersPage() {
  const user = await requirePermission('admin.users', 'full')
  const users = await listAllUsers()

  const canBranches = canAtLeast(user.permissions, user.role, 'admin.branches', 'full')
  const canSettings = canAtLeast(user.permissions, user.role, 'admin.settings', 'full')
  const canDevices = canAtLeast(user.permissions, user.role, 'admin.devices', 'full')
  const canPermissions = canAtLeast(user.permissions, user.role, 'admin.permissions', 'full')

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground sm:text-xl">Users</h1>
          <p className="text-xs text-muted-foreground">
            {users.length} accounts. Change a role or deactivate here; edit names, job titles and
            branch on a user&rsquo;s own page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPermissions ? (
            <Link
              href="/admin/permissions"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Role rights
            </Link>
          ) : null}
          {canBranches ? (
            <Link
              href="/admin/branches"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Branches
            </Link>
          ) : null}
          {canDevices ? (
            <Link
              href="/admin/devices"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Devices
            </Link>
          ) : null}
          {canSettings ? (
            <Link
              href="/admin/settings"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Settings
            </Link>
          ) : null}
        </div>
      </div>

      <AdminUserTable users={users} currentUserId={user.id} />

      <p className="text-xs text-muted-foreground">
        New accounts are created by staff signing up and choosing their branch. Deactivating an
        account revokes access immediately without deleting its punch history. Your own row is
        read-only, and the last active admin cannot be deactivated or demoted — otherwise nobody
        would be left who could undo it.
      </p>
    </div>
  )
}
