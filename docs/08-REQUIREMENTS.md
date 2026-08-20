# Requirements — Citywalk Attendance

**Last updated:** 2026-08-20

Numbered, testable requirements. Each carries a status and, where one exists, the
automated check that proves it. Proposal context is in
[`07-SYSTEM-PROPOSAL.md`](./07-SYSTEM-PROPOSAL.md); product narrative in
[`01-PRD.md`](./01-PRD.md).

**Status key:** ✅ live and verified · 🟡 live, not automatically verified ·
📋 specified, not built · ⛔ blocked

**Verification key:**
`P` = `npm run verify:pages` · `L` = `npm run verify:live` ·
`B` = `npm run verify:biometric` · `T` = `npm run verify:timesheet` ·
`S` = SQL suite · `M` = manual

---

## A. Attendance capture

| # | Requirement | Status | Check |
|---|---|---|---|
| A1 | A signed-in user can clock in, starting a live counter; the database permits only one open punch per user. | ✅ | L, S |
| A2 | A user can clock out; the closing timestamp comes from the database clock, never the app server's. | ✅ | L |
| A3 | The dial shows **cumulative hours worked today**, ticking every second. Clocking out and back in continues the total rather than restarting. | ✅ | M |
| A4 | Clocking out with no open shift is refused with a plain message, not a silent success or a server error. | ✅ | L |
| A5 | A shift that began the previous day still shows as open after midnight. | ✅ | M |
| A6 | The current date and Nairobi wall clock are shown once, above the dial — never duplicated inside it. | ✅ | M |
| A7 | All times are computed in Africa/Nairobi regardless of device timezone. | ✅ | M |
| A8 | A punch records the branch at punch time, so a later transfer does not rewrite history. | ✅ | S |

## B. Biometric devices

| # | Requirement | Status | Check |
|---|---|---|---|
| B1 | A scan at an attendance reader opens or closes that person's shift with no human action. | ✅ | B |
| B2 | Direction comes from the device's configured role (`in` / `out`), or toggles for combined readers. | ✅ | B |
| B3 | Re-sending the same scan **must not** create a second punch. A reader replaying its buffer after an outage is normal. | ✅ | B |
| B4 | A scan at an **access-control** reader (server room, camera room) is recorded but **never** creates a punch. | ✅ | B |
| B5 | A scan for an unmapped enrollment number is queued as unmatched, never discarded. | ✅ | B |
| B6 | Mapping an enrollment number retroactively applies that person's queued scans. | ✅ | B |
| B7 | Unsigned or wrongly-signed ingest payloads are rejected. | ✅ | B |
| B8 | Devices may push directly (ZKTeco ADMS), be pushed to by a server (webhook), or be polled — all behind one adapter. | ✅ | B |
| B9 | Device health distinguishes online, not-seen-recently, offline, never-reported and disabled. | ✅ | B |
| B10 | An attendance device cannot be saved without a branch; an access device can. | ✅ | M |
| B11 | Devices are identified by serial number, which survives renaming and IP reassignment. | ✅ | B |

## C. Leave

| # | Requirement | Status | Check |
|---|---|---|---|
| C1 | A user can request leave without leaving the page they are on. | ✅ | P |
| C2 | A manager or HR can file leave on someone else's behalf, within their scope. | ✅ | S |
| C3 | Approvals are a table with tabs for pending, approved, rejected and cancelled, each showing its count. | ✅ | P |
| C4 | Approvals support search, per-column sort, branch and type filters with counts, and column visibility. | ✅ | M |
| C5 | A decision reaches the requester as a toast the next time they open the app. | ✅ | S |
| C6 | An approval triggers a celebration, suppressed under `prefers-reduced-motion`. | ✅ | M |
| C7 | A decision is announced exactly once; re-running acknowledgement is a no-op. | ✅ | S |
| C8 | One user cannot acknowledge another's decision. | ✅ | S |
| C9 | A requester can cancel their own pending request. | ✅ | S |
| C10 | Leave balances and entitlement tracking. | 📋 | — |

## D. Corrections

| # | Requirement | Status | Check |
|---|---|---|---|
| D1 | Staff can request a correction to a wrong or missing punch, with a reason. | ✅ | S |
| D2 | A correction is a **proposal**; the punch keeps its original values until approved. | ✅ | S |
| D3 | Original values are snapshotted, so the trail survives the punch being rewritten. | ✅ | S |
| D4 | An approver cannot decide a correction they filed themselves, unless they are an admin. | ✅ | S |
| D5 | At most one pending correction per punch. | ✅ | S |
| D6 | Approving a missing-punch correction creates the punch. | ✅ | S |
| D7 | A decided correction cannot be decided again. | ✅ | S |

## E. Access control

| # | Requirement | Status | Check |
|---|---|---|---|
| E1 | Four roles: Staff, Branch Manager, HR/Accounts, Admin. | ✅ | L |
| E2 | Rights are database-backed and editable at `/admin/permissions` without a deploy. | ✅ | S |
| E3 | Every table has Row Level Security. Hiding UI is not the control. | ✅ | L |
| E4 | A user cannot escalate their own role. | ✅ | L |
| E5 | A user cannot read another branch's staff, punches or leave. | ✅ | L |
| E6 | A user cannot record a punch as somebody else. | ✅ | L |
| E7 | An admin cannot deactivate or demote themselves. | ✅ | S |
| E8 | The last active admin cannot be removed by any route. | ✅ | S |
| E9 | A deactivated account is refused everywhere, checked once in `has_min_access`. | ✅ | S |

