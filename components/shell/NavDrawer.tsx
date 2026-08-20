'use client'

import * as React from 'react'
import Image from 'next/image'
import { Menu, X } from 'lucide-react'
import NavLink from './NavLink'
import ThemeToggle from './ThemeToggle'
import HelpButton from '@/components/tour/HelpButton'
import { cn } from '@/lib/utils'
import type { ClientNavItem } from '@/lib/rbac-catalog'
import { ROLE_META, type Role } from '@/lib/rbac-catalog'

/**
 * Hamburger drawer for phones and tablets.
 *
 * Carries *every* destination, not just the bottom bar's overflow — the point
 * of a hamburger is that nothing is unreachable from it. The bottom tabs stay
 * for the four most-used screens, so common work is still one thumb-tap.
 *
 * Escape / scroll-lock / backdrop behaviour matches components/ui/dialog.tsx.
 * Its aria ids are per-instance there for a reason; this has only one instance
 * so a fixed id is safe.
 */
export default function NavDrawer({
  nav,
  fullName,
  branchName,
  role,
}: {
  nav: ClientNavItem[]
  fullName: string
  branchName: string
  role: Role
}) {
  const [open, setOpen] = React.useState(false)
  const closeRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const initials = fullName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <>
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={1.8} />
      </button>

      {open ? (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-brand-ink/60 backdrop-blur-sm lg:hidden"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onClick={(event) => event.stopPropagation()}
            className="flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-sidebar"
          >
            <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-4">
              <div>
                <Image
                  src="/logo-wordmark.png"
                  alt="Citywalk"
                  width={158}
                  height={53}
                  className="h-auto w-[120px] dark:brightness-0 dark:invert"
                />
                <p className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground">
                  Attendance
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="-mr-1 rounded-full p-1.5 text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Closing on click here rather than on each link keeps the drawer
                from staying open behind the page you just navigated to. */}
            <nav
              className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
              onClick={() => setOpen(false)}
            >
              {nav.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} exact={item.exact} />
              ))}
            </nav>

            <div className="space-y-3 border-t border-border p-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-icon-tile text-xs font-semibold text-primary ring-2 ring-primary/70">
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {fullName}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {ROLE_META[role].label} · {branchName}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1">
                <ThemeToggle />
                <HelpButton />
                <span className="ml-1 text-[11px] text-muted-foreground">Theme · Help</span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function DrawerToggleSpacer({ className }: { className?: string }) {
  return <span className={cn('hidden lg:block', className)} aria-hidden="true" />
}
