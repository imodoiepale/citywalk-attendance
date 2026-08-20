import { cn } from '@/lib/utils'

// One container for every screen.
//
// Pages had grown nine different widths — max-w-lg through max-w-7xl and one
// max-w-[100rem] — each centred with mx-auto. Moving between them, the content
// column jumped left and right and started at a different place every time.
//
// The fix is to stop centring. The sidebar already sets where content begins;
// a page just fills the space it is given, so every screen starts on the same
// left edge. The only exception is the dashboard, whose dial is a deliberately
// centred focal point.

export function PageShell({
  children,
  className,
  /** Centres and caps the width. Only the dashboard should use this. */
  centered = false,
}: {
  children: React.ReactNode
  className?: string
  centered?: boolean
}) {
  return (
    <div
      className={cn(
        'w-full px-4 pb-8 sm:px-6 lg:px-8',
        centered && 'mx-auto max-w-4xl',
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Page title, description and actions — sticky under the top bar.
 *
 * `top-14` is the top bar's height. Staying put while a long table scrolls
 * means you can always see which screen you are on and reach its actions,
 * rather than having to scroll back up to find them.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbSlot,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  breadcrumbSlot?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'sticky top-14 z-10 -mx-4 mb-4 border-b border-border bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8',
        className
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {breadcrumbSlot}
          <h1 className="truncate text-lg font-bold text-foreground sm:text-xl">{title}</h1>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

/** Vertical rhythm for a page's body, so spacing is not re-decided per page. */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={cn('space-y-4', className)}>{children}</div>
}
