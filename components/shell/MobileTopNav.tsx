'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { isExactNav, type NavItem } from '@/lib/rbac-catalog'

/**
 * Secondary nav row under the mobile header. The bottom tab bar holds the four
 * primary destinations; this row lists *every* destination the user has, so
 * anything in the "More" overflow is still reachable in one tap. It scrolls
 * horizontally rather than wrapping, keeping the header a fixed height.
 */
export default function MobileTopNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Sections"
      className="flex gap-1.5 overflow-x-auto border-b border-border bg-background/80 px-3 py-2 backdrop-blur-sm [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      {nav.map((item) => {
        const exact = isExactNav(nav, item.href)
        const isActive = exact ? pathname === item.href : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-accent'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
