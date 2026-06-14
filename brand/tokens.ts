// ASCURE brand tokens — "Ink on Mist" (v2). Canonical reference mirror.
// LIVE source for mobile is apps/mobile/src/theme/index.tsx (light + dark
// palettes, system-aware, persisted). This file documents the palette.

export const ascureTokens = {
  light: {
    // Brand = ink
    primary: '#161A1F',
    primaryStrong: '#2A313B',
    primarySoft: '#DDE2E8',
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
    danger: '#DC2626', success: '#16A34A', warning: '#B45309', info: '#2563EB',
  },
  dark: {
    primary: '#E9ECEF',
    primaryStrong: '#FFFFFF',
    primarySoft: '#1E2630',
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
    danger: '#F87171', success: '#4ADE80', warning: '#F5B544', info: '#60A5FA',
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
