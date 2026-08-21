/** A 4px-based scale — matches the `4`/`8`/`12`/`16`/`24` spacing values
 * already scattered across every screen's `StyleSheet.create` calls. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * WCAG 2.5.5 / Apple HIG / Material Design all converge on 44x44
 * (points/dp) as the minimum comfortable touch target — Phase 23's
 * "touch targets" requirement. `minHeight`/`minWidth` (not a fixed
 * `height`/`width`) so this composes with padding-driven sizing rather
 * than fighting content that's naturally larger.
 */
export const minTouchTarget = 44;
