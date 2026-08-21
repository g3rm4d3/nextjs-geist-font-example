import { brandAccent, semantic, slateLight, slateNeutral, stoneNeutral } from './brand';

export interface AppTheme {
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    accent: string;
    accentStrong: string;
    warningBg: string;
    warningBgStrong: string;
    danger: string;
    dangerStrong: string;
    dangerBg: string;
    success: string;
    successStrong: string;
    successBg: string;
    info: string;
  };
}

/** apps/passenger-app's theme — cool slate neutrals. */
export const passengerTheme: AppTheme = {
  colors: {
    background: slateNeutral.background,
    surface: slateNeutral.surface,
    surfaceAlt: slateNeutral.surfaceAlt,
    textPrimary: slateNeutral.textPrimary,
    textSecondary: slateNeutral.textSecondary,
    textMuted: slateNeutral.textMuted,
    border: slateNeutral.surfaceAlt,
    accent: brandAccent.amber400,
    accentStrong: brandAccent.amber600,
    warningBg: brandAccent.amber100,
    warningBgStrong: brandAccent.amber900,
    danger: semantic.danger400,
    dangerStrong: semantic.danger500,
    dangerBg: semantic.danger900,
    success: semantic.success400,
    successStrong: semantic.success500,
    successBg: semantic.success900,
    info: semantic.info400,
  },
};

/** apps/driver-app's theme — warm stone neutrals, same accent/semantic
 * tokens as passengerTheme. See brand.ts's own comment for why the two
 * apps deliberately don't share a neutral family. */
export const driverTheme: AppTheme = {
  colors: {
    background: stoneNeutral.background,
    surface: stoneNeutral.surface,
    surfaceAlt: stoneNeutral.surfaceAlt,
    textPrimary: stoneNeutral.textPrimary,
    textSecondary: stoneNeutral.textSecondary,
    textMuted: stoneNeutral.textMuted,
    border: stoneNeutral.border,
    accent: brandAccent.amber400,
    accentStrong: brandAccent.amber600,
    warningBg: brandAccent.amber100,
    warningBgStrong: brandAccent.amber900,
    danger: semantic.danger400,
    dangerStrong: semantic.danger500,
    dangerBg: semantic.danger900,
    success: semantic.success400,
    successStrong: semantic.success500,
    successBg: semantic.success900,
    info: semantic.info400,
  },
};

/** apps/admin-app's theme — light mode. admin-app renders with Tailwind
 * utility classes (`slate-900`, `amber-600`, ...) rather than importing
 * this object directly, but every one of those classes resolves to
 * exactly these hex values — see docs/design-system.md. Exported mainly
 * so a test can assert the two never drift apart. */
export const adminTheme: AppTheme = {
  colors: {
    background: slateLight.background,
    surface: slateLight.surface,
    surfaceAlt: slateLight.surfaceAlt,
    textPrimary: slateLight.textPrimary,
    textSecondary: slateLight.textSecondary,
    textMuted: slateLight.textMuted,
    border: slateLight.border,
    accent: brandAccent.amber600,
    accentStrong: brandAccent.amber900,
    warningBg: brandAccent.amber100,
    warningBgStrong: brandAccent.amber900,
    danger: semantic.danger500,
    dangerStrong: semantic.danger900,
    dangerBg: '#fef2f2',
    success: semantic.success500,
    successStrong: semantic.success900,
    successBg: '#f0fdf4',
    info: semantic.info400,
  },
};
