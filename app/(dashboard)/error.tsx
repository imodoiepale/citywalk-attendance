'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Without this boundary a failed Server Action (e.g. clocking out with no open
// shift) surfaces as Next's raw error overlay. Error messages here are the
// ones our actions throw deliberately, so they're worth showing verbatim.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" strokeWidth={1.8} />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          {error.message || 'That action could not be completed.'}
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
