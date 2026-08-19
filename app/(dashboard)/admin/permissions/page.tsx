import { requirePermission } from '@/lib/auth'
import { getPermissionMatrix } from '@/lib/admin/queries'
import PermissionMatrixEditor from '@/components/admin/PermissionMatrixEditor'

export default async function AdminPermissionsPage() {
  await requirePermission('admin.permissions', 'full')
  const matrix = await getPermissionMatrix()

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold text-foreground">Role rights</h1>
        <p className="text-sm text-muted-foreground">
          What each role can do. Admin always has full access, everywhere — it can&rsquo;t be edited here, so
          there&rsquo;s no way to lock every admin out by misconfiguring this table.
        </p>
      </div>
      <PermissionMatrixEditor matrix={matrix} />
    </div>
  )
}
