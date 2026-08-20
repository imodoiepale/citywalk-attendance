'use client'

import { CircleQuestionMark } from 'lucide-react'
import { useTour } from './TourProvider'
import { cn } from '@/lib/utils'

/**
 * Restarts the walkthrough for the current screen and role.
 *
 * Always rendered, never hidden once a tour has been completed — the point is
 * that someone who has forgotten what a screen is for can always ask again.
 * It is disabled rather than removed on screens with no tour, so its position
 * in the top bar does not jump around between pages.
 */
export default function HelpButton({ className }: { className?: string }) {
  const { available, start } = useTour()

  return (
    <button
      type="button"
      data-tour="help-button"
      onClick={start}
      disabled={!available}
      aria-label={available ? 'Show me around this page' : 'No walkthrough for this page'}
      title={available ? 'Show me around this page' : 'No walkthrough for this page'}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 disabled:hover:bg-transparent',
        className
      )}
    >
      <CircleQuestionMark className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
}
