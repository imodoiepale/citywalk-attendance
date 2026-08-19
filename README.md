# Citywalk Attendance

A signed-in, multi-user attendance PWA for Citywalk branches — clock in/out on a live shift dial (visually inspired by DepthMe's ritual session timer), request and approve leave, a daily-hours calendar, per-branch reports, and role-based access.

Full scope, phasing and the roadmap (geofencing, biometrics, payroll sync, scheduling, AI anomaly detection) are documented in [`docs/prd.md`](./docs/prd.md).

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

To make your account an Admin/Branch Manager/HR-Accounts (rather than the default Staff), update your `role` in the `profiles` table directly for your very first account — after that, use `/admin/users` in the app.

## Stack

Next.js 16 (App Router, forced to webpack — see note below) + TypeScript + Tailwind CSS v4 + shadcn-style hand-rolled primitives + `@supabase/ssr` + `@supabase/supabase-js` + `@ducanh2912/next-pwa`. Design tokens are ported from `citywalk-delivery-management-system` so this app, the DMS, and the Citywalk Portal Hub read as one product family.

`dev`/`build` pass `--webpack` explicitly: Next 16 defaults to Turbopack, which `@ducanh2912/next-pwa`'s service-worker generation doesn't yet support.

## Data & auth

Everything is backed by Postgres via Supabase, scoped with Row Level Security — see `docs/prd.md` §6 for the full data model, and the migration file itself for the RLS policies and RPCs. Sessions are cookie-based (not `localStorage`), since branch devices are often shared kiosks.

## Roles

Staff / Branch Manager / HR-Accounts / Admin — see `docs/prd.md` §2. What each role can actually do is stored in the `role_permissions` table and editable at `/admin/permissions`, not hardcoded.
