# ASCURE Brand — v2 ("Ink on Mist")

The assured, verifiable record of every utility asset — from field inspection through maintenance closure.
**ASCURA** (company) · **ASCURE** (product). Tagline: **Survey. Verify. Resolve.**

## Logo

Primary mark: **the survey monogram** — an "A" peak fused with a map-pin/location silhouette
and a pen-nib/survey-needle (the dot-and-line). It reads as precision mapping + surveying +
infrastructure: exactly what ASCURE does.

| File | Use |
|---|---|
| `logo/monogram_03_ink_on_mist.png` | Primary mark / app icon — ink mark on a mist tile |
| `logo/lockup_03_ink_on_mist.png` | Mark + wordmark, stacked lockup |

In-app the monogram PNG ships at `apps/admin-web/public/brand/monogram.png`,
`apps/admin-web/src/app/icon.png` (favicon), and `apps/mobile/assets/brand/monogram.png`.
Wordmark is **Space Grotesk 700**. The older teal `assets/*.svg` marks are **superseded** by this monogram.

## Color — monochrome

The brand **is the ink**. Primary actions are solid ink on a mist canvas (light) or
solid mist on an ink canvas (dark). No teal, no cyan — color is reserved for *status*.

**Ink** `#161A1F` (the logo ink) · **Mist** `#E9ECEF` (the canvas)

Neutral ramp (cool, anchored ink→mist): `#0B0E12` `#11151A` `#161A1F` `#1D222A` `#2A313B`
`#3A434F` `#566373` `#828E9C` `#A2ADB9` `#CDD4DB` `#D7DCE2` `#E9ECEF` `#F4F6F8` `#FFFFFF`.

**Light** — bg `#E9ECEF` · panel `#FFFFFF` · line `#D7DCE2` · text `#161A1F` · muted `#566373` · primary `#161A1F`
**Dark** — bg `#0E1116` · panel `#181D24` · line `#262D36` · text `#E9ECEF` · muted `#9AA4B0` · primary `#E9ECEF`
**Chrome** (dark sidebar/drawer in both modes) — surface `#11151A` · on-chrome `#E9ECEF` · accent `#E9ECEF`

**Status — functional, not brand.** Critical `#DC2626` · High `#EA580C` · Medium `#B45309` ·
Info/Low `#2563EB` · Verified `#16A34A`. (Each has soft/border/text variants per theme;
dark mode uses lighter on-dark variants. Red is reserved for **Critical**, never brand.)

## Typography

- **Display / headings:** Space Grotesk (technical, precise — echoes the wordmark)
- **Body / UI:** Inter (calm, legible in dense lists and sunlight)
- **Mono:** JetBrains Mono — asset codes, GPS, readings, IDs (the "instrument" signal)

## Tokens & wiring

- **Admin web** — live source is `apps/admin-web/src/app/globals.css`: `:root` (light) +
  `:root[data-theme="dark"]` semantic vars, plus a Tailwind v4 `@theme inline` block that
  rebinds the `teal-*`/`slate-*`/status scales to the semantic tokens so every utility class
  flips with the theme. Toggle via `components/theme-toggle.tsx`; no-flash script in `layout.tsx`.
- **Mobile** — live source is `apps/mobile/src/theme/index.tsx`: `ThemeProvider` + `useTheme()`
  with light/dark palettes (system-aware, persisted). Screens build styles via
  `createStyles(theme)`. See `apps/mobile/src/theme/MIGRATION-GUIDE.md`.
- `tokens.css` / `tokens.ts` here are the canonical reference mirrors of the above.

## Preview

`brand/ascure-brand-concepts.html` is the **archived v1 (teal)** concept board.
