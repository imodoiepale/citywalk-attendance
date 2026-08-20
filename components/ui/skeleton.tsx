import { cn } from '@/lib/utils'

/**
 * Shown while a route's data is in flight. At ~0.5s round-trip latency to
 * eu-west-1, a navigation without one reads as a frozen app — Next holds the
 * previous page on screen until the new one resolves. A skeleton makes the
 * transition immediate and the wait legible.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-secondary', className)}
      {...props}
    />
  )
}

export function TableSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      <Skeleton className="h-8 w-full max-w-xs" />
      <div className="overflow-hidden rounded-xl border border-border">
        <Skeleton className="h-9 w-full rounded-none" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="border-t border-border p-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PageSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
      {children}
    </div>
  )
}
