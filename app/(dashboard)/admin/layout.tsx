import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { adminNavFor } from '@/lib/admin/nav'
import AdminSidebar from '@/components/admin/AdminSidebar'

/**
 * The admin area's own shell.
 *
 * Gating here rather than only per page means a role with, say, only
 * admin.devices never sees links to screens it cannot open — and an admin
 * section with no entries at all cannot be reached, instead of rendering an
 * empty rail beside a redirect.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const items = adminNavFor(user.permissions, user.role)

  if (items.length === 0) {
    redirect('/?error=forbidden')
  }

  return (
    <div className="w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <AdminSidebar items={items} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
