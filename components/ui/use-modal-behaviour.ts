'use client'

import * as React from 'react'

// The three things every overlay in this app has to do: close on Escape, stop
// the page behind it scrolling, and move focus into itself on open.
//
// This effect was duplicated verbatim in ui/dialog.tsx, ui/confirm-dialog.tsx
// and shell/NavDrawer.tsx. Adding a fourth copy for the sheet was the point at
// which it had to become a hook. The existing three are intentionally left on
// their own copies for now — they work, and rewriting them buys no behaviour
// change while enlarging the diff.

export function useModalBehaviour({
  open,
  onClose,
  initialFocusRef,
}: {
  open: boolean
  onClose: () => void
  /** Focused when the overlay opens; falls back to the returned ref's element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const fallbackRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    if (!open) return

    // Let the field mount before focusing it.
    const focusTimer = window.setTimeout(() => {
      ;(initialFocusRef?.current ?? fallbackRef.current)?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Stop the page behind the overlay scrolling under it on touch devices.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open, onClose, initialFocusRef])

  /** Attach to the element that should receive focus when nothing else claims it. */
  return fallbackRef
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Whether the visitor has asked for reduced motion.
 *
 * A media query is an external store, so this subscribes to it rather than
 * mirroring it into state from an effect — that would be a setState cascade on
 * every mount, which this project's lint rules reject outright. The server
 * snapshot is `false` (assume motion is fine); React reconciles on hydration
 * if the real preference differs, with no mismatch warning.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  )
}
