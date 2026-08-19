'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// A small hand-rolled modal in the same spirit as the rest of components/ui:
// no Radix, focus handled with an initial-focus ref plus Escape-to-close.
// Branch devices are shared, so an accidental sign-out is a real cost —
// hence a confirm step rather than a one-tap logout.

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'default' | 'destructive'
  isPending?: boolean
  onCancel: () => void
  /** Rendered inside the dialog so a Server Action <form> can wrap the button. */
  confirmSlot?: React.ReactNode
  onConfirm?: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  isPending,
  onCancel,
  confirmSlot,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    // Stop the page behind the dialog scrolling under it on touch devices.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="presentation"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-ink/60 p-4 backdrop-blur-sm sm:items-center"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-card',
          'pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5'
        )}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="-mr-1 -mt-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {description ? (
          <p id="confirm-dialog-description" className="text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          {confirmSlot ?? (
            <Button variant={confirmVariant} onClick={onConfirm} disabled={isPending}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
