# TNB client view: Emergency hidden on the Asset Map (temporary)

**Date:** 2026-08-13
**Why:** TNB presented ASCURE to their Zone Manager on 2026-08-14. The
emergency system (declare / dispatch lanes) is **not fully deployed yet**, so
showing an "EMERGENCY 7" card to the network owner would invite questions we
can't back up in the product yet. Decision: hide every emergency surface from
the **client (TNB) view of the map page** until the rollout completes.

This is a **presentation-layer hide only**. No data changed, no API changed.
Internal users (ADMIN / managers / DC) still see everything. An emergency pole
still shows to the client — it just reads as an ordinary open-defect pole
(it *is* an open defect; only the emergency escalation is masked).

## Who is affected

Users with `isClientViewer === true` — accounts in a network-OWNER organization
(TNB / CLIENT role orgs). See `apps/admin-web/src/types/auth.ts`.

## What was hidden (map page only)

All in `apps/admin-web/src`:

| Surface | File | Gate |
| --- | --- | --- |
| "Emergency" KPI card in the header | `components/map-client.tsx` | tile not rendered |
| "Emergency" row in the Defects legend | `components/map-client.tsx` | row not rendered |
| `· N⚠` / `⚠` suffixes in the right-hand drill list | `components/map-client.tsx` | suffix not rendered |
| List-row dot colour | `components/map-client.tsx` | `mapAssetMarkerColor(..., { hideEmergency })` |
| Red bubble / red pole marker on the map | `components/hierarchical-map.tsx` (`hideEmergency` prop), `lib/map.ts` (`mapAssetMarkerColor` opts) | emergency colour collapses to the open-defect orange |
| "· emergency" badge in the pole side panel | `components/asset-map-panel.tsx` | suffix not rendered |

## How to un-hide (when the emergency system is client-ready)

Search `apps/admin-web/src` for `hideEmergency` and `isClientViewer` on the map
page and remove the gates added on 2026-08-13 (commit message:
`feat(admin-web): hide Emergency from the TNB client view map page`). Reverting
that commit restores everything in one step.

## Known remaining emergency mentions in the TNB view (NOT part of this change)

Deliberately untouched — flagged to the owner on 2026-08-13:

- **Progress page** (`components/client-progress-client.tsx`): the "Open
  findings" KPI shows "N flagged as emergency" as its context line, and group
  rows show `· N urgent`. (The context line was itself a deliberate earlier
  decision — "an emergency is not something to drop off the page".)
- **Surveys page** (`components/client-visits-client.tsx`): summary and
  per-visit "N urgent" chips.

If TNB will demo those pages too, the same `isClientViewer`-style hide (these
two components are client-only, so a plain removal) takes minutes.
