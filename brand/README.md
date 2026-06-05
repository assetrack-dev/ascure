# ASCURE Brand — v1 ("Operational Instrument")

The assured, verifiable record of every utility asset — from field inspection through maintenance closure.
**ASCURA** (company) · **ASCURE** (product). Tagline: **Survey. Verify. Resolve.**

## Logo

Primary mark: **Asset Tag + Node** — a hang-tag (with eyelet) carrying a survey-node "A".
It nods to ASCURE's origin as an asset-tagging tool, reads as the letter A, and makes a clean app icon.

| File | Use |
|---|---|
| `assets/ascure-mark.svg` | Primary mark, teal/cyan — on light surfaces |
| `assets/ascure-mark-white.svg` | Reverse mark — on brand/ink surfaces |
| `assets/ascure-app-icon.svg` | App icon (teal gradient tile, white mark) — 128 grid |
| `assets/ascure-favicon.svg` | Favicon (teal tile, white mark) — legible to 16px |
| `assets/ascure-logo-horizontal.svg` | Mark + wordmark, horizontal lockup |
| `assets/ascure-logo-stacked.svg` | Mark over wordmark, stacked lockup |

**Clear space:** keep padding ≥ the eyelet diameter around the mark. **Don't:** recolor outside the palette,
add the old red, stretch, add shadows/gradients to the mark, or place the color mark on busy photos (use the white mark).
Wordmark is **Space Grotesk 700**; outline to paths for print/portable assets.

## Color

**Brand** — teal `#0F766E` (light) / `#14B8A6` (dark) · cyan accent `#06B6D4` (light) / `#22D3EE` (dark)
**Ink (dark control-room surfaces)** — `#0A0F1A` `#0F172A` `#1E293B` `#334155` · text `#E2E8F0` / `#94A3B8`
**Light surfaces** — bg `#F6F8FB` · panel `#FFFFFF` · line `#D9E1EC` · text `#0F172A` · muted `#667085`
**Status** — Critical `#EF4444` · High `#F97316` · Medium `#F59E0B` · Low/Info `#38BDF8` · Verified `#10B981`

> Note: red is reserved for **Critical** status — it is not a brand color. (This is why we retired the old red/blue.)

## Typography

- **Display / headings:** Space Grotesk (technical, precise)
- **Body / UI:** Inter (calm and legible in dense lists and sunlight)
- **Mono:** JetBrains Mono — asset codes, GPS, readings, IDs (the "instrument" signal)

## Tokens & wiring

- `tokens.css` → drop into `apps/admin-web/src/app/globals.css` `:root`; load fonts via `next/font`.
- `tokens.ts` → align `apps/mobile/src/ui.tsx` `uiTheme`; load fonts via `expo-font`.

## Preview

Concept board: `ascure-brand-concepts.html`. Run `node brand/serve-brand.js` (or the `ascure-brand`
config in `.claude/launch.json`) and open http://localhost:4789.
