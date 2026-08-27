/**
 * AURAXP design tokens.
 *
 * Dark, minimal, Gen-Z leaning palette: near-black surfaces, a single loud
 * accent (electric lime) plus a secondary accent (violet) for variety.
 * Keep this file the single source of truth for color so screens/components
 * never hardcode hex values inline.
 */

export const colors = {
  background: '#0B0B12',
  surface: '#15151F',
  surfaceAlt: '#1D1D2A',
  surfaceRaised: '#22222F',
  border: '#2A2A38',
  borderStrong: '#3A3A4C',

  textPrimary: '#F5F5FA',
  textSecondary: '#9A9AB0',
  textMuted: '#6C6C82',

  accent: '#C6FF3D', // electric lime — primary CTA / XP highlight
  accentMuted: '#8FBF2E',
  onAccent: '#0B0B12', // text/icon color on top of an accent fill
  secondary: '#B18CFF', // violet/indigo — secondary highlight, challenge/versus moments
  secondaryMuted: '#8465D1',
  danger: '#FF5C7A',
  success: '#3DDC97',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;

export const typography = {
  // Huge bold score numbers (Home "YOUR AURA", ScanResult main score).
  display: { fontSize: 44, fontWeight: '800' as const, letterSpacing: -1 },
  hero: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const },
  subtitle: { fontSize: 16, fontWeight: '600' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
  // Small uppercase section labels ("YOUR AURA", "AURA REPLAY").
  eyebrow: { fontSize: 12, fontWeight: '800' as const, letterSpacing: 1.5 },
};
