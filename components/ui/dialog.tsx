'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// A general-purpose modal for hosting arbitrary content, sibling to
// confirm-dialog.tsx. That one is deliberately narrow — it takes a title and a
// description and puts its only injection point in the footer button row — so a
// five-field form rendered through it would land squeezed between Cancel and
// Confirm. Rather than widen it and make the simple case worse, this shares its
// behaviour (Escape, scroll lock, backdrop, safe-area bottom sheet) and differs
// where a form needs it to: a children body, role="dialog", per-instance ids,
// a configurable width, a scroll cap, and initial focus on the first field.

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  /** Footer content, typically the submit/cancel row. */
  footer?: React.ReactNode
  className?: string
  /** Focused when the dialog opens; falls back to the close button. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  initialFocusRef,
}: DialogProps) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  // Unique per instance: confirm-dialog hardcodes its aria ids, which collide
  // the moment two dialogs exist in one tree.
  const id = React.useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  React.useEffect(() => {
    if (!open) return

    // Let the field mount before focusing it.
    const focusTimer = window.setTimeout(() => {
      ;(initialFocusRef?.current ?? closeRef.current)?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Stop the page behind the dialog scrolling under it on touch devices.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose, initialFocusRef])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-xl border border-border bg-popover shadow-card-hover sm:max-h-[85vh] sm:rounded-xl',
          'sm:max-w-lg',
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

        {/* The body scrolls, not the page — a long form plus an on-screen
            keyboard otherwise pushes the submit button out of reach. */}
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
