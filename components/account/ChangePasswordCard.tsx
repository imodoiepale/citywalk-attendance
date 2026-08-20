'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { KeyRound } from 'lucide-react'
import { changePasswordAction } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const MESSAGES: Record<string, string> = {
  'weak-password': 'Use at least 8 characters.',
  mismatch: 'Those two passwords do not match.',
  'wrong-password': 'That is not your current password.',
}

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Updating…' : 'Update password'}
    </Button>
  )
}

export default function ChangePasswordCard({
  error,
  notice,
}: {
  error?: string
  notice?: string
}) {
  // Opens itself when a failed attempt bounced back, so the person is not left
  // staring at a collapsed card with an error they cannot act on.
  const [open, setOpen] = useState(Boolean(error))
  const message = error ? (MESSAGES[error] ?? 'That did not work. Try again.') : null

  return (
    <Card data-tour="change-password">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">Password</p>
              <p className="text-xs text-muted-foreground">
                Change the password you sign in with.
              </p>
            </div>
          </div>
          {!open ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              Change
            </Button>
          ) : null}
        </div>

        {notice === 'password-changed' && !open ? (
          <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
            Password updated.
          </p>
        ) : null}

        {open ? (
          <form action={changePasswordAction} className="space-y-3 border-t border-border pt-3">
            {message ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                {message}
              </p>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="currentPassword" className="text-xs">
                Current password
              </Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className="h-9"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="password" className="text-xs">
                  New password
                </Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm" className="text-xs">
                  Confirm new password
                </Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="h-9"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <SaveButton />
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Forgotten it? Sign out and use{' '}
              <span className="font-medium text-foreground">Forgot password</span> on the sign-in
              screen instead.
            </p>
          </form>
        ) : null}
      </CardContent>
    </Card>
  )
}
