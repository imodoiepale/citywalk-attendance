'use client'

import { usePathname } from 'next/navigation'
import { NAV } from '@/lib/rbac-catalog'
import { cn } from '@/lib/utils'

// Titles for routes that are reachable but not in NAV (detail pages, forms).
const EXTRA_TITLES: { prefix: string; label: string }[] = [
  { prefix: '/admin/permissions', label: 'Role rights' },
  { prefix: '/admin/branches', label: 'Branches' },
  { prefix: '/admin/settings', label: 'Org settings' },
  { prefix: '/admin/users', label: 'Users' },
  { prefix: '/leave/new', label: 'Request leave' },
  { prefix: '/calendar/', label: 'Day detail' },
  { prefix: '/me', label: 'My profile' },
]

/**
 * Names the current screen in the desktop top bar. Derived from the route
 * rather than passed down, so a new page cannot forget to set it — the worst
 * case is the generic fallback, never a stale title from the previous page.
 */
export default function PageTitle({ className }: { className?: string }) {
  const pathname = usePathname()

  const longestNavMatch = NAV.filter((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
  ).sort((a, b) => b.href.length - a.href.length)[0]

  const extra = EXTRA_TITLES.filter((entry) => pathname.startsWith(entry.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0]

  const label =
    (extra && (!longestNavMatch || extra.prefix.length >= longestNavMatch.href.length)
      ? extra.label
      : longestNavMatch?.label) ?? 'Attendance'

  return <span className={cn('truncate text-sm font-semibold text-foreground', className)}>{label}</span>
}
