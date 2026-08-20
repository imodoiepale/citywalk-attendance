# Engineering Decision Log — Citywalk Attendance

Deviations, judgment calls, and non-obvious choices made while building this, with the reasoning behind each — so a future reader doesn't have to reverse-engineer *why* from the code alone. Living document; add to it, don't rewrite history.

---

### `--webpack` is forced on `dev`/`build`

Next 16 defaults to Turbopack. `@ducanh2912/next-pwa`'s service-worker generation injects a webpack config and errors out under Turbopack ("This build is using Turbopack, with a `webpack` config and no `turbopack` config"). Rather than dropping PWA support or fighting Turbopack compatibility, `package.json` scripts pass `--webpack` explicitly. Revisit if/when `next-pwa` (or an alternative) supports Turbopack.

### `role_permissions` is a database table, not a TypeScript matrix

`citywalk-delivery-management-system` hardcodes its RBAC matrix in `lib/rbac.ts`. This app does it differently on purpose: the product requirement was rights "fully flexible and customizable," which a hardcoded matrix can't satisfy without a code deploy per change. The tradeoff is more machinery (a table, RLS on it, an admin editor screen, a self-lockout guard) for real runtime flexibility. See [`04-RBAC-AND-PERMISSIONS.md`](./04-RBAC-AND-PERMISSIONS.md).

### `admin`'s access is hardcoded inside `has_min_access()`, not just seeded as `full` rows

Directly follows from the above: if the matrix is editable, someone will eventually misconfigure it. Rather than relying on seeded `full` rows for `admin` (which the matrix editor could still overwrite), the check itself special-cases `admin` before ever consulting the table. No sequence of edits at `/admin/permissions` can lock every admin out — the editor UI reinforces this by disabling the `admin` column entirely rather than pretending it's editable.

### A deactivated account is checked once, centrally, inside `has_min_access()`

Initially, `is_active_user()` existed but nothing actually called it — punch/leave RLS policies only checked ownership, not activation, meaning a deactivated user could still clock in/out or file leave via a direct API call even though the app's `requireUser()` would redirect them in the UI. Fixed by folding `is_active_user()` into `has_min_access()` itself (returns `false` immediately if inactive, before even checking the `admin` bypass), so every policy and RPC that goes through it inherits the check for free. `punches_insert`/`punches_update` don't go through `has_min_access()` at all (punching is a baseline "are you an active employee" action, not an independently revocable permission), so those two policies check `is_active_user()` directly instead.

### `punch.view.own`, `leave.request.own`, and `leave.cancel.own` are real, enforced permissions — not vestigial

First pass wired these into the seed data but never actually checked them anywhere (self-access was allowed unconditionally via `user_id = auth.uid()`), which would have made the admin permissions matrix lie — editing those cells would visibly do nothing. Went back and wired `has_min_access('punch.view.own', 'own')` etc. into the relevant RLS policies and the `cancel_leave_request()` RPC, so HR/Admin genuinely can revoke someone's ability to view their own punches or file/cancel leave (e.g. a suspended employee) without fully deactivating their account (which would also block clock-in). Every cell in the permission matrix now does something real.

### Cookie-based session storage, not `localStorage`

`@supabase/ssr`'s default. Called out explicitly (not just inherited silently) because branch devices are assumed to be shared kiosks in some cases — a `localStorage`-persisted session would leak between staff using the same device after one signs out. This shaped the client setup from the start rather than being retrofitted.

### The PWA runtime-cache catch-all was narrowed before shipping, not after

The original single-page prototype's `next-pwa` config cached *everything* (`NetworkFirst` on `/^https?.*/`) — harmless with no auth. Once real multi-user auth landed, that same rule would cache authenticated HTML/API responses on a shared device, risking one staff member's cached page appearing for the next person post-sign-out. Fixed as part of this build (narrowed to exclude navigation/document requests and any `*.supabase.co` call), not filed as a follow-up ticket, because shipping auth without fixing it would have been shipping a real bug.

### `profiles.branch_id` is a single FK, not a `user_branches` join table

The DMS uses a many-to-many `user_branches` table because DMS staff can genuinely work across multiple branches. This app's product requirement was simpler — "on sign up people choose their branch" (singular) — so a single FK was the right-sized choice. If Q4 in [`05-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md) (regional managers overseeing several branches) comes back "yes," this becomes a real migration, not a config flip.

### Self-service sign-up, active immediately, no approval gate

Explicit product decision (asked directly, answered "active immediately"), not a default assumed by the builder. Recorded here because it's a real security/process tradeoff worth being able to point back to: anyone who signs up can pick any branch and start clocking in right away, with no verification step. See Q2 in [`05-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md).

### Optimistic punch UI via React 19 `useOptimistic`, not a client cache library

