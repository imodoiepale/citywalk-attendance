'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModalBehaviour, usePrefersReducedMotion } from './use-modal-behaviour'

// A slide-in overlay panel: from the right on a desktop, up from the bottom
// edge on a phone.
//
// Distinct from ui/dialog.tsx rather than a `side` prop on it, for one reason:
// Dialog early-returns null when closed and has no transitions anywhere, so a
// slide needs machinery Dialog does not have and its three existing callers do
// not want. The shared Escape / scroll-lock / focus behaviour is not duplicated
// though — both sit on useModalBehaviour.
//
// Entrance is a CSS animation and exit is a CSS transition, which reads
// inconsistent but is deliberate. A transition needs the element painted in its
// "from" state before the class flips, so it has to wait a frame — and
// requestAnimationFrame does not run in a hidden tab, which would leave a sheet
// opened in a background tab parked off-screen until the tab was focused. An
// animation simply runs when the element is inserted. On the way out the
// element is already on screen, so a transition has a real starting point and
// gives us `transitionend` to unmount against.

/** Kept in step with the duration in the classes below; exported so a caller
 *  that has to sequence something against the exit (a route change, say) does
 *  not hardcode its own copy that can drift out of sync. */
export const SHEET_DURATION_MS = 300

// The easing below is the iOS sheet curve — it decelerates hard at the end, so
// the panel reads as settling into place rather than stopping. It is spelled
// out at each use site rather than held in a constant because Tailwind
// generates classes by scanning source text: an interpolated class name would
// never make it into the stylesheet.

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  initialFocusRef,
}: SheetProps) {
  const id = React.useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  const reducedMotion = usePrefersReducedMotion()
  const closeRef = useModalBehaviour({ open, onClose, initialFocusRef })

  // `mounted` outlives `open` by exactly one exit transition, so the slide-out
  // is visible at all. Everything else about the animation is CSS.
  const [mounted, setMounted] = React.useState(open)

  React.useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  React.useEffect(() => {
    // With motion reduced nothing transitions, so no `transitionend` will
    // arrive to unmount the panel. Do it directly instead.
    if (open || !reducedMotion) return
    const timer = window.setTimeout(() => setMounted(false), 0)
    return () => window.clearTimeout(timer)
  }, [open, reducedMotion])

  if (!mounted) return null

  const animated = !reducedMotion

  return (
    <div
      role="presentation"
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end',
        'bg-brand-ink/60 backdrop-blur-sm',
        animated && 'transition-opacity ease-standard',
        open
          ? animated && 'animate-[sheet-backdrop-in_300ms_ease-out]'
          : 'opacity-0 duration-300'
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
        // Unmount when the slide-out has actually finished rather than after a
        // timer that hopes to match it. Guarded to this element because
        // transitions on children bubble through here too.
        onTransitionEnd={(event) => {
          if (event.target !== event.currentTarget || open) return
          setMounted(false)
        }}
        className={cn(
          'flex max-h-[88vh] w-full flex-col overflow-hidden border border-border bg-popover shadow-card-hover',
          'rounded-t-2xl sm:h-full sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-2xl sm:border-y-0 sm:border-r-0',
          animated && 'transition-transform ease-[cubic-bezier(0.32,0.72,0,1)]',
          open
            ? animated &&
              'animate-[sheet-in-bottom_300ms_cubic-bezier(0.32,0.72,0,1)] sm:animate-[sheet-in-right_300ms_cubic-bezier(0.32,0.72,0,1)]'
            : 'translate-y-full duration-300 sm:translate-y-0 sm:translate-x-full',
          className
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The body scrolls, not the page. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer ? (
          <div className="shrink-0 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
