# RBAC & Permissions — Citywalk Attendance

Roles, the permission matrix, and how it's enforced. Technical mechanics (RLS, RPCs) are covered in [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md); this doc is the reference for *what each role can actually do* and *how to change it*.

## Why database-backed, not hardcoded

`citywalk-delivery-management-system` defines its roles/permissions as a hardcoded TypeScript matrix (`lib/rbac.ts`). Citywalk Attendance deliberately does it differently: the matrix lives in the `role_permissions` table, editable at `/admin/permissions` with no code deploy. This was a direct product requirement — rights need to be "fully flexible and customizable" — and the app-side `lib/rbac-catalog.ts` holds only labels/metadata for rendering, never the authorization decision itself.

## Roles

| Role | Who | Default reach |
|---|---|---|
| `staff` | Every self-signup account starts here | Own punches, own leave |
| `branch_manager` | Promoted by an Admin | + leave approval and reports for their own branch, filing leave for their branch's staff |
| `hr_accounts` | Promoted by an Admin | Same as `branch_manager`, but organisation-wide (every branch) |
| `admin` | Promoted by an Admin (or the first account, set directly in the database) | Full access everywhere, **hardcoded** — see below |

## Permission catalogue

| Permission | Group | Meaning |
|---|---|---|
| `punch.view.own` | Attendance | See your own punch history |
| `leave.request.own` | Leave | Request leave for yourself |
| `leave.request.on_behalf` | Leave | File a leave request for someone else |
| `leave.approve.branch` | Leave | Approve/reject pending leave within your own branch |
| `leave.approve.org` | Leave | Approve/reject pending leave for any branch |
| `leave.cancel.own` | Leave | Cancel your own pending leave request |
| `report.view.branch` | Reports | View hours/leave reports for your own branch |
| `report.view.org` | Reports | View hours/leave reports across every branch |
| `admin.users` | Admin | Change a user's role, activate/deactivate an account |
| `admin.permissions` | Admin | Edit the `role_permissions` matrix itself |

## Access levels

`none < own < branch < org < full` (ordered — `access_level_rank()` in the migration). A permission check asks "does this role's grant for this permission rank at least as high as the level this action needs?" — e.g. `leave.approve.branch` at `branch` level lets you approve within your branch; `leave.approve.org` at `org` level lets you approve anywhere.

## Default matrix (from `supabase/seed.sql`)

| Permission | staff | branch_manager | hr_accounts | admin |
|---|---|---|---|---|
| `punch.view.own` | own | own | own | full |
| `leave.request.own` | own | own | own | full |
| `leave.cancel.own` | own | own | own | full |
| `leave.request.on_behalf` | — | branch | org | full |
| `leave.approve.branch` | — | branch | — | full |
| `leave.approve.org` | — | — | org | full |
| `report.view.branch` | — | branch | — | full |
| `report.view.org` | — | — | org | full |
| `admin.users` | — | — | — | full |
| `admin.permissions` | — | — | — | full |

Blank cells mean `none` (no row in `role_permissions` — the default).

## The self-lockout guard

`admin`'s access is **hardcoded to `full`** inside `has_min_access()` itself (it never even looks the row up for that role) — not just seeded as data. This means no amount of misconfiguring the matrix at `/admin/permissions` can ever lock every admin out of fixing it. The matrix screen disables editing the `admin` column for exactly this reason (`components/admin/PermissionMatrixEditor.tsx`) — there's nothing to edit there; it's not enforced from the table.

A deactivated account (`is_active = false`) gets **nothing**, regardless of role — checked once, centrally, inside `has_min_access()`, so it applies everywhere (RLS policies and every privileged RPC) without needing to be re-checked in each one.

## Changing rights

1. **Promote/demote a user, or deactivate an account** — `/admin/users` (requires `admin.users`).
2. **Change what a role can do** — `/admin/permissions` (requires `admin.permissions`). Every non-admin cell is a live `<select>`; changes write through the `admin_set_permission()` RPC immediately, no save/publish step.
3. **First admin, before any UI exists to grant it** — after running the migration + seed and creating your first account via sign-up, update that row's `role` to `admin` directly in the `profiles` table (Supabase Table Editor or SQL Editor). Documented in the [`06-GO-LIVE-CHECKLIST.md`](./06-GO-LIVE-CHECKLIST.md).
4. **Adding a new permission entirely** — requires a migration (extend the `app_permission` enum, add `PERMISSION_META` in `lib/rbac-catalog.ts`, wire the actual check into the relevant RLS policy/RPC). Not something the admin UI can do on its own — the permission *catalogue* is code; who holds how much of each permission is data.
