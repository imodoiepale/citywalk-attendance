'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

// Split out so it can call useFormStatus, which only reads the enclosing
// <form> — it has to live inside the form element, not alongside it.
export default function SignOutSubmit() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
