import Image from 'next/image'
import NavLink from './NavLink'
import UserMenu from './UserMenu'
import MobileTabBar from './MobileTabBar'
import ThemeToggle from './ThemeToggle'
import PageTitle from './PageTitle'
import { isExactNav, navFor, splitNavForMobile, toClientNav } from '@/lib/rbac-catalog'
import type { CurrentUser } from '@/lib/auth'

export default function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const nav = navFor(user.permissions, user.role)
  const { tabs, overflow } = splitNavForMobile(nav)
  // NavItem carries a `match` function, which cannot be serialized across the
  // server/client boundary — strip it before handing the nav to any client
  // component.
  const clientTabs = toClientNav(tabs)
  const clientOverflow = toClientNav(overflow)

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar — 232px and its own surface token, matching the Portal
          Hub so moving between the two apps does not shift the content column.
          Breakpoint is lg, not md: at md the sidebar plus a timesheet's day
          columns left nothing readable. */}
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col justify-between overflow-y-auto border-r border-border bg-sidebar px-4 py-5 lg:flex">
        <div>
          <div className="mb-6">
            <Image
              src="/logo-wordmark.png"
              alt="Citywalk"
              width={158}
              height={53}
              priority
              className="h-auto w-[124px] dark:brightness-0 dark:invert"
            />
            <p className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground">
              Attendance
            </p>
          </div>

          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                exact={isExactNav(nav, item.href)}
              />
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          <UserMenu
            fullName={user.fullName}
            branchName={user.branchName}
            role={user.role}
            email={user.email}
          />
          <div className="border-t border-border pt-3 text-[10px] text-muted-foreground/70">
            © {new Date().getFullYear()} Citywalk. All rights reserved.
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Sticky at every size: the theme toggle and account controls should
            stay reachable partway down a long timesheet. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/logo-wordmark.png"
              alt="Citywalk"
              width={158}
              height={53}
              priority
              className="h-auto w-[104px] dark:brightness-0 dark:invert lg:hidden"
            />
            {/* On desktop the sidebar already carries the brand, so this slot
                says where you are instead of repeating it. */}
            <PageTitle className="hidden lg:block" />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <UserMenu
              fullName={user.fullName}
              branchName={user.branchName}
              role={user.role}
              email={user.email}
              compact
            />
          </div>
        </header>

        <main className="flex-1 pb-24 lg:pb-0">{children}</main>

        {/* Bottom tabs below lg — branch devices are phones and tablets. */}
        <MobileTabBar tabs={clientTabs} overflow={clientOverflow} />
      </div>
    </div>
  )
}
