import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/server'
import { signUpAction } from '../actions'

const ERROR_MESSAGES: Record<string, string> = {
  missing: 'Fill in every field, including your branch.',
  'weak-password': 'Password must be at least 8 characters.',
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? params.error : null

  const supabase = await createClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Pick your branch — you can clock in as soon as you sign up.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p>
        )}
        <form action={signUpAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" name="full_name" required autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch_id">Branch</Label>
            <Select id="branch_id" name="branch_id" required defaultValue="">
              <option value="" disabled>
                Select your branch
              </option>
              {(branches ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" className="w-full">
            Create account
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-primary-strong underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
