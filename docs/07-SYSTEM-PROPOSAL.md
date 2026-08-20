# System Proposal — Citywalk Attendance

**Status:** For approval · **Prepared for:** Citywalk / Fortis leadership
**Last updated:** 2026-08-20

Product scope is in [`01-PRD.md`](./01-PRD.md); technical architecture in
[`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md); the numbered requirements this
proposal commits to are in [`08-REQUIREMENTS.md`](./08-REQUIREMENTS.md).

---

## 1. The problem

Citywalk runs **40 active branches** across Nairobi, Mombasa, Kisumu, Nakuru,
Eldoret, Thika, Meru, Naivasha and Nanyuki, under five brands (Citywalk, City
Brandz, City Safari, City Fragrance, and shared HQ/Warehouse/Online functions).

Before this system:

- Hours were tracked informally, per branch, in ways that did not reconcile.
- Payroll had no single, defensible source for hours worked.
- A forgotten clock-out was unfixable, so the error simply flowed into pay.
- **36 ZKTeco biometric readers were already installed and generating scans that
  nothing consumed.** The hardware investment was already made and idle.
- Nobody could answer "who approved this?" for a leave decision or a role change.

The cost is not only administrative. Unreconciled hours mean disputes, overtime
that is either unpaid or overpaid, and no audit position if a claim is made.

## 2. What is proposed

One signed-in product, scoped by branch and role, that is the single record of
when Citywalk staff worked.

**Capture** — hours arrive three ways, and all three land in the same record:
manual clock in/out on any device, the existing ZKTeco readers, and (proposed)
AI face cameras. No parallel systems, no rekeying.

**Control** — role-based access, database-enforced, with an editable rights
matrix. Corrections are proposals with an audit trail, never silent edits.

**Reporting** — timesheets per pay period, exportable to styled Excel,
print-ready PDF, or CSV, plus a report builder for anything not anticipated here.

**Accountability** — every privileged action recorded with who, what, before and
after.

## 3. Why this approach

**Reuse the hardware.** The 36 readers stay exactly as they are. The integration
is vendor-agnostic behind one adapter, and supports the readers pushing directly
to us — which matters because they sit on private `192.168.x.x` addresses that
no hosted system can reach to poll. Nothing needs rewiring.

**The database is the enforcement layer, not the app.** Row Level Security means
a staff member cannot read another branch's data even by calling the API
directly, not merely that the screen does not show a link. This is verified by
an automated suite, not asserted.

**Fail toward evidence.** A scan that cannot be matched to a person is queued,
never discarded, and applied retroactively once mapped. A punch is never
rewritten without a record of who changed it and why.

**One product family.** Shares design tokens, branch model and branch codes with
`citywalk-delivery-management-system` and `citywalk-portals-hub`, so the three
read as one company rather than three procurements.

## 4. Scope

**In scope:** attendance capture (manual, biometric, face), leave request and
approval, punch corrections, timesheets and payroll export, per-branch and
org-wide reporting, device estate management and health, role-based access, audit
log, and guided onboarding per role.

**Out of scope:** payroll calculation itself (tax, deductions — this supplies
hours only), broader HR process such as recruitment or performance review, and
any shared database with the DMS. Rota and shift scheduling are deferred.

## 5. Delivered to date

Live against the production Supabase project, with automated verification:

| Capability | State |
|---|---|
| Auth, 40 branches, four roles, editable rights matrix | Live |
| Manual clock in/out, cumulative day timer | Live |
| Leave request, approval table, decision notifications | Live |
| Punch corrections with audit trail | Live |
| Calendar, day detail, org settings | Live |
| Timesheets + Excel / PDF / CSV export | Live |
| ZKTeco ingest (push, webhook, pull) + device health | Live, awaiting device configuration |
| Device, enrollment and unmatched-scan management | Live |
| Guided tours per role, hamburger, breadcrumbs | Live |
| Audit log | Live |
| Report builder with charts | Proposed — §6 |
| AI face cameras | Proposed — §7 |

## 6. Proposed next

**Audit log — now delivered.** Several privileged actions previously recorded no
actor at all; you could not tell who granted a permission. `audit_log` now
captures actor, action, entity and before/after for every privileged operation,
with the actor's name denormalised so history survives that person being deleted,
and a `source` discriminator so machine actions read as machine actions rather
than anonymous users. It is append-only and admin-readable.

**Report builder.** Choose a dataset, grouping, period and visualisation; save it
as a named preset. Includes device-estate reporting: uptime, scans per branch,
unmatched trend.

## 7. AI face cameras

**Proposed model:** staff upload their own photo to their profile, with recorded
consent. It is enrolled to the internally-owned cameras. The camera performs the
matching and returns only a person ID, which flows into the same enrollment
mapping and ingest pipeline the ZKTeco readers already use.

**What this deliberately avoids.** We do not compute or store face templates.
The camera holds them. We store the enrolment photo and a consent record, and
nothing else.

**Obligations we are accepting.** A face photo is biometric personal data under
Kenya's Data Protection Act 2019. This proposal therefore commits to:

- Explicit, recorded, per-person consent with a version and timestamp. No consent
  record, no enrolment — enforced in the database, not by a checkbox.
- Private storage, readable only by the owner and device administrators.
- A working deletion path: revoke → purge the stored photo → deprovision from the
  camera, with an audit entry.
- A stated retention period, configurable, and re-enrolment interval.
- Face cameras on restricted doors (server room, camera room) classified as
  access-control, so they log entry without ever creating a punch.

**Recommendation:** proceed, on the basis above. The alternative — holding
templates ourselves — makes Citywalk a biometric data controller with materially
heavier obligations for no operational gain, since the cameras already do the
matching.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Readers sit on private LANs a hosted app cannot reach | Devices push outward via ADMS; a webhook and an on-premise connector cover the cases where they cannot |
| A reader goes offline and shifts silently vanish | Device health view; offline and never-reported are surfaced, not buried |
| A device replays its buffer after an outage | Every scan carries a scan-derived idempotency key; replays are recorded as duplicates, not double punches |
| Scans arrive for someone not yet mapped | Queued as unmatched, never discarded, and applied retroactively on mapping |
| Face data mishandled | Consent records, private storage, working deletion, no templates held — §7 |
| No SMTP configured; password resets and confirmations will not arrive | **Open. Must be resolved before onboarding staff.** |
| ~300ms round trip to eu-west-1 from Kenya | Reduced to one hop per render; further gain requires a closer region — a migration decision, not a code change |
| An admin locks themselves out | Self-deactivation and last-admin removal refused at the database level |

## 9. What is required from Citywalk

1. **Configure SMTP.** Nobody but the existing admin can currently be onboarded.
2. **Add the production domain** to the authentication redirect allow list.
3. **Point the 36 readers** at the ingest endpoint, or deploy the connector.
4. **Map enrollment numbers to staff** — the one task that cannot be automated,
   because only Citywalk knows which number is which person.
5. **Approve the face-camera consent wording** and retention period before any
   photo is collected.
6. **Decide the reporting cadence** Accounts needs, if pay periods differ from the
   presets provided.

## 10. Success measures

- Every branch's hours reconcile to the same source, with no parallel spreadsheet.
- A pay period closes without manual re-keying.
- A forgotten clock-out is corrected in-app, with a record, inside a day.
- "Who approved this?" is answerable for every decision, immediately.
- No unmatched scan older than one working day.
