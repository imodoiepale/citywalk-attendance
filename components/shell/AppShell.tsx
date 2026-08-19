import Image from 'next/image'
import NavLink from './NavLink'
import UserMenu from './UserMenu'
import { navFor } from '@/lib/rbac-catalog'
import type { CurrentUser } from '@/lib/auth'

export default function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const nav = navFor(user.permissions, user.role)

  return (
    <div className="min-h-screen bg-background md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col gap-4 border-r border-border bg-card/60 p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <Image src="/logo-mark.png" alt="Citywalk" width={28} height={28} className="rounded-md" />
          <span className="bg-gradient-to-r from-[#AB8704] to-[#FDEC06] bg-clip-text text-sm font-semibold text-transparent">
            Citywalk Attendance
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
        <UserMenu fullName={user.fullName} branchName={user.branchName} role={user.role} />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-sm md:hidden">
          <div className="flex items-center gap-2">
            <Image src="/logo-mark.png" alt="Citywalk" width={24} height={24} className="rounded-md" />
            <span className="bg-gradient-to-r from-[#AB8704] to-[#FDEC06] bg-clip-text text-sm font-semibold text-transparent">
              Citywalk Attendance
            </span>
          </div>
          <UserMenu fullName={user.fullName} branchName={user.branchName} role={user.role} />
        </header>

        <main className="flex-1 pb-20 md:pb-0">{children}</main>

        {/* Mobile bottom tab bar — branch devices are often phones/tablets */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} variant="tab" />
          ))}
        </nav>
      </div>
    </div>
  )
}
