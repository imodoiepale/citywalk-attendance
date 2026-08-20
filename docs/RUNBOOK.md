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
2. Do they already have an open punch somewhere (a forgotten clock-in from yesterday)? The DB enforces one open punch per user — check `punches` for a row with `clock_out_at is null` for that user, and either have them clock out normally or, if it's a genuine stuck/erroneous row, close it manually in the Table Editor (`update punches set clock_out_at = now() where id = '<id>'`). Since Phase 2 there **is** an in-app tool: the user opens that day on their calendar (`/calendar/YYYY-MM-DD`) and requests a correction, which their manager approves at `/attendance/corrections`. Prefer that over hand-editing — it leaves an audit trail; the Table Editor does not.
3. Confirm they're on the right role — `staff` needs `punch.view.own` at `own` or better; if that's been edited down via the permissions matrix, they'll be blocked from *viewing* their punches even though clocking in itself isn't gated by that permission (see [`DECISIONS.md`](./DECISIONS.md) on why punch insert/update check `is_active_user()` directly instead).

## A leave approval isn't showing up for a manager

- Confirm the approver's role actually has `leave.approve.branch` (branch scope) or `leave.approve.org` (org scope) at `/admin/permissions` — this is easy to accidentally edit down.
- Confirm the leave request's `branch_id` matches the approver's `branch_id` (for branch-scoped approvers) — a request filed for someone whose `profiles.branch_id` was changed *after* the request was submitted keeps the branch it had at submission time, so a branch transfer mid-flight can look like a mismatch. This is expected, not a bug.

## Rotating credentials

- **Supabase anon/service-role keys**: rotate in the Supabase dashboard (Project Settings → API), then update the env var everywhere it's set (local `.env.local`, hosting provider). The anon key is public by design (it's shipped to the browser) — rotating it doesn't require notifying anyone, just redeploying.
- **A user's password**: they can self-serve from **Forgot password?** on the sign-in page, which emails a link to `/callback`, which establishes a session and drops them on `/set-password`.
  - This depends on email actually being delivered. The project has **no custom SMTP configured**, so it falls back to Supabase's built-in sender, which is rate-limited to a handful of messages an hour and is not intended for production. Configure SMTP (Authentication → Emails → SMTP Settings) before relying on this.
  - To reset someone without email at all: Supabase Dashboard → Authentication → Users → the account → *Generate link* (recovery), then hand them the link directly. `/callback` accepts both the `token_hash` form those links use and the PKCE `code` form the in-app flow produces.

## Restore / rollback

No automated backup/restore tooling exists beyond whatever your Supabase plan provides (Supabase's own point-in-time recovery on paid tiers, or manual `pg_dump` you set up yourself). Before any destructive change (a manual `UPDATE`/`DELETE` in the Table Editor, a new migration), export the affected table first: Supabase Table Editor → table → Export as CSV.

To roll back a bad migration: there's no down-migration tooling set up — `supabase/migrations/` is append-only today. Fixing a mistake means writing a new corrective migration, not editing or reverting the original file, once it's been applied to a real project.

## Redirect URLs

Auth links only redirect to hosts on the allow list (Authentication → URL
Configuration). `site_url` and `uri_allow_list` currently cover
`http://localhost:3000` and `http://localhost:3101`. **Add the production
domain there before go-live**, or every reset and confirmation link will bounce
users to localhost.

## Applying a migration

`supabase/migrations/` is append-only and applied in filename order. With the
CLI linked to the project:

```
npx supabase db push
```

Applied versions are tracked in `supabase_migrations.schema_migrations`. Note
that `20260819000002` exists purely to add `app_permission` enum values, because
Postgres will not let a new enum value be *used* in the same transaction that
adds it — keep enum additions in their own file.

After any migration touching RLS, RPCs or the permission matrix, run:

```
npm run verify:live
```

It creates a throwaway user, walks signup → clock in → clock out, probes the RLS
boundaries, and deletes the user in a `finally` block. Safe against production.

## Escalation

This is a small internal tool with no on-call rotation defined. For now: the person who ran the go-live checklist is the first point of contact for anything not covered above.
