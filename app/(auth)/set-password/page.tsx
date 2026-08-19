import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { setPasswordAction } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ERROR_MESSAGES: Record<string, string> = {
  'weak-password': 'Use at least 8 characters.',
  mismatch: 'Those two passwords do not match.',
}

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  // Reachable only with the session the recovery link established. Anyone
  // arriving without one is sent to sign in rather than shown a form that
  // cannot possibly work.
  const user = await getCurrentUser()
  if (!user) redirect('/login?error=link-expired')

  const params = await searchParams
  const error = params.error
    ? (ERROR_MESSAGES[params.error] ?? decodeURIComponent(params.error))
    : null

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-foreground">Choose a password</h1>
        <p className="text-sm text-muted-foreground">
          Setting the password for <span className="font-medium">{user.email}</span>.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <form action={setPasswordAction} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full">
          Save password
        </Button>
      </form>
    </div>
  )
}