The original prototype used `localStorage` + `useSyncExternalStore` for instant-feeling punches with zero network. Moving punches server-side meant losing that unless something compensated — rather than reaching for a client data-fetching library (React Query, SWR), `DashboardClient.tsx` uses `useOptimistic` + `useTransition` directly: the Clock In/Out button updates instantly, the Server Action confirms in the background, and `revalidatePath('/')` reconciles. Keeps the dependency list unchanged from before (no new client-state library) while preserving the UX property that mattered.

### Weekly hours target is a hardcoded constant (`WEEKLY_TARGET_HOURS = 40`)

No policy input existed to base this on. Flagged as Q7 in [`05-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md) rather than guessed at length — 40h/week (5×8h) is the least controversial default, but it's explicitly not derived from any stated Citywalk policy.

### `MonthCalendar` navigates via query-param `<Link>`s, not client state

Considered a client component with its own month-state + `useEffect` fetch, matching how one might port DepthMe's `MeditationCalendar.tsx` most literally (it's a client component with `useState` month nav). Chose a Server Component + query-param links instead: no client JS needed for navigation at all, each month view is a normal server-rendered page (bookmarkable, shareable, works with JS disabled), and it avoids adding a client-side data-fetching pattern that doesn't exist anywhere else in the app.

---

## TODO(spec) — known open

- The reporting date-range UI only exposes a `?days=N` query param today, no date picker — fine for MVP, revisit once Q9 ([`05-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md)) is answered.
- No automated tests exist yet — acceptable at current scale, but the RLS policies in particular deserve a regression suite before this handles real payroll-adjacent data at volume.

## 2026-08-19 — Timesheet exports use TanStack Table v9 + exceljs + pdf-lib

The design spec's "no libraries, hand-roll it" rule was kept for the dial and the
calendar but relaxed for HR's timesheet grid. Hand-rolling sorting, filtering,
pagination and column visibility across a 30-column employee x day table is a
real state machine, and it is not the part of this product worth owning.