## F. Reporting and export

| # | Requirement | Status | Check |
|---|---|---|---|
| F1 | Hours and approved leave by branch, over a date range. | ✅ | P |
| F2 | A timesheet grid of employee × day, with days worked, overtime and totals. | ✅ | P |
| F3 | Export to styled Excel (borders, auto-fit, frozen header, branch groups, totals). | ✅ | M |
| F4 | Export to print-ready PDF and to raw CSV; all three match the on-screen filters. | ✅ | M |
| F5 | Fixed pay periods (1st–15th, 16th–end) and rolling windows. | ✅ | M |
| F6 | Branch managers export their own branch only, enforced server-side. | ✅ | M |
| F7 | Timesheet columns roll up to **day, week (Monday-first), month, quarter or year**; totals must be identical at every granularity. | 📋 | — |
| F8 | Month and year pickers. | 📋 | — |
| F9 | Overtime follows the configured daily target. *(Was a defect: it read a compiled-in constant, so changing the target moved the dial and calendar but not payroll's column. Fixed and now covered by a test that changes the target and re-reads the rendered page.)* | ✅ | T |
| F10 | A report builder: choose dataset, grouping, period and chart type; save as a preset. | 📋 | — |
| F11 | Device-estate reporting: uptime, scans per branch, unmatched trend. | 📋 | — |

## G. Audit

| # | Requirement | Status | Check |
|---|---|---|---|
| G1 | Every privileged action records actor, action, entity, and before/after. | 📋 | — |
| G2 | The actor's name is denormalised, so history survives that person's deletion. | 📋 | — |
| G3 | Device-originated actions record `source = device` with no actor, not an anonymous user. | 📋 | — |
| G4 | The audit log is searchable and filterable by entity, actor and date. | 📋 | — |
| G5 | Leave and correction decisions already carry actor and timestamp. | ✅ | S |

## H. Navigation, onboarding and accessibility

| # | Requirement | Status | Check |
|---|---|---|---|
| H1 | Breadcrumbs on every screen; segments without a page render as text, not links. | ✅ | P |
| H2 | A hamburger drawer below `lg` containing every destination. | ✅ | P |
| H3 | Bottom tabs for the four most-used screens, clear of the iOS home indicator. | ✅ | M |
| H4 | A guided tour per **route and role**, targeting only elements that role can see. | ✅ | M |
| H5 | Managers, HR and admins get the staff clock steps first — they clock in too. | ✅ | M |
| H6 | A help button on every screen replays that screen's tour, always. | ✅ | M |
| H7 | Tour progress is per person, not per browser: two people on one shared device each get their own walkthrough. | ✅ | S |
| H8 | Light and dark themes, manually switchable, following the system by default. | ✅ | M |
| H9 | State is never conveyed by colour alone. | 🟡 | M |
| H10 | Motion respects `prefers-reduced-motion`. | ✅ | M |
| H11 | Installable as a PWA; sessions are cookie-based so a shared device does not leak between users. | ✅ | M |
| H12 | Signing out asks for confirmation. | ✅ | M |

## I. Face recognition (proposed)

| # | Requirement | Status | Check |
|---|---|---|---|
| I1 | Staff upload their own enrolment photo from their profile. | 📋 | — |
| I2 | Consent is a stored record with timestamp and version. **No consent record, no enrolment** — enforced in the database. | 📋 | — |
| I3 | Photos are stored privately, readable only by the owner and device administrators. | 📋 | — |
| I4 | **No face templates are ever computed or stored by this system.** The camera holds them and returns only a matched person ID. | 📋 | — |
| I5 | Revocation purges the stored photo, deprovisions the camera enrolment, and writes an audit entry. | 📋 | — |
| I6 | A configurable retention period and re-enrolment interval. | 📋 | — |
| I7 | A match below the configured confidence threshold is not treated as an identification. | 📋 | — |
| I8 | Face cameras reuse the device model, including purpose — a camera on a restricted door logs access without clocking anyone in. | 📋 | — |
| I9 | An enrolment roster showing who has a face on file and who does not. | 📋 | — |

## J. Non-functional

| # | Requirement | Status | Check |
|---|---|---|---|
| J1 | Africa/Nairobi throughout; fixed UTC+3, no DST. | ✅ | S |
| J2 | The build must not depend on network access at build time. | ✅ | M |
| J3 | Migrations are append-only and tracked; enum additions live in their own migration. | ✅ | M |
| J4 | Ingest is authenticated by signature or token; unset secrets fail closed. | ✅ | B |
| J5 | Every authenticated route renders for a signed-in admin, and unknown routes render a branded 404. | ✅ | P |
| J6 | Email delivery for confirmations and password resets. **Blocked: no SMTP configured.** | ⛔ | — |
| J7 | Production domain in the auth redirect allow list. **Blocked.** | ⛔ | — |

---

## Open blockers

| # | Blocker | Consequence |
|---|---|---|
| J6 | No SMTP | Nobody but the existing admin can be onboarded |
| J7 | Redirect allow list is localhost-only | Every auth link will bounce users to localhost after deploy |

Both are Citywalk-side configuration, not code.
