# Runbook — Citywalk Attendance

Operational reference for after go-live. If you're deploying for the first time, use [`06-GO-LIVE-CHECKLIST.md`](./06-GO-LIVE-CHECKLIST.md) instead — this doc assumes the app is already running.

## Architecture on one page

Next.js (App Router, Server Components + Server Actions) talking directly to one Supabase project (Postgres + Auth + RLS). No queue, no cron, no external integrations, no separate API service — everything is a request/response through Supabase's client libraries. If something's broken, it's almost always one of: (a) an RLS policy denying a query that should succeed, (b) a `security definer` RPC's internal `has_min_access()` check rejecting a caller, or (c) a stale/missing env var. See [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md) for the full picture.

## Promote or demote a user

Normal path: `/admin/users`, change their role in the dropdown. Takes effect on their next request (permissions are loaded fresh per-request via `getCurrentUser()`, not cached client-side).

If `/admin/users` itself is unreachable (e.g. the only admin account got deactivated by mistake): in the Supabase Table Editor, set that user's `profiles.is_active` back to `true` and/or `role` back to `'admin'` directly. This is the one legitimate reason to hand-edit `profiles` after go-live.

## Edit what a role can do

`/admin/permissions`, as an Admin. Changes write immediately via the `admin_set_permission()` RPC — no publish step, no cache to bust. To reset the whole matrix back to defaults, re-run `supabase/seed.sql`'s role_permissions section (it's `on conflict ... do update`, safe to re-run).

## A user reports they can't clock in

Checklist:
1. Is their account active? (`/admin/users` → their row.)
2. Do they already have an open punch somewhere (a forgotten clock-in from yesterday)? The DB enforces one open punch per user — check `punches` for a row with `clock_out_at is null` for that user, and either have them clock out normally or, if it's a genuine stuck/erroneous row, close it manually in the Table Editor (`update punches set clock_out_at = now() where id = '<id>'`). There's no in-app punch-correction tool yet (Phase 2b, see `01-PRD.md`).
3. Confirm they're on the right role — `staff` needs `punch.view.own` at `own` or better; if that's been edited down via the permissions matrix, they'll be blocked from *viewing* their punches even though clocking in itself isn't gated by that permission (see [`DECISIONS.md`](./DECISIONS.md) on why punch insert/update check `is_active_user()` directly instead).

## A leave approval isn't showing up for a manager

- Confirm the approver's role actually has `leave.approve.branch` (branch scope) or `leave.approve.org` (org scope) at `/admin/permissions` — this is easy to accidentally edit down.
- Confirm the leave request's `branch_id` matches the approver's `branch_id` (for branch-scoped approvers) — a request filed for someone whose `profiles.branch_id` was changed *after* the request was submitted keeps the branch it had at submission time, so a branch transfer mid-flight can look like a mismatch. This is expected, not a bug.

## Rotating credentials

- **Supabase anon/service-role keys**: rotate in the Supabase dashboard (Project Settings → API), then update the env var everywhere it's set (local `.env.local`, hosting provider). The anon key is public by design (it's shipped to the browser) — rotating it doesn't require notifying anyone, just redeploying.
- **A user's password**: no forgot-password flow exists in the app UI yet — reset via the Supabase Auth dashboard (Authentication → Users → the account → Send password recovery, or set a new password directly) until one is built.

## Restore / rollback

No automated backup/restore tooling exists beyond whatever your Supabase plan provides (Supabase's own point-in-time recovery on paid tiers, or manual `pg_dump` you set up yourself). Before any destructive change (a manual `UPDATE`/`DELETE` in the Table Editor, a new migration), export the affected table first: Supabase Table Editor → table → Export as CSV.

To roll back a bad migration: there's no down-migration tooling set up — `supabase/migrations/` is append-only today. Fixing a mistake means writing a new corrective migration, not editing or reverting the original file, once it's been applied to a real project.

## Escalation

This is a small internal tool with no on-call rotation defined. For now: the person who ran the go-live checklist is the first point of contact for anything not covered above.
