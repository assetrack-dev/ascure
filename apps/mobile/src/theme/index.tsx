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
  primarySoft: '#DBEAFE',

  // Content surfaces (mist)
  background: '#E9ECEF',
  card: '#FFFFFF',
  surfaceMuted: '#F4F6F8',
  surfacePressed: '#ECEEF1',
  border: '#D7DCE2',
  borderStrong: '#C5CCD4',

  textPrimary: '#161A1F',
  textSecondary: '#566373',
  textMuted: '#828E9C',
  textOnPrimary: '#FFFFFF',
  // Text/glyph that sits on a saturated STATUS fill (success/danger/info button).
  // White in light mode; ink in dark (where status fills lighten) — stays legible.
  onStatus: '#FFFFFF',

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
  dangerSoft: '#FCEBEB',
  dangerBorder: '#F2C7C7',
  dangerText: '#791F1F',
  success: '#16A34A',
  successSoft: '#E9F4EA',
  successBorder: '#C5E2C8',
  successText: '#27500A',
  warning: '#B45309',
  warningSoft: '#FAEFDD',
  warningBorder: '#EBD7AE',
  warningText: '#854F0B',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
  infoBorder: '#BAE0FB',
  infoText: '#075985',

  overlay: 'rgba(8,11,15,0.55)',
  shadow: '#0B0E12',
};

type ColorPalette = typeof lightColors;

const darkColors: ColorPalette = {
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
  textOnPrimary: '#FFFFFF',
  onStatus: '#11151A',

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

  danger: '#F87171',
  dangerSoft: '#3A1D20',
  dangerBorder: '#5A2A2D',
  dangerText: '#FCA5A5',
  success: '#4ADE80',
  successSoft: '#13301E',
  successBorder: '#234A30',
  successText: '#A7E8BC',
  warning: '#F5B544',
  warningSoft: '#332817',
  warningBorder: '#4D3B1E',
  warningText: '#FCD77F',
  info: '#38BDF8',
  infoSoft: '#0C2A3B',
  infoBorder: '#1E4A63',
  infoText: '#BAE6FD',

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
    radius: { card: 14, control: 10, pill: 999 },
    spacing: { screen: 16, section: 12, card: 12 },
    shadow: {
      card: {
        shadowColor: colors.shadow,
        shadowOpacity: mode === 'dark' ? 0.4 : 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      },
      raised: {
        shadowColor: colors.shadow,
        shadowOpacity: mode === 'dark' ? 0.55 : 0.12,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
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
