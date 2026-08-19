# Open Questions — Citywalk Attendance

Numbered questions for the product owner, grouped by topic, each with the default currently in force (i.e. what the app does today in the absence of an answer).

## A. Devices & access

**Q1.** Does each branch get its own shared kiosk device, or does every staff member punch in from their own phone?
*Default in force:* the app assumes either — sessions are cookie-based specifically so a shared device is safe (no session leaking between staff), but this hasn't been validated against a real kiosk deployment.

**Q2.** Should self-service sign-up require any verification that the person actually works at the branch they select (e.g. a company email domain check, an invite code), or is branch selection alone sufficient at this scale?
*Default in force:* no verification — anyone can sign up and pick any branch, active immediately (explicit product decision made 2026-08-19).

## B. Roles & rights

**Q3.** Who should hold `hr_accounts` in practice — a single central person, or one per department (HR vs. Accounts split)? The current model treats "HR" and "Accounts" as one role with identical org-wide rights.
*Default in force:* one combined `hr_accounts` role.

**Q4.** Should there be an intermediate role between `branch_manager` and `hr_accounts` — e.g. a regional manager overseeing several but not all branches? The current model is binary: your own branch, or every branch.
*Default in force:* not modeled. Adding it would need a `user_branches`-style many-to-many table (like the DMS uses) instead of the current single `branch_id` on `profiles`.

## C. Leave policy

**Q5.** Is there an annual leave *allowance* per person (e.g. 21 days/year) that the app should track and warn against, or is leave purely request-and-approve with no balance tracking?
*Default in force:* no balance tracking — any date range can be requested; nothing stops someone requesting more days than policy allows.

**Q6.** Should overlapping leave requests within the same branch be flagged to the approver (e.g. "3 other staff already off this week")?
*Default in force:* not flagged — the approvals queue shows requests independently.

## D. Hours & targets

**Q7.** Is the 40-hour weekly target on the calendar's progress ring (`WEEKLY_TARGET_HOURS` in `components/calendar/WeeklyProgressRing.tsx`) uniform across all branches and staff, or should it vary (e.g. part-time contracts)?
*Default in force:* a single hardcoded constant, same for everyone.

**Q8.** Should there be a maximum shift length the system warns about or blocks (beyond the visual "overtime" colour on the dial, which is purely informational today)?
*Default in force:* no hard limit — the dial turns red past 8h but never blocks a clock-out or a further clock-in.

## E. Reporting

**Q9.** What's the actual reporting cadence Accounts needs — is a rolling "last N days" filter (today's implementation) sufficient, or do they need fixed pay-period boundaries (e.g. 1st–15th, 16th–end of month)?
*Default in force:* rolling N-day window, `N` chosen via a query param, defaulting to 30.

**Q10.** Does Accounts need to export report data (CSV/Excel), or is on-screen viewing enough for now?
*Default in force:* on-screen only — see FR16 in the PRD (payroll export, Phase 2b).

## F. Brand & domains

**Q11.** What's the eventual production domain for this app (mirroring `citywalk-dms.vercel.app` for the DMS)? The Portal Hub's Attendance card currently points at a placeholder `citywalk-attendance.vercel.app`.
*Default in force:* placeholder URL, card marked disabled/WIP until a real deployment exists.

## Assumptions currently in force

- One Supabase project per app (this app's project is separate from the DMS's — see [`01-PRD.md`](./01-PRD.md) §6).
- Africa/Nairobi is the only timezone in play (no multi-timezone staff).
- "Active immediately" sign-up (no admin approval gate) was a direct decision, not a default guess — see [`DECISIONS.md`](./DECISIONS.md).
