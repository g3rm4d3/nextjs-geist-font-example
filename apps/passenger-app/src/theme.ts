import {
  fontSize,
  fontWeight,
  lineHeightRatio,
  minTouchTarget,
  passengerTheme,
  radius,
  spacing,
} from '@rideshare/design-tokens';

/**
 * Phase 23 — the passenger app's slice of the shared `@rideshare/
 * design-tokens` brand identity (see docs/design-system.md). Screens
 * import from here rather than the package directly so nothing has to
 * remember which of `passengerTheme`/`driverTheme`/`adminTheme` is
 * "this app's" — a copy-pasted screen that imports the wrong app's
 * theme by name would be a real, easy-to-miss bug this indirection
 * rules out entirely.
 */
export const colors = passengerTheme.colors;
export { fontSize, fontWeight, lineHeightRatio, minTouchTarget, radius, spacing };