- `@tanstack/react-table` v9 for row models only. Markup stays ours
  (`components/ui/table.tsx`, shadcn's Table set hand-rolled). No Radix.
- `exceljs` for `.xlsx` — borders, auto-fit widths, frozen header, autofilter,
  branch group rows, bold totals. CSV cannot express any of that.
- `pdf-lib` for PDF rather than pdfkit or react-pdf: pure JS, no font files or
  native deps, so it bundles cleanly in a Next Route Handler.

All three formats render from one `buildExportTable()` result, so they cannot
drift into showing different numbers.

Known: `exceljs@4.4.0` pulls `uuid@<11.1.1`, flagged moderate (GHSA-w5hq-g745-h8pq
— a bounds check in uuid v3/v5/v6 when a `buf` argument is supplied). exceljs
uses uuid v4 and passes no buffer, so the vulnerable path is not reachable here.
`npm audit fix --force` would downgrade to exceljs@3.4.0, a breaking change and a
worse trade. Revisit when exceljs ships a uuid bump.

## 2026-08-19 — Sign-out asks for confirmation

Branch devices are shared kiosks and the sign-out control sits in the persistent
nav, one mis-tap from the clock-out button. An accidental sign-out mid-shift
costs a re-login and erodes trust in the punch record. `ConfirmDialog` gates it.

## 2026-08-19 — Punch corrections are proposals, never direct edits

A forgotten clock-out was unfixable in-app, which quietly corrupts every
downstream payroll number. The fix could have been "let a manager edit the
punch". It isn't, because an attendance record that can be silently rewritten
is not evidence of anything.

Instead `punch_corrections` holds a *proposal*: the punch keeps its original
values until an approver acts, the original times are snapshotted onto the
correction row, and `decide_punch_correction()` is the only code path in the
system that may change a punch's times. An approver cannot decide a correction
they filed themselves unless they are an admin. A partial unique index allows
at most one pending correction per punch, so two approvers cannot each approve
a different proposal for the same shift.

`punch_id` is nullable: null means "there is no punch, I never clocked in",
and approving inserts one. Same queue, same audit trail, no second workflow.

## 2026-08-19 — Hour targets moved to the database

`DAILY_TARGET_HOURS` / `WEEKLY_TARGET_HOURS` and the 7h "approaching" threshold
were compiled-in constants spread across TimeDial, WeeklyProgressRing and
calendar-buckets. They now live in a singleton `app_settings` row, read through
`lib/settings.ts` (request-cached like `getCurrentUser`).

`lib/targets.ts` survives as the *fallback*, not the source of truth:
`getSettings()` returns it when the settings row cannot be read, so the app
still renders correctly against a database where migration ...0003 has not been
applied yet, rather than 500-ing. Client components take the targets as props
with those same constants as defaults.

Deliberately org-wide, not per-branch — see open question Q7. Per-contract
part-time targets would need a per-profile override and are not modelled.

## 2026-08-19 — admin.branches and admin.settings default to nobody

Both are seeded at `none` for every role except admin. Editing a branch or an
hour target retroactively changes what every historical report means, so they
stay with admin until someone deliberately delegates them through
/admin/permissions. `admin_update_profile` likewise cannot touch `role` or
`is_active` — those keep their own RPCs so each privileged capability stays
separately grantable and separately auditable.

## 2026-08-19 — Clock-out moved to a database RPC

Found by running the live verification script against the real project: a
clock-out issued straight after a clock-in was rejected with a bare 23514
check violation, and the shift silently never closed.

Cause: `clock_in_at` defaults to Postgres `now()`, but `clockOutAction` sent
`new Date().toISOString()` from the Node process. The `punches_out_after_in`
constraint (`clock_out_at > clock_in_at`) was therefore comparing two different
clocks. Any skew between the app server and the database — or simply a fast
in/out — fails.

Fixed by a `clock_out()` RPC that sets the timestamp with `now()`, so both ends
of the comparison come from one clock. It is `security invoker`, so RLS still
restricts a caller to their own punch. `greatest(now(), clock_in_at + 1s)`
covers the degenerate same-instant case.

It returns a null row rather than raising when nothing was open: clocking out
twice is an ordinary mis-tap, and raising made PostgREST answer 500, which
would page someone over a double-tapped button. The app turns the null into
"You have no open shift."

## 2026-08-19 — Inter is self-hosted, not fetched from Google Fonts

`next/font/google` resolves the font at **build** time, so a build machine that
cannot reach `fonts.googleapis.com` fails the entire deploy. That is not
hypothetical — it happened on this network and blocked the build outright.

`next/font/local` now points at the woff2 shipped in
`@fontsource-variable/inter`. Same typeface, still preloaded and self-hosted the
way `next/font/google` would have served it anyway, minus the network
dependency. Builds are hermetic.

## 2026-08-20 — Client components get plain nav data, never NavItem

`AppShell` handed `NavItem[]` straight to `MobileTabBar` and `MobileTopNav`.
`NavItem` carries `match`, a predicate function, and functions cannot cross the
server/client boundary — so React threw "Functions cannot be passed directly to
Client Components" from `DashboardLayout`, which wraps everything. Every
signed-in page 500'd.

`toClientNav()` now projects the serializable half (`href`, `label`, and a
pre-resolved `exact`) before anything reaches a client component. Resolving
`exact` on the server also means the client no longer needs the sibling list to
work out which link is active.

The lesson worth keeping is about the testing, not the types: this survived
because `verify:live` only ever talks to Supabase's API and the page smoke
checks were unauthenticated, so both saw green while every real page was broken.
`npm run verify:pages` closes that gap by rendering each route as a signed-in
admin.

## 2026-08-20 — suppressHydrationWarning stops at <body>

Browser extensions rewrite the document before React hydrates — observed here:
`cz-shortcut-listen` and `contenteditable` on `<body>` from ColorZilla, and
`aria-autocomplete` on password inputs from a password manager. Those
mismatches are unfixable from application code, so `<body>` joins `<html>` in
suppressing them.

It is deliberately not pushed any deeper. Inside the app a hydration mismatch is
our own bug and should stay loud; silencing it on, say, the `Input` primitive
would hide real ones for the sake of an extension.

## 2026-08-20 — An admin cannot deactivate or demote themselves

/admin/users renders each account's status as a toggle button. Clicking your own
row deactivates you, and requireUser() then bounces every request to
/login?error=deactivated — including /admin/users itself. There is no way back
through the UI, because the only account that could undo it is the one that just
locked itself out. This happened to the first real admin on this project, with
no warning and no confirmation step.

Guarded in three places, deliberately:

- `admin_set_active()` refuses `p_user_id = auth.uid() and p_is_active = false`.
- Both `admin_set_active()` and `admin_set_role()` refuse to remove the last
  active admin by any route — an org with no active admin cannot grant anyone
  the rights to fix itself.
- The UI renders your own row read-only and confirms before deactivating anyone
  else.

The database is the real guard; the UI change only stops the click reading as
available. This mirrors the existing self-lockout protection on the permission
matrix, where has_min_access() hardcodes admin to true so the matrix editor
cannot lock every admin out.

## 2026-08-20 — Latency, not query time, was the slow part

Pages felt frozen on navigation. The cause was not missing indexes: measured
round-trip latency from Nairobi to this project (eu-west-1, Ireland) is ~370ms,
and `getCurrentUser()` spent two of those *sequentially* — a profile select
followed by the `my_permissions()` RPC — before any page could begin rendering.

`my_context()` returns profile, branch and the permission map in one call,
cutting ~235ms off every navigation (measured). Route-level `loading.tsx`
skeletons cover the rest: without one, Next holds the previous page on screen
until the new one resolves, which reads as a hang rather than a load.

Indexes were added anyway, and are correct, but they were never the bottleneck —
these tables hold tens of rows. The remaining latency is geographic. If it stays
a problem the fix is the project's region, not the code; note that Mumbai
(ap-south-1) is roughly 2,500km closer to Nairobi than Ireland is.
