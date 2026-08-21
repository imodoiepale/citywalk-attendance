# Design Spec — Citywalk Attendance

Visual/UX detail. Product scope is in [`01-PRD.md`](./01-PRD.md); technical architecture in [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md).

## Design principles

1. **The dial is the anchor.** Everything else in the app is in service of "how am I doing on my shift right now" — leave, calendar and reports are secondary screens reached via nav, not competing for the home screen.
2. **State is never colour-only.** The dial's idle/normal/approaching/overtime states, leave status badges, and calendar day buckets all pair colour with text or shape (a label, a number, a ring position) — never colour alone.
3. **One product family.** Colour tokens, radius, and the gold/ink identity are shared verbatim with `citywalk-delivery-management-system` and `CityWalk-Portal-Hub`, so switching between the three reads as one company, not three unrelated builds.
4. **No calendar or animation libraries.** The dial and the calendar are both hand-rolled (SVG + CSS, plain `Date` math) — ported patterns from DepthMe rather than a dependency, keeping the bundle small and the visual language fully under our control. **Exception (2026-08-19):** data-dense HR tables use `@tanstack/react-table` v9 for sorting/filtering/pagination/column visibility. Hand-rolling that state machine for a 30-column timesheet was not worth it; the markup is still ours (`components/ui/table.tsx`), so the visual language is unchanged — only the row-model logic is borrowed. No Radix, still no shadcn CLI.
5. **Don't make people scroll for the primary action.** The dial was scaled down (`--dial-size`) specifically so the Clock In button and today's punch log sit above the fold on a phone; tables cap their own height and paginate rather than growing the page.

## Design tokens

Ported **verbatim from `citywalk-portals-hub`** (`app/globals.css`) so the two
apps read as one product. The hub is Tailwind v3 with a `tailwind.config.ts`;
this app is v4 CSS-first, so the *values* are shared but the plumbing is not —
tokens are registered in `@theme inline`, not a config file.

Authored **dark-first**, matching the hub: `.dark` holds the dark palette and
`:root:not(.dark)` the light one.

