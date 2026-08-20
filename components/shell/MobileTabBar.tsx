'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { MoreHorizontal, X } from 'lucide-react'
import NavLink from './NavLink'
import { cn } from '@/lib/utils'
import type { ClientNavItem } from '@/lib/rbac-catalog'

/**
 * Bottom tab bar for phones. Anything past the tab slots goes behind "More"
 * rather than shrinking every tab until the labels are unreadable.
 *
 * pb-[env(safe-area-inset-bottom)] keeps the row clear of the iOS home
 * indicator — this bar is fixed to the bottom of a PWA in standalone mode.
 */
export default function MobileTabBar({
  tabs,
  overflow,
}: {
  tabs: ClientNavItem[]
  overflow: ClientNavItem[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const overflowActive = overflow.some((item) => pathname.startsWith(item.href))

  return (
    <>
      {isOpen ? (
        <div
          className="fixed inset-0 z-30 bg-brand-ink/50 backdrop-blur-sm md:hidden"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">More</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1" onClick={() => setIsOpen(false)}>
              {overflow.map((item) => (
                <NavLink key={item.href} href={item.href} label={item.label} exact={item.exact} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden">
        {tabs.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            variant="tab"
            exact={item.exact}
          />
        ))}

        {overflow.length > 0 ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open) => !open)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
              isOpen || overflowActive ? 'text-primary-strong' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal
              className="h-5 w-5"
              strokeWidth={isOpen || overflowActive ? 2.2 : 1.8}
            />
            More
          </button>
        ) : null}
      </nav>
    </>
  )
}
