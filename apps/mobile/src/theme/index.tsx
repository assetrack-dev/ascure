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
  primary: '#161A1F',
  primaryStrong: '#2A313B',
  primarySoft: '#DDE2E8',

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
  textOnPrimary: '#F7F8FA',
  // Text/glyph that sits on a saturated STATUS fill (success/danger/info button).
  // White in light mode; ink in dark (where status fills lighten) — stays legible.
  onStatus: '#FFFFFF',

  // Dark "chrome" surfaces (drawer, map panels) — dark in BOTH modes
  chrome: '#11151A',
  chromePanel: '#1B212A',
  chromeBorder: 'rgba(233,236,239,0.10)',
  chromeBorderStrong: 'rgba(233,236,239,0.16)',
  chromeActive: 'rgba(233,236,239,0.10)',
  onChrome: '#E9ECEF',
  onChromeMuted: '#9AA4B0',
  onChromeFaint: '#66717F',
  chromeAccent: '#E9ECEF',
  chromeDanger: '#FCA5A5',

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
  info: '#2563EB',
  infoSoft: '#E7F1FB',
  infoBorder: '#C4DBF5',
  infoText: '#0C447C',

  overlay: 'rgba(8,11,15,0.55)',
  shadow: '#0B0E12',
};

type ColorPalette = typeof lightColors;

const darkColors: ColorPalette = {
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
  onStatus: '#11151A',

  chrome: '#0B0E12',
  chromePanel: '#161A1F',
  chromeBorder: 'rgba(233,236,239,0.10)',
  chromeBorderStrong: 'rgba(233,236,239,0.16)',
  chromeActive: 'rgba(233,236,239,0.10)',
  onChrome: '#E9ECEF',
  onChromeMuted: '#9AA4B0',
  onChromeFaint: '#66717F',
  chromeAccent: '#E9ECEF',
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
  info: '#60A5FA',
  infoSoft: '#152538',
  infoBorder: '#23405E',
  infoText: '#AECBF5',

  overlay: 'rgba(0,0,0,0.62)',
  shadow: '#000000',
};

export function buildTheme(mode: ThemeMode) {
  const colors = mode === 'dark' ? darkColors : lightColors;
  return {
    mode,
    colors,
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