| Token | Dark | Light | Purpose |
|---|---|---|---|
| `--background` | `#070809` | `#f2f1ed` | Page ground (ivory in light, near-black in dark) |
| `--sidebar` | `#08090a` | `#f7f6f2` | Sidebar surface, distinct from both page and card |
| `--card` / `--card-soft` | `#101214` / `#121416` | `#fbfaf7` / `#f7f6f2` | Cards are a vertical gradient between the two |
| `--card-hover` | `#15181a` | `#ffffff` | Hover surface for nav rows and menu items |
| `--primary` | `#ffd000` | `#d7a900` | Gold. Brighter in dark, deeper in light, for contrast on each ground |
| `--primary-surface` | `rgba(255,208,0,.1)` | `#fbf3d6` | Active-nav tint and focus glow |
| `--border` / `--border-strong` | 8% / 13% white | 7% / 12% ink | Hairlines; `-strong` for interactive edges |
| `--radius` | `0.875rem` | | Base radius; `xs .5` → `xl 1.375rem` |
| `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | | Every transition uses it |

**Dark mode is class-based, not a media query**, via `@custom-variant dark
(&:where(.dark, .dark *))`. A bare `prefers-color-scheme` rule cannot be
overridden by the user, so a manual toggle is impossible with it; `next-themes`
resolves `system` to an explicit class before paint instead.

One trap worth recording: `:root` and `.dark` have the **same specificity**, so
a light block written as `:root, :root:not(.dark)` silently beats `.dark` on
source order and the page renders light while the dark class is applied. The
light block is `:root:not(.dark)` only — which still matches when no class is
set, so the no-JS default is light.

## Theming

`components/theme-provider.tsx` wraps `next-themes` with the hub's exact
configuration: `attribute="class"`, `defaultTheme="dark"`, `enableSystem`,
`disableTransitionOnChange`. `components/shell/ThemeToggle.tsx` is the sun/moon
crossfade from the hub's `TopActions`.

The toggle reads `resolvedTheme` only inside its click handler. The icons
themselves are swapped by the `dark:` variant in CSS, so the server-rendered
markup is already correct and no mounted-flag guard is needed.

## Application shell

`components/shell/AppShell.tsx` — a 232px sidebar at `lg` and up (same width as
the Portal Hub, so switching between the two apps does not shift the content
column), plus a sticky 56px top bar at every size carrying the page title, the
theme toggle and the account menu.

The sidebar breakpoint is `lg`, not `md`: at `md` the sidebar plus a timesheet's
day columns left nothing readable.

- **Nav rows** (`NavLink.tsx`, sidebar variant) use the hub's `NavItem`
  treatment — `h-10 rounded-[11px] text-[13px]`, and an active row is a gold
  *surface* with a hairline border and inset glow (`bg-primary-surface`,
  `border-primary/20`, `shadow-selected`), not a solid fill.
- **Account menu** (`UserMenu.tsx`) is a dropdown with the avatar, name, email,
  role badge and branch, plus links to the profile and sign-out. It closes on
  outside-click and Escape — on a shared kiosk, leaving someone's name and
  branch on screen for the next person is the failure mode worth avoiding.
- **Mobile** keeps the bottom tab bar (four destinations plus a *More* sheet,
  `env(safe-area-inset-bottom)` padding). The separate scrolling top nav row was
  removed: it duplicated the bottom bar and cost a band of vertical space on
  exactly the devices with least of it.
- **Page title** (`PageTitle.tsx`) is derived from the route rather than passed
  down, so a new page cannot forget to set it — worst case is the generic
  fallback, never a stale title from the previous page.

## Auth pages

`app/(auth)/layout.tsx` is a split layout: the Portal Hub's own Attendance card
artwork (`public/hero-attendance.png`) fills the left half above `lg` under a
bottom-up scrim, with the form on the right. Arriving here from the hub's
Attendance card therefore lands on the same image. Below `lg` the artwork is
dropped entirely — on a branch phone the form should own the screen.

## The dial (`components/TimeDial.tsx` + `components/clock-dial.css`)

Structurally ported from DepthMe's ritual session timer (`DepthMe/src/components/screens/RitualSessionScreen.tsx`) — a layered circular composition, 100% CSS/SVG:

```
breathing halo (::before, blurred gradient ring)
  -> ambient glow
    -> SVG progress ring (track + aura + glow + crisp stroke, stacked)
      -> rotating sunburst (conic-gradient — stands in for DepthMe's rotating artwork disc)
        -> radial overlay (depth)
          -> glass disc
            -> 12 hour tick marks (rotate + translate, one every 30deg)
              -> center content (live HH:MM:SS, "Shift: Xh Ym")
```

Reworked from a meditation countdown into a live shift clock:

| | DepthMe (source) | Citywalk Attendance |
|---|---|---|
| Ring direction | Unwinds full → empty over a session | **Fills** empty → full as the *day's total* elapses toward 8h — it holds its position across a lunch break instead of resetting |
| Center readout | `M:SS` remaining | Live wall-clock `HH:MM:SS` + "Today: Xh Ym" (day total) + "This session: Xh Ym" while clocked in |
| Rotating layer | Decorative artwork image, always spinning | Conic-gradient sunburst, only animates while clocked in (signals "actively tracking") |
| Colour | Fixed per "guide" (morning/shadow/vision/night) | Dynamic by state: idle (grey) → normal (gold) → approaching 7h+ (amber) → overtime 8h+ (red, pulsing) |

`--dial-accent-start`/`--dial-accent-end` are `@property`-registered CSS custom properties (same trick DepthMe uses) so the colour cross-fades between states instead of snapping.

## Calendar (`components/calendar/*`)

Ported from DepthMe's `MeditationCalendar.tsx` — the cleaner of its two calendar implementations (`ProgressScreen.tsx` has a similar but more entangled version).

- **Month grid**: hand-rolled `(number | null)[][]` week grid (pad `firstWeekday` nulls, chunk to weeks of 7, pad the trailing row) — no calendar library.
- **Day cell** (`DayCell.tsx`): a neutral `rounded-xl` tile — day number top-left, hours below it, and a thin bar showing progress towards the daily target (capped at 100%, so a full bar reads as "target met"). Today is a filled gold disc behind the number rather than a ring around the tile. Approved leave is a gold dot, top-right.
  - The old 4-step colour heatmap (`lib/calendar-buckets.ts`, ported from DepthMe) **has been removed**. Tinting the whole tile meant the hours figure had to sit on a background of unpredictable darkness, and the tile carried no sense of how the day compared with its target — a bar says both, and says it in one accent colour.
  - `aspect-square` now applies **only below `lg`**. A square cell in a seven-column grid ties its height to the viewport's *width*, which on a wide monitor made the month roughly twice as tall as the screen. Above `lg` the six grid rows divide the available height instead, so the month always fits exactly.
- **Month nav**: query-param links (`?year=&month=`), not client state — the whole `/calendar` page is a Server Component, no client-side fetch hook needed. Next disabled at the current month (can't navigate into the future), same as DepthMe's `MeditationCalendar`.
- **Weekly progress ring** (`WeeklyProgressRing.tsx`): the same `stroke-dasharray`/`-rotate-90` SVG technique as the dial, scaled down, showing hours in the last 7 days against a 40h target.
- **Legend** (`Legend.tsx`): today, approved leave, and the target bar. The Less → More swatch scale went with the heatmap; a legend for a number the reader can already read is noise.
- **Day detail**: a day opens as a slide-in sheet over the grid (right on desktop, bottom sheet on mobile) via a parallel `@sheet` slot plus an intercepting route, while a hard load of `/calendar/[date]` still renders the full page. Both render the same `DayDetail` Server Component — necessary, not merely tidy, since every query it makes is `server-only` and a client panel could not fetch them.

## Component inventory

Hand-rolled shadcn-style primitives (`cva` + `React.forwardRef` + `cn()`, no Radix, no shadcn CLI — `components/ui/`): `button`, `card`, `badge` (variants: `default`, `secondary`, `outline`, `success`, `warning`, `destructive`), `input`, `label`, `select` (a plain styled native `<select>` — sufficient at this app's scale, no combobox library), `textarea`, `table` (shadcn's Table/Header/Body/Footer/Row/Head/Cell set, bordered by default — HR reads these as ledgers), `confirm-dialog` (small modal with Escape-to-close and scroll lock; used for the sign-out confirmation, since branch devices are shared and an accidental logout costs real time).

Domain components live under `components/{calendar,leave,reports,admin,shell}/` — see [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md)'s repository layout for the full list.

## Motion

- Dial breathing/glow keyframes run on a shared ~9s cycle, matching DepthMe's synchronized inhale/exhale feel.
- `stroke-dashoffset` transitions on both rings (dial + weekly ring) at ~600–850ms, easing the second-by-second tick into continuous motion.
- `prefers-reduced-motion: reduce` collapses all of the above to near-zero duration (see `clock-dial.css`).

## Accessibility

- Every state that uses colour also has a text or shape signal (dial caption text, leave status badge label, calendar day number contrast, today's dot indicator).
- Buttons disable and show no stray focus traps while a Server Action is pending (`isPending` threaded through `ClockInOutCard`, `AdminUserTable`, `PermissionMatrixEditor`).
- Tables use semantic `<table>`/`<th>`/`<td>`, not divs, for reports and admin screens.

## Content & tone

Plain, operational language — no marketing register. Empty states say what's missing ("No punches recorded yet today", "Nothing here yet"), not a cute illustration-and-quip. Error messages name the actual problem ("You already have an open shift", "You don't have permission to file leave for someone else") rather than a generic "Something went wrong" wherever the failure mode is known.
