'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { signOutAction } from '@/app/(auth)/actions'

function ConfirmSubmit() {
  // useFormStatus reads the enclosing <form>'s pending state, so the button
  // disables itself while the Server Action runs without lifting state up.
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

export default function SignOutButton({ fullName }: { fullName: string }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="Sign out"
        onClick={() => setIsOpen(true)}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>

      <ConfirmDialog
        open={isOpen}
        title="Sign out?"
        description={`You're signed in as ${fullName}. On a shared branch device, sign out when you're done so the next person starts fresh.`}
        onCancel={() => setIsOpen(false)}
        confirmSlot={
          <form action={signOutAction}>
            <ConfirmSubmit />
          </form>
        }
      />
    </>
  )
}
