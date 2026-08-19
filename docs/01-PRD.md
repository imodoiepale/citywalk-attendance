# Citywalk Attendance — Product Requirements Document

**Status:** Draft · Phase 2a shipped (backend, auth, RBAC, leave, calendar, reports)
**Owner:** Citywalk / NSAIT
**Last updated:** 2026-08-19

---

## 1. Problem & Goals

Citywalk branches (Citywalk, City Brandz, City Safari, City Fragrance) had no shared way to record when staff start and end a shift, request leave, or see hours across branches. Hours were tracked informally per branch, which made payroll, overtime, and coverage reporting slow and error-prone.

**Goal:** one signed-in product, scoped by branch and role, where staff clock in/out and request leave, managers and HR/Accounts approve and report on it, and admins control who can do what — visually built around a live shift dial, the same way `citywalk-delivery-management-system` already standardised dispatch and delivery tracking.

**Non-goals (for this PRD):** payroll calculation rules (tax, deductions), broader HR policy, or POS/dispatch integration — referenced as future integration points only.

## 2. Users & Roles

| Role | Rights |
|---|---|
| **Staff** | Clock in/out, request their own leave, cancel their own pending request. |
| **Branch Manager** | Staff rights, plus: file leave for someone in their branch, approve/reject leave for their branch, view reports for their branch. |
| **HR / Accounts** | Staff rights, plus: file and approve leave for *any* branch, view reports across every branch. |
| **Admin** | Full access everywhere, including managing user roles/activation and editing the rights matrix itself. |

Roles and rights are **database-backed and admin-editable**, not hardcoded in the app — see [`04-RBAC-AND-PERMISSIONS.md`](./04-RBAC-AND-PERMISSIONS.md) for the full matrix and how it's enforced.

## 3. Scope

### Phase 1 (superseded)
The original single-page, `localStorage`-only prototype (dial + manual punch log, no accounts). Fully replaced by Phase 2a below; nothing from Phase 1 remains client-only.

### Phase 2a — shipped in this build
- Email/password sign-up with branch selection; accounts are active immediately.
- Real, multi-user backend (Supabase: Postgres + Auth + RLS) — punches, leave requests, and role rights all live server-side, scoped by Row Level Security, not just app-layer checks. See [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md).
- The dial + manual clock in/out (from Phase 1), now backed by the signed-in user's actual punch history instead of a single device's `localStorage`.
- **Leave management**: request leave (Annual / Sick / Compassionate / Unpaid / Other); a Branch Manager or HR/Accounts can file leave *on behalf of* someone else; an approvals queue (branch- or org-scoped) with approve/reject and an optional decision note; self-cancel a pending request.
- **Calendar & daily hours**: a month view of hours worked per day (DepthMe "Progress" calendar pattern, ported to the Citywalk gold/ink palette), plus a weekly hero progress ring against a 40h/week target. See [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md).
- **Reports**: hours worked and approved leave, broken down by branch (or org-wide for HR/Accounts), gated by permission.
- **RBAC**: four roles, a real permission matrix editable at `/admin/permissions`, and a `/admin/users` screen to change someone's role or deactivate their account.
- A persistent nav shell (sidebar on desktop, bottom tabs on mobile) replacing the old single page.

### Phase 2b+ — Work in Progress
Tracked in the app's Capabilities grid (`components/CapabilitiesGrid.tsx`) and in [`08-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md):
- Geofenced / location-verified punches (branch-radius check).
- Biometric verification (face or fingerprint) to prevent buddy-punching.
- Offline-first punching with background sync once connectivity returns.
- **Punch correction & approval** — a manager reviewing/editing a missed or wrong punch. (Distinct from leave approval, which is live: this is about fixing *punches*, not leave.)
- Payroll export (feeds the eventual Payroll module referenced in the Citywalk Portal Hub).
- Shift scheduling & rota, with actual-vs-scheduled comparison.
- Push notifications/reminders for forgotten punches.
- **AI Assistant** — anomaly detection, natural-language timesheet queries, smart shift suggestions. Not implemented, not wired to any model.

