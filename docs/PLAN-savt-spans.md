# SAVT cable span distance (TNB ask, 2026-11-16)

Status: BUILT on `feature/savt-spans` (API + admin only, no migration, no APK). Not deployed.

## What TNB asked
The distance of each SAVT cable span between consecutive poles, per route.

## Source
No span length is captured in the field: the SAVT checklist has a span PHOTO
(`GAMBAR SPAN`) and the KELEGAAN clearance reading, nothing else. So a span is the
**straight-line GPS distance from a pole to its parent pole on the same route**
(`PoleFeederMembership.fedFromAssetId`):

- trunk pole N → the nearest lower trunk pole; a branch (`/1`) → its trunk pole;
- a shared pole gets one span per route it carries;
- pole 1 has no span (the From Pencawang has no stored coordinates).

It reads a little under the real cable (sag, bends). Prod at build time: 82 routes,
6,778 poles, every SAVT pole has GPS, median span 26.6 m, p99 49 m.

## Flags (one per span, most serious first) — `apps/api/src/common/savt-spans.ts`
| Flag | Rule | Meaning |
|---|---|---|
| NO_GPS | either end has no fix (or 0,0) | no number |
| GAP | No. Tiang jumps (130 → 262; a branch whose trunk number is missing) | straight line over unrecorded poles — shown, NOT counted in the route length |
| SHORT | < 5 m | possibly the same pole twice |
| LONG | > 60 m AND > 2.5 × the route's median trunk span | check GPS / numbering |

Route totals: measured length (all spans except GAP / NO_GPS), span count, median,
longest, flagged count, gap count + gap length.

## Where it shows
1. **SAVT checklist export** (per route + all routes): `JARAK SPAN (m)` and
   `SEMAKAN SPAN`, appended at the END of the meta block (after NO TIANG LAMA) so
   the DC's existing column order is unchanged. Row n = span from its parent to
   pole n — the same pole the KELEGAAN reading sits on.
2. **SAVT route list export**: `JUMLAH PANJANG (m)`, `BIL SPAN`, `SPAN TERPANJANG (m)`
   (with the No. Tiang pair), `SPAN DITANDA`, `JURANG No. Tiang (m)`.
3. **Reports page, SAVT tab**: each route row shows "· 1.65 km · 4 to check".
4. **SAVT site-visit page → "Route spans" card**: totals, a sketch of the route
   drawn from the poles' GPS (lines coloured by flag; no base map), and a table of
   spans (From → To No. Tiang, metres, KELEGAAN on the TO pole, check note),
   defaulting to "To check". API: `GET /site-visits/:id/savt-spans` (same visibility
   as the visit).

## Route key fix (folded in)
KOD TIANG is not unique — TK, KC, PBA, PUL, FLS1 each name two lines with
different From Pencawang. The route selector / exports keyed on the code text, so
they merged two lines. Routes are now keyed `"<From Pencawang id>:<KOD TIANG>"`
(the visit's `fromPencawangId ?? substationId`, the same owner the pole sync uses
for the Feeder). `savt-routes` returns `routeKey`; the checklist download takes
`routeKey` (old `routeCode` links still work = every line with that code); `ids`
on the route list / bulk exports take keys (bare codes still accepted).

## Not in v1
SAVT lines on the Asset Map leaf; a measured span field in the checklist (template
change + APK); SAVT on `/network` / Drawing (would touch the RONDAAN isolation graph).

## Tests
`test/unit/savt-spans.unit-spec.ts` (trunk, branch, gap, short/long vs median,
no-GPS, route key); `test/authz/savt-spans.e2e-spec.ts` (two lines sharing a code
stay apart in the visit endpoint, route selector, per-route / bulk / list exports;
non-SAVT 400; out-of-scope 404).
