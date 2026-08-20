'use client'

import * as React from 'react'
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

// Hand-rolled rather than a toast library: the app needs one shape of
// notification, and the primitives here are already hand-rolled for the same
// reason. Kept deliberately small — a queue, a portal-less fixed container,
// and auto-dismiss.

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: number
  title: string
  description?: string
  variant: ToastVariant
  /** Milliseconds; 0 keeps it up until dismissed. */
  duration: number
}

type ToastInput = Omit<Partial<Toast>, 'id'> & { title: string }

const ToastContext = React.createContext<{ push: (toast: ToastInput) => void } | null>(null)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}

const ICONS: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: TriangleAlert,
  info: Info,
}

const TONE: Record<ToastVariant, string> = {
  success: 'border-success/30 text-success',
  error: 'border-destructive/30 text-destructive',
  warning: 'border-warning/30 text-warning',
  info: 'border-primary/30 text-primary',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const nextId = React.useRef(1)

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = React.useCallback((input: ToastInput) => {
    const toast: Toast = {
      id: nextId.current++,
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'info',
      duration: input.duration ?? 6000,
    }
    setToasts((current) => [...current, toast])
  }, [])

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* aria-live so a screen reader announces the decision rather than it
          being a purely visual event. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-0 sm:top-0 sm:items-end sm:pb-4"
      >
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  React.useEffect(() => {
    if (toast.duration === 0) return
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])

  const Icon = ICONS[toast.variant]

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-popover px-4 py-3 shadow-card-hover',
        TONE[toast.variant]
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