## 4. Functional Requirements

| # | Requirement | Phase |
|---|---|---|
| FR1 | A new user signs up with name, email, password, and their branch; the account is active immediately. | 2a |
| FR2 | User can clock in, starting a live elapsed-time counter; only one open punch per user (DB-enforced). | 2a |
| FR3 | User can clock out, closing the current punch and logging duration. | 2a |
| FR4 | Today's punches are listed with in/out time and computed duration, fetched from the backend. | 2a |
| FR5 | The dial visually communicates approaching (7h+) and overtime (8h+) states. | 2a |
| FR6 | A user can request leave (type, date range, reason); a Branch Manager/HR-Accounts can file it for someone else instead. | 2a |
| FR7 | A Branch Manager sees and can approve/reject pending leave for their branch; HR/Accounts sees and can approve/reject pending leave for any branch. | 2a |
| FR8 | A requester (or whoever filed it) can cancel their own pending leave request. | 2a |
| FR9 | A calendar view shows hours worked per day for a given month, with month navigation. | 2a |
| FR10 | A weekly progress ring shows hours worked in the last 7 days against a 40h target. | 2a |
| FR11 | A branch/org report shows total hours, active staff, and approved leave by type, for a date range. | 2a |
| FR12 | An Admin can change a user's role or deactivate their account. | 2a |
| FR13 | An Admin can edit what each role is allowed to do, per permission, without a code change. | 2a |
| FR14 | A punch is rejected (or flagged) if the device is outside the branch geofence. | 2b |
| FR15 | A manager can view, correct, and approve/reject a flagged or missed punch. | 2b |
| FR16 | Approved hours can be exported for a payroll run, per branch and pay period. | 2b |
| FR17 | The system detects anomalous patterns (e.g. identical in/out times across staff, punches with no matching schedule) and flags them for review. | 3 (AI) |

## 5. Non-Functional Requirements

- **Timezone:** Africa/Nairobi (EAT), a fixed UTC+3 offset with no DST.
- **Session storage:** cookie-based, not `localStorage` — branch devices are often shared kiosks.
- **PWA caching:** navigation/document requests and Supabase API calls are excluded from the service worker cache, to avoid leaking one user's session to the next person on a shared device.
- **Privacy:** location and biometric data (Phase 2b) are sensitive — collect only what's needed for verification, never store raw biometric templates, and give staff visibility into what's recorded about them.
- **Accessibility:** dial and controls respect `prefers-reduced-motion`; all state is also conveyed in text (not colour alone).
- **PWA:** installable, works from a home-screen icon on shared branch devices.

Full technical detail (schema, RLS, routes, auth) is in [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md); visual/UX detail is in [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md).

## 6. Integration Points

- **Citywalk Portal Hub** — the Attendance card links here once deployed; today it is disabled/WIP in the hub until this app ships to a stable URL.
- **citywalk-delivery-management-system** — shares the branch/sub-brand model (Citywalk, City Brandz, City Safari, City Fragrance) and the same design tokens; a future Payroll module would likely live alongside it. This app's Supabase project is intentionally **separate** from the DMS's — not a shared database.

## 7. Milestones / Roadmap

1. **Phase 1 (superseded):** local-only clock-in/out prototype with the dial UI.
2. **Phase 2a (done):** real backend, auth + branch sign-up, RBAC, leave requests/approvals, calendar, reports, admin.
3. **Phase 2b:** punch correction/approval, geofencing, offline sync, payroll export.
4. **Phase 2c:** scheduling/rota, push notifications.
5. **Phase 3:** AI Assistant (anomaly detection, NL queries, smart scheduling).

## 8. Out of Scope

- Payroll calculation itself (tax, deductions) — this module only supplies hours.
- Broader HR policy (onboarding/offboarding workflows, performance reviews).
- A shared database with `citywalk-delivery-management-system` — the two apps stay on separate Supabase projects.

---

See [`00-INDEX.md`](./00-INDEX.md) for the full documentation set.
