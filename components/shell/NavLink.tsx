'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  CheckSquare,
  BarChart3,
  TableProperties,
  PencilRuler,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/calendar': CalendarDays,
  '/leave': ClipboardList,
  '/leave/approvals': CheckSquare,
  '/attendance/corrections': PencilRuler,
  '/reports': BarChart3,
  '/reports/timesheets': TableProperties,
  '/admin/users': ShieldCheck,
}

export default function NavLink({
  href,
  label,
  variant = 'sidebar',
  exact = false,
}: {
  href: string
  label: string
  variant?: 'sidebar' | 'tab'
  /** Match the path exactly — set when another nav item nests under this one. */
  exact?: boolean
}) {
  const pathname = usePathname()
  const isActive = exact || href === '/' ? pathname === href : pathname.startsWith(href)
  const Icon = ICONS[href] ?? LayoutDashboard

  if (variant === 'tab') {
    return (
      <Link
        href={href}
        prefetch
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-150 ease-standard',
          isActive ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
        {label}
      </Link>
    )
  }

  // Sidebar treatment ported from the Portal Hub's NavItem: the active row is a
  // gold surface with a hairline border and inset glow, not a solid fill.
  return (
    <Link
      href={href}
      // prefetch={true} also promotes these routes to the `static` staleTime,
      // so a sidebar destination stays warm for 3 minutes once visited.
      prefetch
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex h-10 items-center gap-2.5 rounded-[11px] px-3 text-[13px] font-medium transition-colors duration-150 ease-standard',
        isActive
          ? 'border border-primary/20 bg-primary-surface text-primary shadow-selected'
          : 'text-muted-foreground hover:bg-card-hover hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
      <span className="truncate">{label}</span>
    </Link>
  )
}
