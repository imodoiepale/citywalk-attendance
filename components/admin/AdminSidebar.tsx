'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardList,
  Fingerprint,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AdminNavItem } from '@/lib/admin/nav'

const ICONS: Record<string, LucideIcon> = {
  '/admin/users': ShieldCheck,
  '/admin/permissions': ClipboardList,
  '/admin/branches': Store,
  '/admin/devices': Fingerprint,
  '/admin/settings': SlidersHorizontal,
  '/admin/audit': ScrollText,
}

/**
 * Second-level navigation for the admin area.
 *
 * Horizontal above a page below `xl` and a rail beside it above — a fixed
 * vertical rail plus the main sidebar plus a wide table left nothing readable
 * on a laptop, the same reason the main sidebar starts at `lg`.
 */
export default function AdminSidebar({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname()

  const isActive = (href: string) =>
    href === '/admin/users'
      ? pathname === href || pathname.startsWith('/admin/users/')
      : pathname.startsWith(href)

  return (
    <nav
      data-tour="admin-nav"
      aria-label="Admin sections"
      className={cn(
        'shrink-0',
        // Scrolling pill row on narrow screens, sticky rail on wide ones.
        'flex gap-1.5 overflow-x-auto border-b border-border pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        'xl:sticky xl:top-[7.5rem] xl:w-56 xl:flex-col xl:gap-1 xl:overflow-visible xl:border-b-0 xl:border-r xl:border-border xl:pb-0 xl:pr-3'
      )}
    >
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? ShieldCheck
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex shrink-0 items-center gap-2 rounded-[11px] px-3 py-2 text-[13px] font-medium transition-colors duration-150 ease-standard xl:items-start',
              active
                ? 'border border-primary/20 bg-primary-surface text-primary shadow-selected'
                : 'text-muted-foreground hover:bg-card-hover hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0 xl:mt-0.5" strokeWidth={1.8} />
            <span className="min-w-0">
              <span className="block truncate">{item.label}</span>
              {/* The description only earns its space in the rail. */}
              <span
                className={cn(
                  'hidden text-[11px] font-normal xl:block',
                  active ? 'text-primary/70' : 'text-muted-foreground/70'
                )}
              >
                {item.description}
              </span>
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
