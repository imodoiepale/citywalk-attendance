'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { createEmployeeAction, type CreateEmployeeFormState } from '@/lib/admin/actions'
import type { BranchRow } from '@/lib/admin/queries'
import { ROLE_META, ROLES, type Role } from '@/lib/rbac-catalog'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create employee'}</Button>
}

const INITIAL_STATE: CreateEmployeeFormState = {}

export default function CreateEmployeeForm({ branches }: { branches: BranchRow[] }) {
  const [state, action] = useActionState(createEmployeeAction, INITIAL_STATE)

  return (
    <div className="space-y-4">
      {state.error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">{state.error}</CardContent>
        </Card>
      ) : null}

      {state.tempPassword ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium text-foreground">
              Temporary password: <span className="font-mono">{state.tempPassword}</span>
            </p>
            <p className="text-muted-foreground">
              Give this to the employee now. It is only shown once, and they will be forced to set
              a new password on first sign-in.
            </p>
            {state.profileId ? (
              <Link href={`/admin/users/${state.profileId}`} className="text-primary-strong underline">
                Open employee profile
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branchId">Branch</Label>
            <Select id="branchId" name="branchId" required defaultValue="">
              <option value="" disabled>
                Select branch
              </option>
              {branches.filter((branch) => branch.isActive).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select id="role" name="role" required defaultValue={'staff' satisfies Role}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_META[role].label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jobTitle">Job title</Label>
          <Input id="jobTitle" name="jobTitle" />
        </div>
        <SubmitButton />
      </form>
    </div>
  )
}
