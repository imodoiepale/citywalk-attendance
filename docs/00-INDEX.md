# Citywalk Attendance — Documentation Index

**Prepared for:** Citywalk
**Prepared by:** NSAIT
**Last updated:** 2026-08-19

## What this bundle is

The full documentation set for Citywalk Attendance — a signed-in, multi-branch attendance product (clock in/out, leave requests and approvals, a daily-hours calendar, per-branch reports, and role-based access), built as a sibling to `citywalk-delivery-management-system` and linked from the Citywalk Portal Hub. This set follows the same numbered-doc convention as the DMS's own `docs/` folder, scaled to this app's actual size — one product, one Supabase project, no external integrations (WhatsApp, voice, POS) to document.

## Contents

| File | What it covers | Read it if you are |
|---|---|---|
| [`01-PRD.md`](./01-PRD.md) | Problem, roles, scope by phase, functional/non-functional requirements, roadmap | Anyone deciding what to build next |
| [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md) | Repo layout, data model, RLS, security-definer functions, auth flow, routes, testing strategy | An engineer working in the codebase |
| [`03-DESIGN-SPEC.md`](./03-DESIGN-SPEC.md) | Design tokens, the dial, the calendar, component inventory, motion, accessibility, tone | Anyone touching UI |
| [`04-RBAC-AND-PERMISSIONS.md`](./04-RBAC-AND-PERMISSIONS.md) | Roles, the full permission matrix, the self-lockout guard, how to change rights | Whoever administers the app day-to-day |
| [`05-OPEN-QUESTIONS.md`](./05-OPEN-QUESTIONS.md) | Numbered questions for the product owner, with the default currently in force for each | The product owner, before the next phase |
| [`06-GO-LIVE-CHECKLIST.md`](./06-GO-LIVE-CHECKLIST.md) | Provisioning, env vars, first admin, deploy, per-role acceptance walkthrough, sign-off | Whoever is deploying this for the first time |
| [`DECISIONS.md`](./DECISIONS.md) | Engineering decisions and why, including deviations from the obvious default | An engineer asking "why is it built this way" |
| [`RUNBOOK.md`](./RUNBOOK.md) | Day-2 operations: promoting users, editing rights, common support issues, credential rotation, rollback | Whoever supports the app after go-live |

### Code and configuration

| Path | What it is |
|---|---|
| `supabase/migrations/20260819000001_schema.sql` | The full schema: tables, enums, RLS policies, security-definer functions and RPCs |
| `supabase/seed.sql` | Branch seed data and the default `role_permissions` matrix |
| `.env.example` | Required environment variables, with comments |

## The decisions already made

1. This app gets its **own** Supabase project — not shared with the DMS's database.
2. Roles and rights are **database-backed and admin-editable**, not hardcoded — a direct product requirement.
3. Sign-up is **self-service**, collects a branch choice, and accounts are **active immediately** — no approval gate.
4. Sessions are **cookie-based**, not `localStorage` — branch devices may be shared kiosks.
5. The dial's visual language is ported from DepthMe's ritual timer; the calendar's from DepthMe's meditation progress calendar — both re-themed to the Citywalk gold/ink palette, neither pulling in a new animation or calendar library.

## What has been preserved from the original prototype

The very first version of this app was a single-page, `localStorage`-only prototype (dial + manual punch log, no accounts) — see `DECISIONS.md` and `01-PRD.md` §3 for how it evolved. The dial itself, and the visual language it established, carried through unchanged in spirit; the persistence layer underneath it did not (it couldn't — leave approval and cross-branch reporting need a real backend, which `localStorage` fundamentally can't provide).

## What happens next

1. Provision a Supabase project and run the migration + seed — see `06-GO-LIVE-CHECKLIST.md`.
2. Deploy, and update the Citywalk Portal Hub's Attendance card with the real URL.
3. Walk every role through its own screens before calling it live.
4. Work through `05-OPEN-QUESTIONS.md` with the product owner to scope Phase 2b.

*This bundle describes what's built as of 2026-08-19.*

*The Supabase project **is** connected and all six migrations plus the seed are applied to it. The RLS/RBAC claims in these docs are no longer read-only assertions: they are exercised by two suites — a SQL-level one covering the correction workflow and the approval guards, and `scripts/verify-live.mjs`, which signs a throwaway user in through GoTrue and probes the boundaries (impersonation, self role escalation, cross-branch reads, settings writes) over PostgREST before deleting itself. Run it with `npm run verify:live`.*
