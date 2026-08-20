'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { routeKeyFor } from '@/lib/routes'
import { tourFor, type TourDefinition } from '@/lib/tours/definitions'
import { completeTourAction } from '@/lib/tours/actions'
import type { Role } from '@/lib/rbac-catalog'

interface TourContextValue {
  /** Whether the current route has a tour for this role. */
  available: boolean
  start: () => void
}

const TourContext = React.createContext<TourContextValue>({ available: false, start: () => {} })

export function useTour() {
  return React.useContext(TourContext)
}

export function TourProvider({
  role,
  completedTourIds,
  children,
}: {
  role: Role
  /** Tour ids this person has already finished, from the database. */
  completedTourIds: string[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const routeKey = routeKeyFor(pathname)
  const definition = tourFor(routeKey, role)

  // Tracked in a ref rather than state: an auto-start must fire once per route
  // visit, and re-rendering because of it would be pointless churn.
  const autoStarted = React.useRef<string | null>(null)
  const completed = React.useMemo(() => new Set(completedTourIds), [completedTourIds])

  const run = React.useCallback(
    async (tour: TourDefinition) => {
      const { driver } = await import('driver.js')

      // Only steps whose target is actually on the page. A role can hide an
      // element the tour names, and driver.js would otherwise highlight a
      // rectangle around nothing.
      const steps = tour.steps
        .filter((step) => document.querySelector(`[data-tour="${step.target}"]`))
        .map((step) => ({
          element: `[data-tour="${step.target}"]`,
          popover: {
            title: step.title,
            description: step.description,
            side: step.side ?? 'bottom',
            align: 'start' as const,
          },
        }))

      if (steps.length === 0) return

      const onFinish = () => {
        void completeTourAction(tour.id).catch(() => {})
      }

      driver({
        showProgress: true,
        allowClose: true,
        overlayColor: 'rgba(8, 9, 10, 0.75)',
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        doneBtnText: 'Got it',
        popoverClass: 'citywalk-tour',
        steps,
        // Both paths mark it done: someone who closes a tour early has still
        // decided they do not need it, and re-showing it every visit would be
        // nagging rather than helping.
        onDestroyed: onFinish,
      }).drive()
    },
    []
  )

  const start = React.useCallback(() => {
    if (definition) void run(definition)
  }, [definition, run])

  React.useEffect(() => {
    if (!definition) return
    if (completed.has(definition.id)) return
    if (autoStarted.current === definition.id) return
    autoStarted.current = definition.id

    // Let the page paint first, or driver.js measures elements mid-render and
    // highlights the wrong rectangle.
    const timer = window.setTimeout(() => void run(definition), 600)
    return () => window.clearTimeout(timer)
  }, [definition, completed, run])

  const value = React.useMemo(
    () => ({ available: definition !== null, start }),
    [definition, start]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}
