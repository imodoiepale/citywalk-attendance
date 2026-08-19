import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { getUserDetail, listBranches } from '@/lib/admin/queries'
import { updateProfileAction } from '@/lib/admin/actions'
import { ROLE_META } from '@/lib/rbac-catalog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requirePermission('admin.users', 'full')
  const { id } = await params

  const [user, branches] = await Promise.all([getUserDetail(id), listBranches()])
  if (!user) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3 w-3" />
          All users
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-foreground sm:text-xl">{user.fullName}</h1>
          <Badge variant={user.isActive ? 'success' : 'destructive'}>
            {user.isActive ? 'Active' : 'Deactivated'}
          </Badge>
          <Badge variant="secondary">{ROLE_META[user.role].label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{user.email}</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form action={updateProfileAction} className="space-y-4">
            <input type="hidden" name="userId" value={user.id} />

            <div className="space-y-1">
              <Label htmlFor="fullName" className="text-sm">
                Full name
              </Label>
              <Input id="fullName" name="fullName" required defaultValue={user.fullName} />
            </div>

            <div className="space-y-1">
              <Label htmlFor="jobTitle" className="text-sm">
                Job title
              </Label>
              <Input
                id="jobTitle"
                name="jobTitle"
                defaultValue={user.jobTitle ?? ''}
                placeholder="e.g. Sales Associate"
              />
              <p className="text-xs text-muted-foreground">Shown as a column on timesheet exports.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="branchId" className="text-sm">
                Branch
              </Label>
              <Select id="branchId" name="branchId" defaultValue={user.branchId}>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Moving someone re-scopes their future punches and leave. Past records keep the branch
                they were filed under.
              </p>
            </div>

            <div className="border-t border-border pt-3">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Role and activation are changed from the{' '}
        <Link href="/admin/users" className="underline">
          user list
        </Link>
        , so each privileged action stays separately auditable.
      </p>
    </div>
  )
}
