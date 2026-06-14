# Mobile theme migration guide (Ink on Mist, light + dark)

The app now has a runtime theme. Screens must read colors from the active theme
via the `useTheme()` hook instead of the static `uiTheme` import or hardcoded hex,
so they respond to the light/dark toggle.

## The pattern

Before:

```tsx
import { uiTheme } from '../ui';
export function FooScreen() {
  return <View style={styles.card} />;
}
const styles = StyleSheet.create({
  card: { backgroundColor: uiTheme.colors.card, borderColor: '#e5e7eb' },
  title: { color: '#111827' },
});
```

After:

```tsx
import { useMemo } from 'react';
import { Theme, useTheme } from '../theme';
export function FooScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <View style={styles.card} />;
}
const createStyles = (t: Theme) =>
  StyleSheet.create({
    card: { backgroundColor: t.colors.card, borderColor: t.colors.border },
    title: { color: t.colors.textPrimary },
  });
```

Rules:
- Inline colors used in JSX (e.g. `<Feather color={uiTheme.colors.primary} />`,
  `placeholderTextColor`, `ActivityIndicator color`, `pinColor`) → `theme.colors.X`.
- `uiTheme.radius` / `uiTheme.spacing` / `uiTheme.shadow` → `t.radius` / `t.spacing` / `t.shadow`.
- If a screen has multiple components, each component calls `useTheme()` +
  `useMemo(() => createStyles(theme), [theme])`. A factory may be shared.
- Do NOT change any logic, props, data flow, navigation, or JSX structure — colors/styles only.

## Token contract — `theme.colors.*`

Content (flips light↔dark automatically):
`primary` (ink/mist), `primaryStrong`, `primarySoft`,
`background`, `card`, `surfaceMuted`, `surfacePressed`, `border`, `borderStrong`,
`textPrimary`, `textSecondary`, `textMuted`, `textOnPrimary`.

Dark "chrome" surfaces (dark in BOTH modes — drawers, map control panels, dark legends):
`chrome`, `chromePanel`, `chromeBorder`, `chromeBorderStrong`, `chromeActive`,
`onChrome`, `onChromeMuted`, `onChromeFaint`, `chromeAccent`, `chromeDanger`.

Status (functional; each has base + Soft/Border/Text):
`danger`/`dangerSoft`/`dangerBorder`/`dangerText`,
`success`/`successSoft`/`successBorder`/`successText`,
`warning`/`warningSoft`/`warningBorder`/`warningText`,
`info`/`infoSoft`/`infoBorder`/`infoText`.

Misc: `overlay` (modal scrim — dark in both modes), `shadow` (shadowColor base).

## Hardcoded hex → token map

| Hardcoded | Token |
|---|---|
| `#ffffff` / `#fff` (card/surface) | `card` |
| `#111827` / `#0f172a` / `#10233d` (primary text) | `textPrimary` |
| `#566373` / `#6b7280` / `#64748b` / `#334155` (secondary text) | `textSecondary` |
| `#9ca3af` / `#828e9c` (muted) | `textMuted` |
| `#e5e7eb` / `#d1d5db` / `#cbd5e1` / `#c7d5e8` / `#dce5f1` (borders) | `border` |
| `#f9fafb` / `#f8fafc` / `#f3f4f6` (subtle surfaces) | `surfaceMuted` / `surfacePressed` |
| `#f5f7fa` / `#eef4fb` (page bg) | `background` |
| `#0F766E` / `#115E59` / `#CCFBF1` (old teal brand) | `primary` / `primaryStrong` / `primarySoft` |
| `#B91C1C` `#dc2626` `#991b1b` `#b42318` (red text/icon) | `danger` (or `dangerText` on a soft bg) |
| `#fee2e2` `#fef2f2` / `#FECACA` (red bg / border) | `dangerSoft` / `dangerBorder` |
| `#166534` `#15803d` `#10b981` (green) | `success` (or `successText` on soft bg) |
| `#dcfce7` `#ecfdf5` / `#BBF7D0` (green bg / border) | `successSoft` / `successBorder` |
| `#92400e` `#b45309` `#7c2d12` (amber/orange text) | `warning` / `warningText` |
| `#fffbeb` `#fef3c7` / `#FDE68A` (amber bg / border) | `warningSoft` / `warningBorder` |
| `#1d4ed8` `#2563eb` `#0f5cd8` (blue) | `info` (or `infoText` on soft bg) |
| `#eff6ff` `#e7f1fb` / `#BFDBFE` (blue bg / border) | `infoSoft` / `infoBorder` |
| `rgba(0,0,0,0.4–0.92)` modal backdrop scrim | `overlay` |
| `#0F172A` shadowColor | `shadow` |

## KEEP these hardcoded (functional data-viz / map — NOT brand)

- Map **feeder line** palette (per feeder letter A–F + fallbacks).
- Defect **severity heatmap** gradient (green/yellow/red) and **marker pin** colors
  (asset blue, new-asset green, resolved gray, severity reds/ambers).
- Sequence **warning marker** colors on the map.
- Any color that encodes categorical/severity data on the map or a chart.

These are functional signals, not theme. Leave them as literal hex. If they sit on a
themed surface, only the surrounding surface/text changes, not the data color.
