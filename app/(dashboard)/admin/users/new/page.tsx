import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { listBranches } from '@/lib/admin/queries'
import CreateEmployeeForm from '@/components/admin/CreateEmployeeForm'

export default async function NewEmployeePage() {
  await requirePermission('admin.employees', 'full')
  const branches = await listBranches()

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          Users
        </Link>
        <h1 className="text-lg font-bold text-foreground sm:text-xl">Create employee</h1>
        <p className="text-xs text-muted-foreground">
          Create the account, hand over the temporary password in person, then enrol the biometric
          credential from a device on the profile page.
        </p>
      </div>
      <CreateEmployeeForm branches={branches} />
    </div>
  )
}
