# PLAN — SAVT shared poles (multi-feeder corridors)

> Status: **🛠 PHASE A BUILT** (2026-08-05, uncommitted; api + admin-web + shared-utils
> compile clean, grammar helpers unit-checked, migration applied + backfill dry-run
> OK on local dev). Owner answers folded in: (a) NO double circuits — `KK - LL` is a
> unique feeder key; (b) duplicate Pencawang IS a live concern — the backfill script
> reports duplicate Pencawang codes now, the check-in guard stays Phase B.
>
> Shipped in Phase A: `FeederKind` migration `20260805000000_add_feeder_kind_savt`;
> `packages/shared-utils/src/savt/route-code.ts` (canonicalize/compose/parse);
> routeCode canonicalized on visit create + carried into next-cycle clones;
> `syncSavtPoleMembership` on SAVT pole create + kind-aware membership resync on
> edit (`apps/api/src/common/savt-graph.ts` holds the shared upsert); SAVT-aware
> `POST /site-visits/:id/assets` link (savtNoTiang/savtBranchSuffix); RONDAAN
> network/renderer queries filtered to `kind: RONDAAN`; membership-first No. Tiang
> + KONGSI DENGAN column in both SAVT exports; `savtRoutes` on asset detail +
> "Tiang kongsi" line in the map panel; `scripts/backfill-savt-memberships.cjs`
> (dry-run default; reports recodes, No. Tiang collisions, cross-route GPS
> duplicate suspects ≤30 m, duplicate Pencawang codes).
>
> Originally designed 2026-08-05 with the owner; the sections below are the design.
>
> Owner's field answers that shaped this design (2026-08-05):
> 1. A shared pole carries **multiple printed KOD TIANG codes — one per feeder** — and
>    each feeder **numbers its poles independently** (the same physical pole can be
>    "MI - KUK 7" and "MI - PAR 12").
> 2. **The field crew does the tagging.** The office cannot know a pole is shared;
>    only the crew standing under it can see the multiple plates.
> 3. Inspection reuse is **undecided**: leaning to full re-inspection per feeder
>    (different cable ⇒ different accessories, e.g. PENGALIR FASA is per-circuit),
>    with a possible later optimization to reuse structural answers.
> 4. **No shared poles captured in prod yet** (owner to confirm) — greenfield, no
>    dedup/merge migration needed.

## The problem

SAVT (Sesalur Atas Voltan Tinggi) feeders run overhead between Pencawang
(PMU → PPU → SSU → PE). Multiple feeders (seen: up to 4) often ride the **same
physical poles** along a shared corridor until their routes junction apart.

Example: from Pencawang A, feeder →B uses 100 poles and feeder →C uses 43; the
first 25 poles out of A are shared. Physical poles = 118, but the per-feeder
reports must show 100 and 43 rows respectively.

Today a SAVT pole belongs to a route **only through the site visit that created
it** (`SiteVisitAsset` → `siteVisit.routeCode`). One pole = one route. So the
crew surveying A→C at the shared stretch can only:

- **re-add the 25 poles** → duplicate physical assets (violates ADR 0003: pole
  identity = system id + GPS; one structure = one asset), double markers on the
  map, split inspection history; or
- **skip them** → the A→C report shows 18 poles instead of 43.

Both are wrong. The fix is the same shape as the RONDAAN multi-feeder fix
(Deploy 49): **one physical pole, N feeder memberships.**

## Current state (what exists today — reuse it)

- **`Feeder` + `PoleFeederMembership`** (`prisma/schema.prisma:1652`, `:1670`)
  already model exactly this for RONDAAN: `Feeder` is `@@unique([substationId,
  code])`; membership carries `sequenceIndex`, `branchSuffix`, a **per-feeder**
  `fedFromAssetId`, and `@@unique([assetId, feederId])` +
  `@@unique([feederId, sequenceIndex, branchSuffix])`. The isolation logic
  (`apps/api/src/assets/network.service.ts:239`) already understands shared
  poles ("opening feeder B must not de-energize a pole feeder C still feeds").
- Memberships are synced by parsing the **RONDAAN code grammar** in
  `AssetsService.syncPoleMemberships` (`apps/api/src/assets/assets.service.ts:2062`).
  **SAVT poles never get memberships** — their code is a different grammar.
