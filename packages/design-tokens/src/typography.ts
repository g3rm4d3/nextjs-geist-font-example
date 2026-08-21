/**
 * A small, deliberately restrained type scale — every screen across
 * both React Native apps already converges on roughly these sizes
 * (12/13/14/16/18/24 turn up over and over as ad hoc numbers); this is
 * that same scale, named, so a new screen picks a role instead of
 * guessing a pixel value.
 */
export const fontSize = {
  caption: 12,
  label: 13,
  body: 14,
  bodyLarge: 16,
  title: 18,
  heading: 24,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Multiplied by `fontSize` to get a line height in px — 1.4 is a
 * comfortable reading ratio for body copy; tighter (1.2) suits large
 * headings, which is why `heading`/`title` get their own explicit
 * override at call sites rather than a single global ratio. */
export const lineHeightRatio = 1.4;
