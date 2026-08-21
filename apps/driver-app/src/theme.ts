import {
  driverTheme,
  fontSize,
  fontWeight,
  lineHeightRatio,
  minTouchTarget,
  radius,
  spacing,
} from '@rideshare/design-tokens';

/**
 * Phase 23 — the driver app's slice of the shared `@rideshare/
 * design-tokens` brand identity (see docs/design-system.md). See
 * apps/passenger-app/src/theme.ts's own comment for why every screen
 * imports from here rather than the package directly.
 */
export const colors = driverTheme.colors;
export { fontSize, fontWeight, lineHeightRatio, minTouchTarget, radius, spacing };