- A SAVT pole's `assetCode` = `"{KOD TIANG} {No. Tiang}"` (e.g. `"MI - KUK 7"`,
  branches typed as `/m`). The route's KOD TIANG is set once at check-in and
  prefixed automatically; "Next:" suggests `MAX(trunk number)+1` per route
  (`apps/mobile/src/screens/AddAssetScreen.tsx:181-289`).
- The SAVT visit carries `fromPencawangId`, `toPencawangId`, `routeCode`
  (`prisma/schema.prisma:1112-1114`; stored trim-only so `"MI - KUK"` keeps its
  spacing, `site-visits.service.ts:1938`).
- Per-route reporting keys on `siteVisit.routeCode`: route selector
  (`apps/api/src/reports/reports.service.ts:1451`), per-route checklist export
  (`:1604`), bulk export (`:1760`). Inspections already live per **visit**, and
  a visit belongs to one route.
- Poles attach to visits via `SiteVisitAsset` (`prisma/schema.prisma:1252`,
  `@@unique([siteVisitId, assetId])`, has a `source` column) — an existing pole
  CAN be linked to a second visit without re-creating it. The mobile flow just
  never offers it.

## Design

### Data model — reuse `Feeder` + `PoleFeederMembership`, no new tables

- A SAVT route (A→B) becomes a **`Feeder` owned by its source Pencawang**
  (`substationId` = the visit's `fromPencawangId`, falling back to
  `substationId`; `code` = the route's KOD TIANG, e.g. `"MI - KUK"`). This is
  electrically honest: A→B and A→C are both outgoing feeders **of A**.
- Each pole gets **one membership per route**: `sequenceIndex` = No. Tiang,
  `branchSuffix` = `/m`-style branch. The per-route pole code is reconstructed
  as `` `${feeder.code} ${sequenceIndex}${branchSuffix}` `` — so independent
  numbering per feeder (owner's answer #1) is native, and the schema's
  `@@unique([feederId, sequenceIndex, branchSuffix])` gives per-route
  duplicate-number protection for free.
- `Asset.assetCode` keeps the code of the route the pole was **first created
  under** (its "primary" plate). Display surfaces (map panel, Linked Assets,
  exports) list all membership codes.
- Add a **`kind`/`operationalScope` discriminator on `Feeder`** (RONDAAN = LV
  distribution of a Pencawang; SAVT = HV route). Keeps the RONDAAN network
  graph queries from picking up SAVT feeders and vice-versa.

### Inspection — full re-inspection per feeder (Phase 1)

Each crew inspects the shared pole **under its own route's visit**, exactly as
today. This needs **zero changes** to the inspection model (inspection → visit
→ route), matches the owner's lean (#3: different cable ⇒ different
accessories), and keeps every per-feeder report self-contained for TNB.

The "check once, reuse structural answers" optimization is **deferred to
Phase C** — it needs a per-template-item flag (structural vs circuit-specific
like PENGALIR FASA), mobile prefill UX, and TNB's acceptance. Decide later;
nothing in Phases A/B blocks it.

### Capture flow — the crew tags sharing at the pole (owner's answer #2)

In a SAVT visit's Add Asset screen, alongside the normal "new pole" path:

- **"Tiang kongsi" (shared pole)**: the app shows nearby existing SAVT poles
  (GPS radius ~30 m from the offline read-cache) with their existing codes.
  The crew picks the physical pole they're standing under, enters **this
  route's** No. Tiang (the "Next:" suggestion still applies), and submits.
- Server-side this **links** instead of creates: a `SiteVisitAsset` row
  (`source: 'SHARED_POLE_LINK'`) + a new `PoleFeederMembership` on this
  route's feeder. No new `Asset`. The crew then inspects it normally.

### Report changes

- Per-route export becomes **membership-driven**: poles = memberships on that
  feeder ordered by `sequenceIndex`/`branchSuffix`; the code column shows the
  **route-specific** code; inspection data still comes from that route's own
  visits (unchanged). A→B = 100 rows, A→C = 43 rows, by construction.
- Add a **"KONGSI DENGAN"** column listing the pole's other feeders' codes, so
  a shared pole is visibly shared, not suspected as a duplicate.
- Route selector pole counts (`getSavtRoutes`) count memberships, not
  visit-attached assets.

## Phases

### Phase A — server only (deployable without an APK)

1. Migration: `Feeder.kind` discriminator (default RONDAAN-compatible value).
2. `syncSavtMembership`: on SAVT pole create/edit, upsert the route's Feeder
   (from the visit's `fromPencawangId` + `routeCode`) + the pole's membership
   (parse No. Tiang / branch from the code, which the server already builds).
3. Backfill script: walk existing SAVT poles → single membership each, via
   their creation visit's `routeCode`. (Also confirms owner's answer #4 — the
   script reports any pole that would collide, i.e. an accidental duplicate.)
4. `POST /site-visits/:id/assets/link` — link an existing SAVT pole to this
   visit + create the membership `{noTiang, branchSuffix}`. Guards: visit is
   SAVT + caller `canMutate` + pole is a SAVT pole in the same tenant; reject
   if the pole already has a membership on this route.
5. Reports: switch the three per-route readers to membership-driven with the
   KONGSI DENGAN column. Keep `routeCode`-based fallback until backfill runs.
6. Admin-web: map asset panel + Linked Assets show all codes of a pole.

### Phase B — mobile (next APK, alongside the queued per-Mainhead emergency gating)

1. AddAssetScreen "Tiang kongsi" path: nearby-pole candidates (read-cache,
   GPS ≤ ~30 m, SAVT poles not already on this route), pick + enter No. Tiang.
2. Offline: new write-queue op `linkAssetToVisit` through the existing
   temp-ID reconciler (the candidate pole may itself be a temp-ID if the same
   crew created it earlier in the session — reconciler must map it).
3. Read-cache warming: candidates must include poles from **other routes** in
   the corridor — warm by geography around the visit, not by visit membership.
   (LESSON from memory applies: assume the widest account that can log in.)
4. Visit-complete pre-check: per-route gap/dupe lint reads memberships (this
   also feeds the parked SAVT pre-check fix — the v22 gate parses SAVR grammar).

### Phase C — deferred (owner + TNB decision)

Structural-answer reuse across feeders: per-template-item flag
(circuit-specific: PENGALIR FASA, per-cable accessories vs structural: pole
condition, ground), mobile prefills structural answers from the latest
other-feeder inspection for the crew to confirm. Do NOT start until TNB
confirms one physical check is acceptable in multiple feeder reports.

## Edge cases + open questions

- **Two crews, both offline, both "first" on the same corridor** → the shared
  pole gets created twice (neither has the other's pole in cache). Accept for
  now (rare: routes are usually surveyed at different times); an office-side
  merge tool is the eventual answer. The backfill collision report (A.3) will
  surface any that happen.
- **Verify:** is a SAVT visit's `substationId` always the From-Pencawang? The
  feeder anchor uses `fromPencawangId ?? substationId` — check real prod rows
  before the backfill.
- **`routeCode` is free text at check-in — but it shouldn't be** (owner,
  2026-08-05, with check-in screenshots): KOD TIANG is by definition
  `{KOD PENCAWANG from} - {To Pencawang Code}` (e.g. `KK - LL`); crews today
  re-type it manually from the plate on the pole, which is where `MI-KUK` vs
  `MI - KUK` vs en-dash splits would come from. Mitigation:
  - **Phase A (server, no APK):** canonicalize `routeCode` on write — trim,
    uppercase, collapse whitespace, normalize the dash to `" - "`. The backfill
    applies the same normalizer to existing prod routeCodes so history lands on
    the same feeder keys. Old APKs in the fleet are then harmless.
  - **Phase B (APK):** auto-compose KOD TIANG from the two Pencawang codes in
    canonical form; the crew *verifies against the plate* instead of typing.
  - ❓ **Ask owner:** can TWO distinct feeders connect the same Pencawang pair
    (double circuit)? If yes, `KK - LL` alone is not a unique feeder key and
    the plate presumably carries a disambiguator — the composer needs it.
- **Same split-risk one level down — "New Pencawang" at check-in** is free text
  (name, functional location, code). Two crews can create the same physical
  Pencawang twice with differing codes, and since the SAVT feeder is keyed on
  the From-Pencawang record, a duplicated Pencawang splits routes exactly like
  a mistyped KOD TIANG. Mitigation (Phase B): on "New Pencawang", check the
  typed code against existing Pencawang first ("KK already exists — is it this
  one?") before creating. (Substation.name is already known non-unique — see
  the Deploy-31 gotcha.)
- **GPS radius for candidates**: start ~30 m; the GERIK audit showed GPS noise
  matters — make it a constant, tune after field feedback.
- Naming in the UI: "Tiang kongsi" — confirm wording with the crews.
