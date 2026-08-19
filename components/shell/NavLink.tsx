'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, CalendarDays, ClipboardList, CheckSquare, BarChart3, TableProperties, ShieldCheck, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/calendar': CalendarDays,
  '/leave': ClipboardList,
  '/leave/approvals': CheckSquare,
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
        className={cn(
          'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
          isActive ? 'text-primary-strong' : 'text-muted-foreground'
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={isActive ? 2.2 : 1.8} />
        {label}
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={isActive ? 2.2 : 1.8} />
      {label}
    </Link>
  )
}
