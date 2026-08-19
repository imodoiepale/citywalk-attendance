# System Spec — Citywalk Attendance

Technical architecture: repo layout, data model, RLS, routes, auth flow, and testing strategy. Product scope lives in [`01-PRD.md`](./01-PRD.md); UI/UX detail in [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md); roles/rights in [`04-RBAC-AND-PERMISSIONS.md`](./04-RBAC-AND-PERMISSIONS.md).

## Architecture

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4, backed by a single Supabase project (Postgres + Auth + Row Level Security). Server Components read via the Supabase server client and mutations go through Server Actions calling Supabase directly or via RPC. The one Route Handler is `/api/reports/timesheet`, which exists because a file download needs to set `Content-Type`/`Content-Disposition` on a binary body — something a Server Action can't do. `@ducanh2912/next-pwa` wraps the build for offline-tolerant installability.

`dev`/`build` are pinned to `--webpack` (see `package.json`) because Next 16 defaults to Turbopack, and `@ducanh2912/next-pwa`'s service-worker generation depends on the webpack compiler.

## Repository layout

```
app/
  (auth)/            login, signup, sign-out — public route group
  (dashboard)/        everything behind requireUser() — dial, calendar, leave, reports, admin
  globals.css          Citywalk design tokens (Tailwind v4 @theme inline)
  proxy.ts              Next 16's middleware.ts equivalent — session refresh + route gating
  manifest.ts           PWA manifest route
components/
  ui/                  hand-rolled shadcn-style primitives (button, card, badge, input, select, ...)
  shell/               AppShell, NavLink, MobileTabBar, UserMenu — the nav shell
  calendar/            MonthCalendar, DayCell, WeeklyProgressRing, Legend
  leave/               LeaveRequestForm, LeaveRequestList, DecisionButtons
  reports/             HoursByBranchTable, LeaveSummaryTable, TimesheetTable (TanStack v9), TimesheetToolbar
  admin/               AdminUserTable, PermissionMatrixEditor
  TimeDial.tsx          the dial — shows the day's cumulative worked time, not the current punch
  TodaySummary.tsx       today/week/leave stat strip under the clock card
  DashboardClient.tsx    owns optimistic punch state, ties dial + clock card + summary together
lib/
  supabase/            client.ts (browser), server.ts (Server Components/Actions), admin.ts (service role, unused today), session.ts (proxy helper)
  auth.ts               getCurrentUser() / requireUser() / requirePermission()
  rbac-catalog.ts        Role/Permission/AccessLevel types + labels (metadata only, not the authorization check)
  punches/              queries.ts, actions.ts
  leave/                queries.ts, actions.ts
  reports/analytics.ts
  reports/timesheets.ts   employee x day grid; the single source of truth for exported numbers
  reports/periods.ts      pay-period presets (this/last month, 1st-15th, 16th-end, rolling N)
  reports/export/         shape.ts (shared flattening) + csv.ts / xlsx.ts (exceljs) / pdf.ts (pdf-lib)
  admin/                queries.ts, actions.ts
  timezone.ts            Africa/Nairobi (fixed UTC+3) date arithmetic
  targets.ts             daily/weekly hour targets and dial thresholds, in one place
  calendar-buckets.ts     hours -> colour bucket for the calendar heatmap
  useShiftClock.ts        shared client 1s tick; accumulates the day's punches for the dial
supabase/
  migrations/20260819000001_schema.sql   full schema, RLS, RPCs
  seed.sql                                branches + default role_permissions matrix
```

## Data model

Full DDL in `supabase/migrations/20260819000001_schema.sql`; seed data in `supabase/seed.sql`.

```
branches           id, code, name, brand, town, is_active
profiles           id (= auth.users.id), full_name, email, role, branch_id, job_title, is_active
punches            id, user_id, branch_id, clock_in_at, clock_out_at, method
                   — unique index on (user_id) where clock_out_at is null: DB-enforced, only one open punch
leave_requests     id, requester_id, filed_by_id, branch_id, type, start_date, end_date,
                   reason, status, decided_by_id, decided_at, decision_note
role_permissions   role, permission, access_level   -- see 04-RBAC-AND-PERMISSIONS.md
```

