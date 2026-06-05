// ASCURE brand tokens — canonical source for the mobile app (apps/mobile).
// Direction: "operational instrument". Shaped to drop into apps/mobile/src/ui.tsx `uiTheme`.
// Fonts require loading via expo-font (e.g. @expo-google-fonts/space-grotesk, /inter, /jetbrains-mono).

export const ascureTokens = {
  colors: {
    // Brand
    primary: '#0F766E',        // teal-700 — primary on light surfaces
    primaryStrong: '#115E59',  // pressed/hover
    primaryBright: '#14B8A6',  // teal-500 — primary on dark surfaces
    primarySoft: '#CCFBF1',
    accent: '#06B6D4',         // cyan signal accent (light)
    accentBright: '#22D3EE',   // cyan signal accent (dark)

    // Ink — dark "control-room" surfaces
    ink950: '#0A0F1A',
    ink900: '#0F172A',
    ink800: '#1E293B',
    ink700: '#334155',
    onInk: '#E2E8F0',
    onInkMuted: '#94A3B8',

    // Light surfaces
    background: '#F5F7FA',
    card: '#FFFFFF',
    surfaceMuted: '#F9FAFB',
    surfacePressed: '#F3F4F6',
    border: '#E5E7EB',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    textOnPrimary: '#FFFFFF',

    // Status language — vivid & consistent with admin
    critical: '#EF4444',
    high: '#F97316',
    medium: '#F59E0B',
    low: '#38BDF8',
    verified: '#10B981',
    info: '#1D4ED8',
    // soft/border tints kept for chips & banners on light surfaces
    dangerSoft: '#FEF2F2', dangerBorder: '#FECACA',
    successSoft: '#ECFDF5', successBorder: '#BBF7D0',
    warningSoft: '#FFFBEB', warningBorder: '#FDE68A',
    infoSoft: '#EFF6FF', infoBorder: '#BFDBFE',
  },
  // Font family keys resolved after expo-font loads them.
  fonts: {
    display: 'SpaceGrotesk_700Bold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_600SemiBold',
    mono: 'JetBrainsMono_500Medium', // asset codes, GPS, readings
  },
  radius: { card: 12, control: 10, pill: 999 },
  spacing: { screen: 16, section: 12, card: 12 },
} as const;
