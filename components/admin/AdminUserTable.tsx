'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Search, SquarePen } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ROLES, ROLE_META, type Role } from '@/lib/rbac-catalog'
import { updateUserRoleAction, toggleUserActiveAction } from '@/lib/admin/actions'
import type { AdminUserRow } from '@/lib/admin/queries'

const PAGE_SIZE = 25

export default function AdminUserTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[]
  /** Own row is read-only — see the self-lockout guard in migration 20260820000001. */
  currentUserId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useState('')
  const [branchFilter, setBranchFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(0)

  const branches = useMemo(
    () =>
      Array.from(new Map(users.map((u) => [u.branchId, u.branchName])).entries()).sort((a, b) =>
        a[1].localeCompare(b[1])
      ),
    [users]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => {
      if (needle && !`${user.fullName} ${user.email}`.toLowerCase().includes(needle)) return false
      if (branchFilter !== 'all' && user.branchId !== branchFilter) return false
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (statusFilter === 'active' && !user.isActive) return false
      if (statusFilter === 'inactive' && user.isActive) return false
      return true
    })
  }, [users, query, branchFilter, roleFilter, statusFilter])

  // Clamp rather than reset: narrowing a filter while on page 3 should land on
  // the last page that still has rows, not silently jump to an empty one.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(0)
            }}
            placeholder="Search name or email…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Select
          value={branchFilter}
          onChange={(event) => {
            setBranchFilter(event.target.value)
            setPage(0)
          }}
          className="h-8 text-xs"
        >
          <option value="all">All branches</option>
          {branches.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          value={roleFilter}
          onChange={(event) => {
            setRoleFilter(event.target.value)
            setPage(0)
          }}
          className="h-8 text-xs"
        >
          <option value="all">All roles</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_META[role].label}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value)
            setPage(0)
          }}
          className="h-8 text-xs"
        >
          <option value="all">Any status</option>
          <option value="active">Active only</option>
          <option value="inactive">Deactivated only</option>
        </Select>
      </div>

      <Table containerClassName="rounded-2xl border border-border bg-card shadow-card">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                No users match these filters.
              </TableCell>
            </TableRow>
          ) : (
            visible.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium text-foreground">{user.fullName}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.branchName}</TableCell>
                <TableCell>
                  <Select
                    aria-label={`Role for ${user.fullName}`}
                    defaultValue={user.role}
                    disabled={isPending || user.id === currentUserId}
                    title={
                      user.id === currentUserId
                        ? 'You cannot change your own role'
                        : undefined
                    }
                    onChange={(event) => {
                      const newRole = event.target.value as Role
                      startTransition(() => {
                        updateUserRoleAction(user.id, newRole)
                      })
                    }}
                    className="h-8 w-40 text-xs"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_META[role].label}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  {user.id === currentUserId ? (
                    // Deactivating yourself locks you out of the very screen
                    // that could undo it. The RPC refuses it too; this just
                    // stops the click reading as available.
                    <span
                      title="You cannot deactivate your own account"
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-muted-foreground"
                    >
                      Active — you
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={user.isActive ? 'outline' : 'default'}
                      disabled={isPending}
                      onClick={() => {
                        if (
                          user.isActive &&
                          !window.confirm(
                            `Deactivate ${user.fullName}? They will be signed out and blocked from clocking in until reactivated.`
                          )
                        ) {
                          return
                        }
                        startTransition(() => {
                          toggleUserActiveAction(user.id, !user.isActive)
                        })
                      }}
                    >
                      {user.isActive ? 'Active' : 'Deactivated'}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/admin/users/${user.id}`}
                    aria-label={`Edit ${user.fullName}`}
                    className="inline-flex items-center gap-1 text-xs text-primary-strong hover:underline"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                    Edit
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {filtered.length} of {users.length} users · page {currentPage + 1} of {pageCount}
        </span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= pageCount - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
