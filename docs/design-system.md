# Design System & Brand Identity — Phase 23

## Scope

Phase 23 asked for a review of all three applications' UX and for an
**original temporary brand identity that does not imitate Uber's
visual identity**. This doc covers both: the identity itself, and the
concrete UX work (loading/empty/error states, offline behavior, GPS
permission handling, network failures, accessibility, touch targets,
responsive layouts) done on top of it.

**What this phase found, before changing anything**: every screen in
`apps/passenger-app` and `apps/driver-app`, and every page in
`apps/admin-app`, already converged — independently, across 20+ phases
of separate screen-by-screen work — on the same small color vocabulary:
a warm amber accent, dark neutral backgrounds (two different families,
one per role — see below), and the same red/green/blue triad for
error/success/info everywhere. That consistency was never designed as
a system; it emerged because every phase's own screens reused whatever
"looked right" from the phase before it. Phase 23's job on this front
is formalizing what already existed, not inventing new colors from
scratch — see `packages/design-tokens` for the single source of truth
this phase extracted from that existing convention, and
`packages/design-tokens/src/brand.ts`'s own doc comment for the
byte-for-byte mapping.

## Brand identity

**Name**: **Waypoint** — a temporary Stage 1 codename, not a
trademark, not for commercial use (see the repo root's own Stage 1
scope statement). Referenced in this doc and a couple of
splash/about screens; every app's actual package/bundle identity
(`Rideshare Passenger (Dev)`, `dev.rideshare.passenger`, ...) is
unaffected — changing bundle identifiers has real Expo/App-Store
consequences this stage has no reason to take on for a name that will
change again before any real launch anyway.

**Why this is not Uber's identity** (the spec's explicit constraint):

| | Uber | Waypoint (this project) |
|---|---|---|
| Core palette | Near-monochrome: black and white, one accent (green) used sparingly | A warm amber accent (`#fbbf24`) is the primary, everywhere-visible brand color, not an occasional highlight |
| Backgrounds | Predominantly white/light surfaces | Both consumer-facing apps default to **dark** surfaces |
| Neutrals | One consistent gray scale across every surface | **Two different neutral families** — cool slate for the passenger app, warm stone for the driver app (see below) |
| Typography | A single custom typeface (Uber Move) across every surface | System fonts, a shared numeric type *scale* rather than a custom face — see "Typography" below |
| Logo/mark | A wordmark in a fixed typeface | No fixed logo mark defined this stage — intentionally not yet claiming that level of brand permanence for a Stage 1 placeholder identity |

The result is deliberately not a "reskin" — a screenshot of either app
next to Uber's would not be mistaken for the same product.

## Color language

Formalized in `packages/design-tokens` (`src/brand.ts`,
`src/themes.ts`), consumed via each app's own `src/theme.ts`
(`apps/passenger-app`, `apps/driver-app`) or, for `apps/admin-app`,
via the equivalent Tailwind utility classes plus a small set of CSS
variables in `globals.css` that mirror the same hex values exactly.

- **Brand accent — amber** (`#fbbf24` / Tailwind `amber-400`, `#f59e0b`
  in light mode): every primary action, active state, and the
  "STAGE 1 — DEVELOPMENT BUILD" badge every auth/splash screen already
  carries.
- **Two neutral families, one per consumer app** — not a bug, a
  deliberate differentiator:
  - Passenger app: cool **slate** (`#0f172a` background → `#f8fafc`
    text).
  - Driver app: warm **stone** (`#1c1917` background → `#fafaf9`
    text).
  - Admin app: the same slate family, **light mode** (an operations
    console read during work hours, not a phone-in-hand app).
- **Shared semantic triad, identical everywhere**: danger (red,
  `#f87171`/`#ef4444`), success (green, `#4ade80`/`#22c55e`), info
  (blue, `#60a5fa`/`#38bdf8`). A screenshot of an error state looks
  like an error in any of the three apps without needing to read text
  first.

## Typography

