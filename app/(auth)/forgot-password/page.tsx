import Link from 'next/link'
import { headers } from 'next/headers'
import { requestPasswordResetAction } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  // The reset link has to point back at whichever host this is actually being
  // served from — localhost in dev, the real domain in production — so the
  // origin is read from the request rather than hardcoded.
  const headerList = await headers()
  const host = headerList.get('host') ?? 'localhost:3000'
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
  const origin = `${protocol}://${host}`

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-foreground">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          We&rsquo;ll email you a link to choose a new one.
        </p>
      </div>

      {params.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          Enter the email address you sign in with.
        </p>
      ) : null}

      <form action={requestPasswordResetAction} className="space-y-3">
        <input type="hidden" name="origin" value={origin} />
        <div className="space-y-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <Button type="submit" className="w-full">
          Send reset link
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
