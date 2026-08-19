# Design Spec — Citywalk Attendance

Visual/UX detail. Product scope is in [`01-PRD.md`](./01-PRD.md); technical architecture in [`02-SYSTEM-SPEC.md`](./02-SYSTEM-SPEC.md).

## Design principles

1. **The dial is the anchor.** Everything else in the app is in service of "how am I doing on my shift right now" — leave, calendar and reports are secondary screens reached via nav, not competing for the home screen.
2. **State is never colour-only.** The dial's idle/normal/approaching/overtime states, leave status badges, and calendar day buckets all pair colour with text or shape (a label, a number, a ring position) — never colour alone.
3. **One product family.** Colour tokens, radius, and the gold/ink identity are shared verbatim with `citywalk-delivery-management-system` and `CityWalk-Portal-Hub`, so switching between the three reads as one company, not three unrelated builds.
4. **No calendar or animation libraries.** The dial and the calendar are both hand-rolled (SVG + CSS, plain `Date` math) — ported patterns from DepthMe rather than a dependency, keeping the bundle small and the visual language fully under our control.

## Design tokens

Tailwind v4 CSS-first, defined in `app/globals.css` (`:root` for light, `@media (prefers-color-scheme: dark)` for dark, mapped into Tailwind via `@theme inline`):

| Token | Light | Purpose |
|---|---|---|
| `--primary` | `oklch(0.64 0.13 90)` (`#AB8704`) | Primary surface — buttons, active nav, ring fill |
| `--primary-strong` | `oklch(0.53 0.108 90)` (`#846801`) | Primary text/icon glyph — passes contrast where `--primary` as text wouldn't |
| `--brand-gold` | `oklch(0.927 0.195 104)` (`#FDEC06`) | The wordmark yellow — never used as a fill/text colour, only in gradients and the logo itself |
| `--brand-ink` | `oklch(0.16 0.006 250)` (`#0B0D10`) | Near-black the logo sits on; also the icon-tile gradient base |
| `--radius` | `0.75rem` | Card/button corner radius, matching the DMS's "Horizon card" idiom |

Same split-gold rationale as the DMS: `#FDEC06` has too little contrast to ever be a button fill or body text, so `--primary`/`--primary-strong` do the actual UI work while the raw gold stays reserved for logos and gradients.

## Application shell

`components/shell/AppShell.tsx` — left sidebar (`md:` and up) or bottom tab bar (mobile), listing only the routes the signed-in user's permission map actually allows (`navFor()` in `lib/rbac-catalog.ts`). Branch devices are assumed to skew mobile/tablet, hence the bottom-tab-first mobile treatment rather than a hamburger menu.

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
| Ring direction | Unwinds full → empty over a session | **Fills** empty → full as a shift elapses toward 8h |
| Center readout | `M:SS` remaining | Live wall-clock `HH:MM:SS` + "Shift: Xh Ym" |
| Rotating layer | Decorative artwork image, always spinning | Conic-gradient sunburst, only animates while clocked in (signals "actively tracking") |
| Colour | Fixed per "guide" (morning/shadow/vision/night) | Dynamic by state: idle (grey) → normal (gold) → approaching 7h+ (amber) → overtime 8h+ (red, pulsing) |

`--dial-accent-start`/`--dial-accent-end` are `@property`-registered CSS custom properties (same trick DepthMe uses) so the colour cross-fades between states instead of snapping.

## Calendar (`components/calendar/*`)

Ported from DepthMe's `MeditationCalendar.tsx` — the cleaner of its two calendar implementations (`ProgressScreen.tsx` has a similar but more entangled version).

- **Month grid**: hand-rolled `(number | null)[][]` week grid (pad `firstWeekday` nulls, chunk to weeks of 7, pad the trailing row) — no calendar library.
- **Day cell** (`DayCell.tsx`): `aspect-square rounded-lg` tile, 4-step discrete colour bucket by hours worked (`lib/calendar-buckets.ts`: 0h → muted, <4h → pale gold, 4–8h → gold, 8h+ → amber), today = gold ring + dot, `Xh` badge — the same "filled tile, not a per-day ring" idiom DepthMe uses for minutes meditated, just re-bucketed for hours worked and re-coloured to the Citywalk palette (gold/ink instead of purple).
- **Month nav**: query-param links (`?year=&month=`), not client state — the whole `/calendar` page is a Server Component, no client-side fetch hook needed. Next disabled at the current month (can't navigate into the future), same as DepthMe's `MeditationCalendar`.
- **Weekly progress ring** (`WeeklyProgressRing.tsx`): the same `stroke-dasharray`/`-rotate-90` SVG technique as the dial, scaled down, showing hours in the last 7 days against a 40h target.
- **Legend**: Less → 4 swatches → More, plus a "today" swatch — directly reused from DepthMe's heatmap legend pattern.

## Component inventory

Hand-rolled shadcn-style primitives (`cva` + `React.forwardRef` + `cn()`, no Radix, no shadcn CLI — `components/ui/`): `button`, `card`, `badge` (variants: `default`, `secondary`, `outline`, `success`, `warning`, `destructive`), `input`, `label`, `select` (a plain styled native `<select>` — sufficient at this app's scale, no combobox library), `textarea`.

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
