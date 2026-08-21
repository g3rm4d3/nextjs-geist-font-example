/**
 * Phase 23 — "Create original temporary brand identity. Do not imitate
 * Uber's visual identity."
 *
 * This is the formalization, not the invention, of a color language
 * every screen in `apps/passenger-app`, `apps/driver-app`, and
 * `apps/admin-app` was *already* using consistently since earlier
 * phases — a warm amber accent (`#fbbf24`) on a dark neutral background,
 * with the same red/green/blue semantic triad everywhere. Every hex
 * value below matches what the screens already render; nothing visually
 * changes by adopting this package — what changes is that it now has
 * one name and one source of truth instead of forty screens each
 * hand-typing the same hex codes. See `docs/design-system.md` for the
 * full rationale, including how this deliberately differs from Uber's
 * own visual identity (Uber: near-monochrome black/white with a single
 * bold sans-serif and a minimal green accent; this: a warm amber accent
 * against *two different* dark neutral families — cool slate for
 * passengers, warm stone for drivers — explicitly not black-and-white,
 * explicitly not Uber's green).
 */

/** Temporary Stage 1 product name — not a real trademark, not for
 * commercial use. Referenced in docs and a couple of splash/auth
 * screens; every app's own package.json/app.config.ts name
 * ("Rideshare Passenger (Dev)", etc.) stays as the literal Expo/Next.js
 * app identity, unaffected. */
export const BRAND_NAME = 'Waypoint';

/** The one color every one of the three apps already shares — the
 * brand's single accent, used for primary actions, active states, and
 * the "STAGE 1 — DEVELOPMENT BUILD" badges already on every auth/splash
 * screen. Deliberately not Uber's black or green. */
export const brandAccent = {
  amber100: '#fef3c7',
  amber400: '#fbbf24',
  amber600: '#f59e0b',
  amber900: '#78350f',
} as const;

/** Shared across all three apps and both dark neutral families below —
 * an app's *neutral* palette differentiates it, but a status is always
 * the same color everywhere, so a screenshot of any app's error state
 * looks unmistakably like an error, not app-specific styling. */
export const semantic = {
  danger400: '#f87171',
  danger500: '#ef4444',
  danger900: '#7f1d1d',
  success400: '#4ade80',
  success500: '#22c55e',
  success900: '#14532d',
  info400: '#60a5fa',
  info300: '#38bdf8',
  violet400: '#a78bfa',
  orange400: '#fb923c',
} as const;

/**
 * Two dark neutral families, one per role — the passenger and driver
 * apps are visually distinct at a glance (useful when screen-sharing or
 * screenshotting during Stage 1 review: "which app is this a screenshot
 * of" should never require reading text) while sharing every other
 * token (`brandAccent`, `semantic`, `typography`, `spacing`). Values
 * match Tailwind's own `slate`/`stone` scales exactly, which is why
 * `admin-app`'s Tailwind utility classes (`slate-900`, `amber-600`, ...)
 * already look identical to these hex values without needing to import
 * this package directly — see docs/design-system.md.
 */
export const slateNeutral = {
  background: '#0f172a',
  surface: '#1e293b',
  surfaceAlt: '#334155',
  textPrimary: '#f8fafc',
  textSecondary: '#cbd5e1',
  textMuted: '#94a3b8',
  placeholder: '#64748b',
} as const;

export const stoneNeutral = {
  background: '#1c1917',
  surface: '#292524',
  surfaceAlt: '#44403c',
  border: '#57534e',
  textPrimary: '#fafaf9',
  textSecondary: '#d6d3d1',
  textMuted: '#a8a29e',
  placeholder: '#78716c',
} as const;

/** admin-app runs light-mode (an operations console, read during work
 * hours, not a phone-in-hand consumer app) — the same slate family,
 * inverted, plus the same brandAccent/semantic tokens Tailwind's own
 * utility classes already resolve to. */
export const slateLight = {
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  border: '#e2e8f0',
} as const;
