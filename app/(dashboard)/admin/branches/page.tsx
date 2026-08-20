import { requirePermission } from '@/lib/auth'
import { listBranches } from '@/lib/admin/queries'
import BranchEditor from '@/components/admin/BranchEditor'

export default async function AdminBranchesPage() {
  await requirePermission('admin.branches', 'full')
  const branches = await listBranches()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Branches</h1>
        <p className="text-xs text-muted-foreground">
          {branches.length} branches. Coordinates and radius are stored for future geofenced punches
          — leaving them empty means no geofence is enforced.
        </p>
      </div>

      <BranchEditor branches={branches} />
    </div>
  )
}
