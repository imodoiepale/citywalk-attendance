import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listBranches } from '@/lib/admin/queries'
import BranchEditor from '@/components/admin/BranchEditor'

export default async function AdminBranchesPage() {
  await requirePermission('admin.branches', 'full')
  const branches = await listBranches()

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Admin
        </Link>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Branches</h1>
        <p className="text-xs text-muted-foreground">
          {branches.length} branches. Coordinates and radius are stored for future geofenced
          punches — leaving them empty means no geofence is enforced.
        </p>
      </div>

      <BranchEditor branches={branches} />
    </div>
  )
}
