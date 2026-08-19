import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInAction } from '../actions'

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Enter your email and password.',
  invalid: 'Incorrect email or password.',
  deactivated: 'Your account has been deactivated. Contact your branch manager or HR.',
  forbidden: "You don't have access to that page.",
  'link-invalid': 'That link is not valid. Request a new one.',
  'link-expired': 'That link has expired or was already used. Request a new one.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; next?: string }>
}) {
  const params = await searchParams
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? 'Something went wrong. Try again.' : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Clock in, request leave, and view your schedule.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {params.notice === 'check-email' && (
          <p className="rounded-lg bg-[#12B76A]/10 px-3 py-2 text-sm text-[#12B76A]">
            Check your email to confirm your account, then sign in.
          </p>
        )}
        {params.notice === 'reset-sent' && (
          <p className="rounded-lg bg-[#12B76A]/10 px-3 py-2 text-sm text-[#12B76A]">
            If that address has an account, a reset link is on its way.
          </p>
        )}
        {errorMessage && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
        )}
        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="next" value={params.next ?? '/'} />
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Forgot password?
              </Link>
            </div>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          New here?{' '}
          <Link href="/signup" className="font-medium text-primary-strong underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
