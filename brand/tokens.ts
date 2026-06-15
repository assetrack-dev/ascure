// ASCURE brand tokens — "Ink on Mist" (v2). Canonical reference mirror.
// LIVE source for mobile is apps/mobile/src/theme/index.tsx (light + dark
// palettes, system-aware, persisted). This file documents the palette.

export const ascureTokens = {
  light: {
    // Brand accent = electric blue
    primary: '#2563EB',
    primaryStrong: '#1D4ED8',
    primarySoft: '#DBEAFE',
    // Surfaces (mist)
    background: '#E9ECEF',
    card: '#FFFFFF',
    surfaceMuted: '#F4F6F8',
    surfacePressed: '#ECEEF1',
    border: '#D7DCE2',
    borderStrong: '#C5CCD4',
    textPrimary: '#161A1F',
    textSecondary: '#566373',
    textMuted: '#828E9C',
    textOnPrimary: '#F7F8FA',
    // Status — functional
    danger: '#DC2626', success: '#16A34A', warning: '#B45309', info: '#0284C7',
  },
  dark: {
    primary: '#3B82F6',
    primaryStrong: '#60A5FA',
    primarySoft: '#18233A',
    background: '#0E1116',
    card: '#181D24',
    surfaceMuted: '#11151A',
    surfacePressed: '#222932',
    border: '#262D36',
    borderStrong: '#3A434F',
    textPrimary: '#E9ECEF',
    textSecondary: '#9AA4B0',
    textMuted: '#66717F',
    textOnPrimary: '#11151A',
    danger: '#F87171', success: '#4ADE80', warning: '#F5B544', info: '#38BDF8',
  },
  // Dark "chrome" surfaces (drawer/map panels) — dark in BOTH modes
  chrome: { surface: '#11151A', panel: '#1B212A', onChrome: '#E9ECEF', onChromeMuted: '#9AA4B0', accent: '#E9ECEF' },
  fonts: {
    display: 'SpaceGrotesk_700Bold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_500Medium',
  },
  radius: { card: 14, control: 10, pill: 999 },
  spacing: { screen: 16, section: 12, card: 12 },
} as const;