No custom typeface — every app uses the platform's system font
(`system-ui`/San Francisco/Roboto for the RN apps' default, the same
system stack for admin-app's `globals.css`). What *is* now formalized
is a shared numeric **scale** (`packages/design-tokens/src/
typography.ts`): `caption` (12) → `label` (13) → `body` (14) →
`bodyLarge` (16) → `title` (18) → `heading` (24), each screen picking
a role instead of a raw pixel guess. This mirrors what most screens
were already doing informally; formalizing it stops future screens
from drifting to an odd size nobody else uses.

## Spacing, radii, and touch targets

`packages/design-tokens/src/spacing.ts`: a 4px-based scale
(`xs`=4 → `xxl`=32) and a small radius scale, both matching values
already common across existing `StyleSheet.create` calls. New this
phase: `minTouchTarget = 44` — the WCAG 2.5.5 / Apple HIG / Material
Design converged minimum for a comfortable tap target, used as a
`minHeight`/`minWidth` floor (not a fixed size, so it composes with
naturally-larger content) on the interactive elements this phase's
accessibility pass touched.

## UX review — loading / empty / error states

Audited all 20 passenger-app screens and all 20 driver-app screens.
Loading states (`ActivityIndicator`) and error-catch handling
(`ApiClientError` branching → a user-facing message) were already
present on the large majority of screens with any async work — not a
gap this phase needed to invent from scratch. The concrete additions:

Auditing every list-rendering screen found empty states already handled
consistently — `NotificationsScreen`, `SupportScreen`, and driver-app's
`HistoryScreen` all already render a friendly "no ... yet" line; admin-app's
list pages (`passengers`, `drivers`, ...) do the same. The one genuine
finding wasn't a missing empty state — it was two screens
(`RideHistoryScreen`, `RideDetailsScreen`) still showing their original
Phase-3 placeholder text, which by this phase had gone from "honest
placeholder" to actively **misleading**: both blamed "Phase 7" for the
missing data, a phase that finished 15+ phases ago. The real reason is
that no backend endpoint exists for "list this passenger's own past
rides" (there's no `GET /passengers/me/rides` — see Known Limitations).
Fixed the copy to state that honestly instead of re-blaming a
long-completed phase; building the actual endpoint + list UI is a real
feature addition, out of scope for a UX-polish phase.

## Offline behavior & network failures

Previously, a genuine network failure (no connection, DNS failure,
server unreachable) surfaced as a generic `TypeError` that every
screen's `error instanceof ApiClientError ? error.message : 'Something
went wrong...'` branch already caught — technically handled, but with
no way to tell "the server rejected this" from "you're offline" apart.
Phase 23 closes that gap in one place rather than forty:

- `apiClient.ts`'s shared `request()` (both RN apps) now catches a
  failed `fetch()` or an unparseable response and rethrows a
  distinguishable `ApiClientError('NETWORK_ERROR', ...)` with a clear,
  actionable message — every existing screen's catch block benefits
  automatically, with no per-screen changes needed.
- A new `useNetworkStatus` hook (`expo-network`) plus an `OfflineBanner`
  component, mounted near each app's navigation root, proactively shows
  "You're offline" the moment connectivity drops — not just reactively
  on the next failed request.

## GPS permission handling

Already solid before this phase, confirmed unchanged: both
`HomeMapScreen` (passenger) and `locationProvider.ts`/
`DriverHomeMapScreen` (driver) request foreground location permission,
detect denial, and degrade gracefully — a visible banner plus a
generic fallback center/manual-pin-drag for the passenger app, an
"approximate area, no live tracking" banner for the driver app —
rather than a blank map or a silent failure.

## Accessibility

The one category with no prior coverage at all — zero
`accessibilityLabel`/`accessibilityRole` anywhere in either RN app, no
`aria-label` on admin-app's icon-only controls. This phase adds real
labels/roles/hints to the highest-traffic screens in each app
(auth, home map, request-ride flow, incoming-request/lifecycle
actions, ride-complete, and admin-app's primary list/detail pages),
plus the `minTouchTarget` floor described above. Full 100% coverage
across all 60+ screens/pages was judged out of proportion for Stage 1
— see "Known limitations" for exactly what's covered vs. not.

## Responsive layouts (admin-app)

Before this phase, `AdminShell` had zero responsive breakpoints — a
fixed `w-56` sidebar plus a flex-1 content column, and every one of
admin-app's 10 table-heavy pages rendered its `<table>` with no scroll
container. On a narrow viewport a wide table forced the *entire page*
to scroll horizontally, taking the sidebar and header off-screen with
it — the actual "broken," not just "cramped," failure mode. Fixed by
wrapping every one of those 10 tables in `<div className="overflow-x-
auto">`, plus `min-w-0` on the flex column that contains them —
load-bearing, not decorative: without it, a flex item won't shrink
below its content's intrinsic width, so `overflow-x-auto` silently does
nothing and the blowout happens anyway. The header row also gained
`flex-wrap` and hid the admin's email (kept the role badge) below the
`sm` breakpoint, so it degrades instead of clipping.

**What's deliberately still out of scope**: a true mobile navigation
pattern (a collapsible drawer replacing the fixed sidebar) — see Known
Limitations. This app is explicitly an operations console, read during
work hours, not a phone-in-hand consumer app (see "Brand identity"
above); preventing horizontal blowout was the real bug, a full
mobile-first redesign would be disproportionate to Stage 1's scope.

## Known limitations

- **Accessibility coverage is real but partial** — the highest-traffic
  screens in each app got a genuine pass; less-visited screens
  (settings sub-pages, some admin detail views) were not individually
  audited this phase. A full accessibility audit (ideally with a
  screen-reader pass on real devices, which this environment can't
  do) is future work.
- **No custom typeface or logo mark** — a deliberate Stage 1 choice
  (see "Brand identity" above), not an oversight; a real launch would
  want both.
- **`minTouchTarget` is enforced only on the elements this phase's
  accessibility pass touched**, not retrofitted onto every existing
  `Pressable` in the codebase.
- **Offline detection is proactive but not exhaustive** — the
  `OfflineBanner` reflects `expo-network`'s connectivity signal, which
  can occasionally lag real-world connectivity by a beat (a known
  characteristic of OS-level network-state APIs, not a bug in this
  integration).
- **No self-service ride history for passengers.** `RideHistoryScreen`
  and `RideDetailsScreen` remain honest placeholders — there is no
  `GET /passengers/me/rides`-style backend endpoint yet. A passenger
  can still see each ride's outcome right after it completes
  (`RideCompleteScreen`); there's just no historical list/detail view.
  Real feature work (repository query, service, route, tests, client,
  screen), not UX polish — deliberately out of this phase's scope.
- **admin-app has no true mobile navigation.** This phase fixed the
  actual breakage (tables forcing whole-page horizontal scroll — see
  "Responsive layouts" above) but did not build a collapsible-drawer
  sidebar for narrow viewports; the fixed sidebar still consumes real
  width on a phone-sized screen. Consistent with treating admin-app as
  a desktop operations console, not a phone-in-hand app.
