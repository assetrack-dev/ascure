import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/* =========================================================================
   ASCURE — "Ink on Mist" mobile theme.
   Monochrome: ink #161A1F on mist #E9ECEF. Light + dark, system-aware.
   Key names mirror the legacy `uiTheme.colors` so screens migrate cleanly.
   ========================================================================= */

export type ThemeMode = 'light' | 'dark';
export type ThemeSetting = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ascure-theme';

const lightColors = {
  // Brand = ink
  primary: '#2563EB',
  primaryStrong: '#1D4ED8',
  primarySoft: '#E7EEFF',

  // Content surfaces (mist)
  background: '#DFE3E8',
  card: '#FFFFFF',
  surfaceMuted: '#EDF0F3',
  surfacePressed: '#E4E8EE',
  border: '#E4E8EE',
  borderStrong: '#D3D9E1',

  textPrimary: '#12161C',
  textSecondary: '#586170',
  textMuted: '#8A93A0',
  textOnPrimary: '#FFFFFF',
  // Text/glyph that sits on a saturated STATUS fill (success/danger/info button).
  // White in light mode; ink in dark (where status fills lighten) — stays legible.
  onStatus: '#FFFFFF',
  // Solid dark fill for avatars / active chips / "scan"+"mark done" buttons / rank
  // badges — ink in light. In DARK this must NOT follow textPrimary (which flips
  // light); it becomes a neutral dark (#2A323D) so white text stays legible.
  solidFill: '#12161C',
  onSolidFill: '#FFFFFF',

  // "Chrome" surfaces (drawer, map panels) — follow the theme (light in light mode)
  chrome: '#FFFFFF',
  chromePanel: '#F4F6F8',
  chromeBorder: '#E1E5EA',
  chromeBorderStrong: '#D7DCE2',
  chromeActive: '#ECEEF1',
  onChrome: '#161A1F',
  onChromeMuted: '#566373',
  onChromeFaint: '#828E9C',
  chromeAccent: '#2563EB',
  chromeDanger: '#DC2626',

  // Status — functional
  danger: '#DC2626',
  dangerSoft: '#FBE8E8',
  dangerBorder: '#F2C7C7',
  dangerText: '#B0201F',
  success: '#15A34A',
  successSoft: '#E4F4E9',
  successBorder: '#C5E2C8',
  successText: '#12712F',
  warning: '#D98A0B',
  warningSoft: '#FBEFD6',
  warningBorder: '#EBD7AE',
  warningText: '#8A5606',
  info: '#2563EB',
  infoSoft: '#E7EEFF',
  infoBorder: '#BAE0FB',
  infoText: '#1D4ED8',

  overlay: 'rgba(8,11,15,0.55)',
  shadow: '#121C30',
};

type ColorPalette = typeof lightColors;

const darkColors: ColorPalette = {
  primary: '#4C82F5',
  primaryStrong: '#89AEF8',
  primarySoft: 'rgba(76,130,245,0.18)',

  background: '#080A0E',
  card: '#141A23',
  surfaceMuted: '#1A212A',
  surfacePressed: '#222932',
  border: '#242C36',
  borderStrong: '#323C48',

  textPrimary: '#EAEEF3',
  textSecondary: '#9AA4B2',
  textMuted: '#69727F',
  textOnPrimary: '#FFFFFF',
  onStatus: '#11151A',
  // Dark-mode inversion (see lightColors.solidFill): neutral dark fill, light text.
  solidFill: '#2A323D',
  onSolidFill: '#EAEEF3',

  chrome: '#0B0E12',
  chromePanel: '#161A1F',
  chromeBorder: 'rgba(233,236,239,0.10)',
  chromeBorderStrong: 'rgba(233,236,239,0.16)',
  chromeActive: 'rgba(233,236,239,0.10)',
  onChrome: '#E9ECEF',
  onChromeMuted: '#9AA4B0',
  onChromeFaint: '#66717F',
  chromeAccent: '#60A5FA',
  chromeDanger: '#FCA5A5',

  danger: '#F0605F',
  dangerSoft: 'rgba(240,96,95,0.16)',
  dangerBorder: '#5A2A2D',
  dangerText: '#F58A8A',
  success: '#3FB569',
  successSoft: 'rgba(63,181,105,0.15)',
  successBorder: '#234A30',
  successText: '#6FD79A',
  warning: '#E4B25E',
  warningSoft: 'rgba(224,169,74,0.16)',
  warningBorder: '#4D3B1E',
  warningText: '#E7B96A',
  info: '#4C82F5',
  infoSoft: 'rgba(76,130,245,0.18)',
  infoBorder: '#1E4A63',
  infoText: '#89AEF8',

  overlay: 'rgba(0,0,0,0.62)',
  shadow: '#000000',
};

