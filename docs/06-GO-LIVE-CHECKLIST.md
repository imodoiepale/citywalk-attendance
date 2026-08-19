# Go-Live Checklist — Citywalk Attendance

Deployment/cutover steps. Nothing here has been done yet — this app has no connected Supabase project and hasn't been deployed. Written so a first deploy is a checklist, not a rediscovery.

## 1. Provision Supabase

- [ ] Create a new Supabase project (a dedicated one — **not** shared with `citywalk-delivery-management-system`; see [`01-PRD.md`](./01-PRD.md) §6 for why).
- [ ] In the SQL Editor (or via `supabase db push` with the CLI), run `supabase/migrations/20260819000001_schema.sql`.
- [ ] Then run `supabase/seed.sql` (branches + default `role_permissions`).
- [ ] Under Authentication settings, decide whether "Confirm email" is on or off — the app handles both (`app/(auth)/actions.ts` checks for a live session after `signUp()` and routes to a "check your email" notice if confirmation is required), but pick one deliberately.

## 2. Environment variables

- [ ] Copy `.env.example` to `.env.local` (local dev) and to your hosting provider's env config (production).
- [ ] Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project Settings → API.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is optional today — nothing in the app's request paths uses it (see `lib/supabase/admin.ts`) — but set it if you plan any out-of-band scripts.

## 3. First admin account

- [ ] Sign up normally through `/signup` (picks a branch like any staff account).
- [ ] In the Supabase Table Editor, find that row in `profiles` and change `role` to `admin` directly. This is the **only** step in the entire app that requires a raw database edit — everything else (including promoting further admins) can be done from `/admin/users` once you have one.

## 4. Deploy

- [ ] Deploy to Vercel (or equivalent) with the env vars from step 2 set.
- [ ] Confirm the PWA manifest and service worker are served correctly (`/manifest.webmanifest`, `/sw.js`) — `next-pwa` is disabled in development, so this is the first real chance to check it.
- [ ] Update the Citywalk Portal Hub's Attendance card (`CityWalk-Portal-Hub/lib/data.ts`) with the real deployed URL and flip `disabled: false`.

## 5. Walk every role through its own screens

Sign up (or promote) one test account per role and confirm, per role, that they see only what [`04-RBAC-AND-PERMISSIONS.md`](./04-RBAC-AND-PERMISSIONS.md) says they should:

- [ ] **Staff**: dial + clock in/out works; can request leave; cannot see `/leave/approvals`, `/reports`, or `/admin/*` (redirected home).
- [ ] **Branch Manager**: everything Staff can do, plus sees `/leave/approvals` scoped to their own branch only, sees `/reports` scoped to their own branch only, can file leave on behalf of someone in their branch (and *not* someone in a different branch).
- [ ] **HR/Accounts**: same as Branch Manager but org-wide — approvals queue and reports show every branch, on-behalf-of picker lists every active user.
- [ ] **Admin**: `/admin/users` lets you change a role and deactivate an account; `/admin/permissions` lets you edit a non-admin role's rights and it takes effect immediately (test by editing `staff`'s `leave.request.own` down to `none` with a second staff test account open in another browser, and confirming that account can no longer submit a leave request).

## 6. Known gaps — read before treating this as "done"

Everything in [`01-PRD.md`](./01-PRD.md) §3's Phase 2b+ list is genuinely not built: no geofencing, no biometric verification, no offline sync, no punch correction workflow, no payroll export, no scheduling, no notifications, no AI features. The Capabilities grid on the dashboard states this honestly to end users — don't let a demo imply more than what's shipped.

No automated test suite exists (see [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md) "Testing strategy") — step 5 above **is** the acceptance test for this release.

## 7. Sign-off

- [ ] Product owner has walked through step 5 personally (not just read this checklist).
- [ ] At least one real branch's staff have signed up and clocked in successfully.
- [ ] Someone other than the person who ran the migration has confirmed they can read `docs/00-INDEX.md` through `06-GO-LIVE-CHECKLIST.md` and understand the system without asking the builder a question.
