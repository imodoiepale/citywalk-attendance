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
