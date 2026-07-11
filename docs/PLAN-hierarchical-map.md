# Hierarchical (drill-down) Asset Map — scaling plan

**Status:** Stage A in progress. Tier 0 (rendering fix) shipped as commit `6ad25df`.

## Why
Today `GET /assets/map` → `listMapAssets` returns **every located asset in scope** as one array (no bbox, no limit), and the browser filters/sorts/clusters it all client-side (`fetchMapAssets` → React state). That model:
- breaks at ~20–50k points (payload 10–25 MB, client clustering of 50k+ markers janky),
- is infeasible at 100k–500k (40–250 MB payload, browser OOM).

Expected volume: tens of thousands within the year, hundreds of thousands the year after. So we change the model **before** we cross ~20k.

## Approach — aggregate by the org hierarchy, not geography
Show **counts per group** and drill down; only ever load individual poles inside one Pencawang.

```
Region  ──click──▶  Mainhead  ──click──▶  Pencawang  ──click──▶  individual poles
(bubbles w/ count)  (bubbles)            (bubbles)              (Tier 0 renderer)
```

Each view returns a handful → a few hundred bubbles (KB, not MB). Scales to millions.

**Decision (2026-07-11): the hierarchy is _structural_** — a Pencawang belongs to exactly one Mainhead (Region derived via Mainhead). So we wire FKs and aggregate with a plain `GROUP BY`. Every pole is classifiable even before it is inspected (no "Unassigned" bucket).

## Data model
- `Substation.mainheadId` → Mainhead (`onDelete: SetNull`) + `@@index([mainheadId])`. Region = `Mainhead.operationalRegionId` (already exists).
- `Asset @@index([latitude, longitude])` — for the points-level bbox + centroid queries.
- No group level stores coordinates (`Substation.location` is free text). **Bubble position = centroid `AVG(latitude), AVG(longitude)` of member poles**, computed per group.

## API
`GET /assets/map?level=region|mainhead|pencawang|points` (+ `regionId` / `mainheadId` / `pencawangId`)
- `region` / `mainhead` / `pencawang` → bubbles `{ id, name, count, lat, lng /*centroid*/, inspected, openDefects, emergency }`. One grouped query joining `Asset → Substation → Mainhead [→ OperationalRegion]`; rollups via `COUNT(...) FILTER (WHERE ...)`. Likely `$queryRaw` (Prisma `groupBy` can't do the multi-join + FILTER cleanly).
- `points` → today's per-asset shape, scoped to one Pencawang (bounded set).
- Existing scope/authz `WHERE` + the filters fold into every level.

## Client
- Map opens on Region bubbles (no filter). Click a bubble → zoom to its bounds + fetch the next level. Breadcrumb `Region › Mainhead › Pencawang` walks back up.
- The `points` leaf reuses the renderer fixed in Tier 0 (raster icons, auto-cluster, decoupled selection).
- Filters become server params (they narrow the counts at every level).
- Bubble marker = count label, coloured by rolled-up worst state; small badge for open-defects / emergency.

## Backfill + upkeep (the cost of "structural")
- **Backfill** each `Substation.mainheadId` from its site visits' dominant mainhead. Report substations with conflicting mainheads or none, for manual resolution. Script: `scripts/backfill-substation-mainhead.cjs`.
- **Keep populated going forward**: set `mainheadId` when a Pencawang is first created under a visit; add an admin "assign Pencawang → Mainhead" control (later).

## Deploy
Stage A's migration + backfill run through the guided prod flow (see prod deploy runbook) against real data — not a silent ship.

## Stages
- **A — foundation:** schema (`Substation.mainheadId`, `Asset` geo index) + backfill script. ← in progress
- **B — API:** aggregated bubble endpoint + rollups + scope.
- **C — client:** drill-down UX; leaf reuses Tier 0.
