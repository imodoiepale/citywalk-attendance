'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, LogOut, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { signOutAction } from '@/app/(auth)/actions'
import { ROLE_META, type Role } from '@/lib/rbac-catalog'
import { cn } from '@/lib/utils'
import SignOutSubmit from './SignOutSubmit'

function initialsOf(fullName: string) {
  return fullName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function UserMenu({
  fullName,
  branchName,
  role,
  email,
  compact = false,
}: {
  fullName: string
  branchName: string
  role: Role
  email: string
  /** Avatar + dropdown only — the top bar has no room for the full card. */
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click and on Escape. Without the outside-click handler the
  // menu stays open behind whatever you click next, which on a shared kiosk
  // leaves someone's name and branch on screen for the next person.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const initials = initialsOf(fullName)

  const menu = (
    <div
      role="menu"
      className={cn(
        'absolute z-50 w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-card-hover',
        compact ? 'right-0 top-11' : 'bottom-14 left-0'
      )}
    >
      <div className="border-b border-border px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {ROLE_META[role].label}
          </Badge>
          <span className="truncate text-[11px] text-muted-foreground">{branchName}</span>
        </div>
      </div>

      <Link
        href="/me"
        role="menuitem"
        onClick={() => setIsOpen(false)}
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-foreground"
      >
        <UserRound className="h-4 w-4" strokeWidth={1.8} />
        My profile
      </Link>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setIsOpen(false)
          setConfirmingSignOut(true)
        }}
        className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors duration-150 ease-standard hover:bg-card-hover hover:text-destructive"
      >
        <LogOut className="h-4 w-4" strokeWidth={1.8} />
        Sign out
      </button>
    </div>
  )

  const avatar = (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-icon-tile text-xs font-semibold text-primary ring-2 ring-primary/70">
      {initials}
    </span>
  )

  return (
    <>
      <div ref={containerRef} className="relative">
        {compact ? (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label="Account menu"
            onClick={() => setIsOpen((open) => !open)}
            className="flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-1.5 transition-colors duration-150 ease-standard hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {avatar}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ease-standard',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        ) : (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open) => !open)}
            className="flex w-full items-center gap-2.5 rounded-[11px] border border-border bg-card px-2.5 py-2 text-left transition-colors duration-150 ease-standard hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">
                {fullName}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">{branchName}</span>
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-standard',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        )}

        {isOpen ? menu : null}
      </div>

      <ConfirmDialog
        open={confirmingSignOut}
        title="Sign out?"
        description={`You're signed in as ${fullName}. On a shared branch device, sign out when you're done so the next person starts fresh.`}
        onCancel={() => setConfirmingSignOut(false)}
        confirmSlot={
          <form action={signOutAction}>
            <SignOutSubmit />
          </form>
        }
      />
    </>
  )
}