Design choices worth noting:
- `profiles.branch_id` is a single FK, not a many-to-many join table — one branch per user is enough for this app (unlike the DMS, where staff can be attached to multiple branches).
- `punches.branch_id` is denormalized (captured at punch time) so a later branch transfer doesn't rewrite history.
- `leave_requests` distinguishes `requester_id` (who the leave is *for*) from `filed_by_id` (who *submitted* it) — the same person for self-service requests, different people when a manager/HR files on someone's behalf.

## Security-definer functions

Declared in the migration, section 3–4:

| Function | Purpose |
|---|---|
| `my_role()`, `my_branch_id()`, `is_active_user()` | Read the caller's own profile fields without recursing through RLS. |
| `access_level_rank(level)` | Orders `access_level` (`none < own < branch < org < full`) for comparisons. |
| `has_min_access(permission, min_level)` | The single authorization check. Returns `false` immediately if the caller is deactivated; `true` unconditionally for `admin`; otherwise looks up `role_permissions`. Every RLS policy and every privileged RPC calls through this one function. |
| `my_permissions()` | Lets a signed-in user read their own role's permission set (used by `getCurrentUser()`) without loosening RLS on `role_permissions` itself. |
| `admin_set_role`, `admin_set_active`, `admin_set_permission`, `decide_leave_request`, `cancel_leave_request` | Privileged writes. Each checks `has_min_access()` internally, so RLS policies on the underlying tables can stay simple "self row only" rules. |

## Row Level Security

Every table has RLS enabled (migration section 6). Pattern: a self-row clause (`user_id = auth.uid()`, gated by the matching `own`-level permission), an admin bypass (`my_role() = 'admin'`), and a branch/org clause for report or approval access via `has_min_access()`. Writes to `profiles.role`/`branch_id`/`is_active`, `leave_requests.status`, and `role_permissions` never happen via a raw client `UPDATE` — only through the RPCs above, so a compromised or buggy client request can't self-escalate.

`branches` is readable by **anonymous** requests (`using (true)`) — required so the sign-up page's branch dropdown works before a session exists.

## Auth flow

1. `app/(auth)/signup` collects name/email/password/branch, calls `supabase.auth.signUp()` with `full_name`/`branch_id` in the user metadata.
2. The `handle_new_auth_user()` trigger on `auth.users` reads that metadata and inserts the matching `profiles` row (`role = 'staff'`, `is_active = true`).
3. `app/proxy.ts` (Next 16's `middleware.ts` rename) calls `updateSession()` on every request, which does a verified `supabase.auth.getUser()` call and redirects unauthenticated requests to `/login?next=<path>` for anything outside a public-prefix allowlist.
4. `app/(dashboard)/layout.tsx` calls `requireUser()`, which also checks `is_active` and redirects deactivated accounts back to `/login?error=deactivated`.
5. `requirePermission(permission, minLevel)` builds on `requireUser()` for pages that need more than "signed in" — e.g. `/reports`, `/admin/users`.

Hiding UI is **not** the security boundary — RLS is. `requireUser()`/`requirePermission()` only avoid rendering a door the user can't actually open; every table-level check above is enforced independently of what the app renders.

## Routes

| Route | Access |
|---|---|
| `/login`, `/signup` | Public |
| `/` | Any active user — the dial + clock in/out |
| `/calendar` | Any active user — own daily hours |
| `/leave` | Any active user — own leave requests |
| `/leave/new` | Any active user (on-behalf-of picker shown only with `leave.request.on_behalf`) |
| `/leave/approvals` | `leave.approve.branch` or `leave.approve.org` |
| `/reports` | `report.view.branch` or `report.view.org` |
| `/reports/timesheets` | `report.view.branch` (own branch, pinned) or `report.view.org` (any/all branches) |
| `/api/reports/timesheet` | Same as above. `?branch=` is ignored for branch-scoped users — they are pinned to their own branch server-side, and RLS enforces it independently. |
| `/admin/users` | `admin.users` |
| `/admin/permissions` | `admin.permissions` |

## Testing strategy

No automated test suite exists yet (matches the app's current scale — this is a small internal tool, not worth a full CI pipeline before real usage validates the shape of the schema). Verification today is: `npm run build` and `npm run lint` clean; manual read-through of the migration for RLS/RPC consistency (each policy and RPC checked against what it's supposed to prevent). Before go-live, at minimum: manually walk each role through its own screens (see [`06-GO-LIVE-CHECKLIST.md`](./06-GO-LIVE-CHECKLIST.md)), and confirm a `staff` role genuinely cannot read another branch's punches/leave via direct API calls (not just that the UI doesn't show a link to them).
