'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { crumbsFor } from '@/lib/routes'
import { cn } from '@/lib/utils'

/**
 * Route trail in the top bar. Replaces the single-label PageTitle, which said
 * "Admin" on /admin/devices/unmatched and offered no way back up.
 *
 * Derived from the pathname rather than passed down, so a new page cannot
 * forget to set it. Crumbs whose route has no page (/admin, /attendance) render
 * as plain text — linking them would produce a 404.
 */
export default function Breadcrumbs({
  className,
  lastLabel,
}: {
  className?: string
  /** Overrides the final crumb, e.g. a person's name on a detail page. */
  lastLabel?: string
}) {
  const pathname = usePathname()
  const crumbs = crumbsFor(pathname, lastLabel)

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              ) : null}
              {crumb.href && !isLast ? (
                <Link
                  href={crumb.href}
                  className="truncate text-muted-foreground transition-colors duration-150 ease-standard hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn(
                    'truncate',
                    isLast ? 'font-semibold text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
