'use client'

import { useTransition } from 'react'
import { Select } from '@/components/ui/select'
import {
  ACCESS_LEVELS,
  PERMISSIONS,
  PERMISSION_META,
  ROLES,
  ROLE_META,
  type AccessLevel,
  type Permission,
  type Role,
} from '@/lib/rbac-catalog'
import { updateRolePermissionAction } from '@/lib/admin/actions'

export default function PermissionMatrixEditor({
  matrix,
}: {
  matrix: Record<Role, Record<Permission, AccessLevel>>
}) {
  const [isPending, startTransition] = useTransition()
  const groups = Array.from(new Set(PERMISSIONS.map((p) => PERMISSION_META[p].group)))

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group} className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-4 py-2 font-medium">
                    {ROLE_META[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.filter((p) => PERMISSION_META[p].group === group).map((permission) => (
                <tr key={permission} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-foreground">{PERMISSION_META[permission].label}</td>
                  {ROLES.map((role) => {
                    const isAdminRow = role === 'admin'
                    return (
                      <td key={role} className="px-4 py-2.5">
                        <Select
                          defaultValue={matrix[role][permission]}
                          disabled={isPending || isAdminRow}
                          title={isAdminRow ? 'Admin always has full access' : undefined}
                          onChange={(e) => {
                            const level = e.target.value as AccessLevel
                            startTransition(() => {
                              updateRolePermissionAction(role, permission, level)
                            })
                          }}
                          className="h-8 w-28"
                        >
                          {ACCESS_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </Select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