/* Brand type — Space Grotesk (display/headings), Inter (body/UI), JetBrains
   Mono (codes/readings). Loaded via expo-font in App.tsx; these names MUST match
   the @expo-google-fonts export keys. RN ignores fontWeight for custom fonts, so
   each weight is its own family — pick the family, not the weight. */
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

/** Map an RN fontWeight to the matching Inter family (custom fonts don't honour
 *  fontWeight on Android, so the family carries the weight). Default → regular. */
export function interFamily(weight?: string): string {
  switch (weight) {
    case 'bold':
    case '700':
    case '800':
    case '900':
      return fonts.bodyBold;
    case '600':
      return fonts.bodySemibold;
    case '500':
      return fonts.bodyMedium;
    default:
      return fonts.body;
  }
}

export function buildTheme(mode: ThemeMode) {
  const colors = mode === 'dark' ? darkColors : lightColors;
  return {
    mode,
    colors,
    fonts,
    // Field-grade radii: cards/sheets rounder, controls comfortable, chips subtle,
    // pill = fully round (avatars, dots). Bottom sheets get the biggest radius.
    radius: { card: 16, control: 14, chip: 8, sheet: 22, pill: 999 },
    // Horizontal screen padding 20, roomier card padding 16 (outdoor legibility).
    spacing: { screen: 20, section: 12, card: 16 },
    shadow: {
      card: {
        shadowColor: colors.shadow,
        shadowOpacity: mode === 'dark' ? 0.4 : 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      },
      raised: {
        shadowColor: colors.shadow,
        shadowOpacity: mode === 'dark' ? 0.55 : 0.12,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
      },
      // Elevated blue glow under the docked primary CTA (thumb-reach button).
      cta: {
        shadowColor: colors.primary,
        shadowOpacity: mode === 'dark' ? 0.5 : 0.45,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 10 },
        elevation: 10,
      },
    },
  };
}

export type Theme = ReturnType<typeof buildTheme>;

/** Light theme as a static value — back-compat for not-yet-migrated screens. */
export const uiTheme = buildTheme('light');

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  setting: ThemeSetting;
  setSetting: (setting: ThemeSetting) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: uiTheme,
  mode: 'light',
  setting: 'system',
  setSetting: () => undefined,
  toggle: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>('system');
  const [systemScheme, setSystemScheme] = useState<ThemeMode>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (active && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setSettingState(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => subscription.remove();
  }, []);

  const setSetting = useCallback((next: ThemeSetting) => {
    setSettingState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const mode: ThemeMode = setting === 'system' ? systemScheme : setting;

  const toggle = useCallback(() => {
    setSetting(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setSetting]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: buildTheme(mode), mode, setting, setSetting, toggle }),
    [mode, setting, setSetting, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active theme object (colors/radius/spacing/shadow + mode). */
export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

/** Theme controls — for the toggle in the drawer. */
export function useThemeControls() {
  const { mode, setting, setSetting, toggle } = useContext(ThemeContext);
  return { mode, setting, setSetting, toggle };
}
