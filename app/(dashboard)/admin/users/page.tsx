import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { listAllUsers } from '@/lib/admin/queries'
import { buttonVariants } from '@/components/ui/button'
import AdminUserTable from '@/components/admin/AdminUserTable'

export default async function AdminUsersPage() {
  await requirePermission('admin.users', 'full')
  const users = await listAllUsers()

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground">Manage roles and activation.</p>
        </div>
        <Link href="/admin/permissions" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          Edit role rights
        </Link>
      </div>
      <AdminUserTable users={users} />
    </div>
  )
}
