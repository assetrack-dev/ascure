# TNB client view: Emergency hidden (temporary)

**Date:** 2026-08-13
**Why:** TNB presented ASCURE to their Zone Manager on 2026-08-14. The
emergency system (declare / dispatch lanes) is **not fully deployed yet**, so
showing an "EMERGENCY 7" card to the network owner would invite questions we
can't back up in the product yet. Decision: hide every emergency surface from
the **client (TNB) view** — the Asset Map, Progress, and Surveys pages — until
the rollout completes.

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

## What was hidden (Progress + Surveys pages — second commit, same day)

These two components render ONLY for client viewers, so the emergency renders
were removed outright (no `isClientViewer` gate needed), each spot marked with
a comment pointing at this doc:

| Surface | File |
| --- | --- |
| "N flagged as emergency" context on the Open-findings KPI | `components/client-progress-client.tsx` |
| `· N urgent` on Mainhead / group rows | `components/client-progress-client.tsx` |
| "N urgent" summary chip | `components/client-visits-client.tsx` |
| Per-visit urgent Siren icon | `components/client-visits-client.tsx` |

Note: the Progress KPI context line was itself a deliberate earlier decision
("an emergency is not something to drop off the page") — restore it when
un-hiding.

## How to un-hide (when the emergency system is client-ready)

Revert the two 2026-08-13 commits (messages:
`feat(admin-web): hide Emergency from the TNB client view map page` and
`feat(admin-web): hide Emergency from the TNB client Progress + Surveys pages`),
or search `apps/admin-web/src` for `hideEmergency` /
`tnb-view-emergency-hidden` and remove the gates by hand.
