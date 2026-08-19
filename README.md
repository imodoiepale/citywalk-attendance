# Citywalk Attendance

A signed-in, multi-user attendance PWA for Citywalk branches — clock in/out on a live shift dial (visually inspired by DepthMe's ritual session timer), request and approve leave, a daily-hours calendar, per-branch reports, and role-based access.

Full documentation — product requirements, system architecture, design spec, RBAC, open questions, go-live checklist, decision log, and runbook — lives in [`docs/`](./docs), starting at [`docs/00-INDEX.md`](./docs/00-INDEX.md).

## Getting started

1. **Create a Supabase project** (supabase.com — free tier is enough to start).
2. **Run the migration** against it: in the Supabase SQL Editor, run `supabase/migrations/20260819000001_schema.sql`, then `supabase/seed.sql`. (Or via the CLI: `supabase link`, then `supabase db push`.)
3. **Copy the env template** and fill in your project's values (Project Settings → API):
   ```bash
   cp .env.example .env.local
   ```
4. **Install and run**:
   ```bash
   npm install
   npm run dev
   ```
5. Open [http://localhost:3000](http://localhost:3000), sign up (you'll pick a branch), and you're in.

To make your account an Admin (rather than the default Staff), update your `role` in the `profiles` table directly for your very first account — after that, use `/admin/users` in the app. Full steps: [`docs/06-GO-LIVE-CHECKLIST.md`](./docs/06-GO-LIVE-CHECKLIST.md).

## Stack

Next.js 16 (App Router, forced to webpack — see note below) + TypeScript + Tailwind CSS v4 + shadcn-style hand-rolled primitives + `@supabase/ssr` + `@supabase/supabase-js` + `@ducanh2912/next-pwa`. Design tokens are ported from `citywalk-delivery-management-system` so this app, the DMS, and the Citywalk Portal Hub read as one product family.

`dev`/`build` pass `--webpack` explicitly: Next 16 defaults to Turbopack, which `@ducanh2912/next-pwa`'s service-worker generation doesn't yet support.

## Data & auth

Everything is backed by Postgres via Supabase, scoped with Row Level Security — see [`docs/02-SYSTEM-SPEC.md`](./docs/02-SYSTEM-SPEC.md) for the full data model, and the migration file itself for the RLS policies and RPCs. Sessions are cookie-based (not `localStorage`), since branch devices are often shared kiosks.

## Roles

Staff / Branch Manager / HR-Accounts / Admin — see [`docs/04-RBAC-AND-PERMISSIONS.md`](./docs/04-RBAC-AND-PERMISSIONS.md). What each role can actually do is stored in the `role_permissions` table and editable at `/admin/permissions`, not hardcoded.
