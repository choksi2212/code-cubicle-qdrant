/**
 * Design tokens — the single source of truth for colors, spacing,
 * typography, radius, and elevation.
 *
 * Pattern lifted from the ui-ux-pro-max-cli design-system skill (semantic
 * tokens on top of primitive tokens) and trimmed for React Native.
 * Dark theme is the default; light tokens are placeholders so a future
 * theme switch is one import away.
 *
 * Use ONLY these tokens in screens — no inline hex codes, no hardcoded
 * numbers. If you need a value that isn't here, add it here first.
 */

// ─── Primitive palette ──────────────────────────────────────────────────────
// Indigo-on-warm-black — calmer than the old teal, more "studio product"
// than the typical AI-slop pure-black + neon green.

export const palette = {
  // Neutrals (warm-cool balanced, slight blue cast)
  ink0: '#07080A', // app background
  ink50: '#0B0D11', // surface 1
  ink100: '#12151B', // surface 2 (cards)
  ink150: '#191D24', // surface 3 (elevated)
  ink200: '#22272F', // borders, dividers
  ink300: '#2F3540',
  ink400: '#475061', // disabled
  ink500: '#677289', // placeholder text
  ink600: '#8C97A8', // secondary text
  ink700: '#B4BCCC', // primary text on dark
  ink800: '#E1E5EC', // high-emphasis text
  ink900: '#F7F9FC', // max-contrast text

  // Brand — indigo (primary) + a single warm accent for confirmations
  brand500: '#6366F1', // indigo-500 — primary
  brand400: '#818CF8',
  brand600: '#4F46E5',
  brand200: '#A5B4FC',
  brand50: '#EEF2FF',

  // Semantic
  success500: '#10B981',
  success200: '#6EE7B7',
  warning500: '#F59E0B',
  warning200: '#FCD34D',
  danger500: '#EF4444',
  danger200: '#FCA5A5',
  info500: '#3B82F6',

  // Chromatic accents (used sparingly — progress, photo "warmth" cues)
  rose500: '#F43F5E',
  amber500: '#F59E0B',
  emerald500: '#10B981',
  sky500: '#0EA5E9',
  violet500: '#8B5CF6',
} as const;

// ─── Semantic tokens ────────────────────────────────────────────────────────
// What a screen actually reaches for. Mapping primitive → semantic keeps
// the visual language consistent and lets us re-skin without touching screens.

export const colors = {
  bg: palette.ink0,
  bgElevated: palette.ink50,
  surface: palette.ink100,
  surfaceElevated: palette.ink150,
  border: palette.ink200,
  borderStrong: palette.ink300,

  textPrimary: palette.ink900,
  textSecondary: palette.ink700,
  textTertiary: palette.ink500,
  textDisabled: palette.ink400,
  textOnAccent: '#FFFFFF',
  textInverse: palette.ink0,

  accent: palette.brand500,
  accentHover: palette.brand400,
  accentPressed: palette.brand600,
  accentSubtle: palette.brand50, // wash for chips/badges
  accentSubtleOnDark: 'rgba(99,102,241,0.16)',

  success: palette.success500,
  successSubtle: 'rgba(16,185,129,0.14)',
  warning: palette.warning500,
  warningSubtle: 'rgba(245,158,11,0.14)',
  danger: palette.danger500,
  dangerSubtle: 'rgba(239,68,68,0.14)',
  info: palette.info500,

  // For overlays / scrims
  scrim: 'rgba(0,0,0,0.55)',
  scrimLight: 'rgba(0,0,0,0.25)',

  // Glassy surface for hero / nav elements
  glass: 'rgba(18,21,27,0.72)',
  glassBorder: 'rgba(255,255,255,0.06)',
} as const;

// ─── Spacing — 4pt grid, named semantically ─────────────────────────────────

export const spacing = {
  px: 1,
  '0_5': 2,
  1: 4,
  '1_5': 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

// ─── Radius ──────────────────────────────────────────────────────────────────
// Never sharp. The shape language says "calm product, not toy".

export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  full: 9999,
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────
// React Native only ships a few system weights; we lean on
// fontWeight + letterSpacing + lineHeight for the visual hierarchy instead
// of typeface variation. Inter is the default assumption for any future
// custom-font wiring (ui-styling skill recommends Inter for body, SF for
// display on iOS — we keep system fonts for now).

export const typography = {
  display: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
    letterSpacing: -0.6,
  },
  h1: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  h3: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600' as const,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  bodyStrong: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400' as const,
  },
  smallStrong: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
  },
  numeric: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'] as const,
  },
} as const;

// ─── Elevation — RN doesn't have CSS-style shadows. We hand-tune ────────────
// (Material 3 elevation tokens, calibrated for dark surfaces.)

export const elevation = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

// ─── Motion ──────────────────────────────────────────────────────────────────

export const motion = {
  duration: {
    instant: 100,
    fast: 180,
    base: 240,
    slow: 360,
    slower: 520,
  },
  easing: {
    standard: 'cubic-bezier(0.2, 0.0, 0.0, 1.0)',
    decelerate: 'cubic-bezier(0.0, 0.0, 0.2, 1.0)',
    accelerate: 'cubic-bezier(0.4, 0.0, 1.0, 1.0)',
    spring: { damping: 18, stiffness: 220, mass: 1 },
  },
} as const;

export type Palette = typeof palette;
export type Colors = typeof colors;
export type Spacing = typeof spacing;
export type Radius = typeof radius;
export type Typography = typeof typography;
export type Elevation = typeof elevation;
export type Motion = typeof motion;
