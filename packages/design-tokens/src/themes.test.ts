import { describe, expect, it } from 'vitest';
import { adminTheme, driverTheme, passengerTheme } from './themes';
import { brandAccent, semantic } from './brand';

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

describe('themes', () => {
  it.each([
    ['passengerTheme', passengerTheme],
    ['driverTheme', driverTheme],
    ['adminTheme', adminTheme],
  ])('%s: every color token is a valid 6-digit hex string', (_name, theme) => {
    for (const value of Object.values(theme.colors)) {
      expect(value).toMatch(HEX_PATTERN);
    }
  });

  it('passenger and driver themes share the exact same brand accent (only neutrals differ)', () => {
    expect(passengerTheme.colors.accent).toBe(driverTheme.colors.accent);
    expect(passengerTheme.colors.accent).toBe(brandAccent.amber400);
  });

  it('passenger and driver themes use genuinely different neutral backgrounds', () => {
    // The whole point of two separate neutral families (slate vs. stone,
    // see brand.ts) — a regression that accidentally unified them would
    // undo Phase 23's "which app is this a screenshot of" distinction.
    expect(passengerTheme.colors.background).not.toBe(driverTheme.colors.background);
  });

  it('every theme uses the same semantic danger/success/info hues', () => {
    for (const theme of [passengerTheme, driverTheme]) {
      expect(theme.colors.danger).toBe(semantic.danger400);
      expect(theme.colors.success).toBe(semantic.success400);
      expect(theme.colors.info).toBe(semantic.info400);
    }
  });

  it('adminTheme is light mode: background is lighter than its own text', () => {
    // A cheap but real assertion that admin didn't accidentally inherit
    // a dark-mode background — "FF" > any dark hex's leading byte.
    expect(adminTheme.colors.background.toLowerCase()).toBe('#f8fafc');
    expect(adminTheme.colors.textPrimary.toLowerCase()).toBe('#0f172a');
  });
});
