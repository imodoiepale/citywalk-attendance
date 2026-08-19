'use client'

import { useTransition } from 'react'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ROLES, ROLE_META, type Role } from '@/lib/rbac-catalog'
import { updateUserRoleAction, toggleUserActiveAction } from '@/lib/admin/actions'
import type { AdminUserRow } from '@/lib/admin/queries'

export default function AdminUserTable({ users }: { users: AdminUserRow[] }) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Name</th>
            <th className="px-4 py-2.5 font-medium">Branch</th>
            <th className="px-4 py-2.5 font-medium">Role</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-2.5">
                <div className="font-medium text-foreground">{u.fullName}</div>
                <div className="text-xs text-muted-foreground">{u.email}</div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{u.branchName}</td>
              <td className="px-4 py-2.5">
                <Select
                  defaultValue={u.role}
                  disabled={isPending}
                  onChange={(e) => {
                    const newRole = e.target.value as Role
                    startTransition(() => {
                      updateUserRoleAction(u.id, newRole)
                    })
                  }}
                  className="h-8 w-40"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_META[r].label}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-4 py-2.5">
                <Button
                  size="sm"
                  variant={u.isActive ? 'outline' : 'default'}
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => {
                      toggleUserActiveAction(u.id, !u.isActive)
                    })
                  }}
                >
                  {u.isActive ? 'Active' : 'Deactivated'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
