# ADR 0001 — Network graph storage model

- **Status:** Proposed (2026-06-09)
- **Context refs:** [north-star §2–§3](../ASCURE-north-star.md), [build sequence Phase 1](../ASCURE-build-sequence.md)
- **Decision owner:** domain owner + build

---

## Context

The network graph is the spine's keystone and the differentiator no
spreadsheet/AppSheet can match (north-star §2). It does not exist in storage today.
What exists instead is an **inversion**:

- A pole is an `Asset`, flat under a `Substation`, with **no parent and no feeder FK**.
- NO TIANG RONDAAN is stored as the `Asset.assetCode` **string**; the *structure*
  (feeder, index, branch lineage, parent) is **parsed back out of that string on the
  client every render** ([`feederSequence.ts`](../../apps/mobile/src/utils/feederSequence.ts))
  and never persisted.

North-star §3 decides the opposite: **store the structure, render the label.** The
cross-cycle anchor is an internal **UUID + GPS — never the name string**. This ADR
fixes how that structure is stored so the Phase 1 migration is safe and the rest of
the spine (delta, schematic, isolation, report sections) has a foundation.

## Decision

Keep `Asset` as the pole (north-star: keep the asset register) and add the graph
*around* it. Single canonical home for the render logic is `@ascure/shared-utils`
(`formatRondaan`), built in Phase 0.

### 1. Pole identity moves off the string
Add to `Asset`:
- `noTiangLama String?` — the captured painted label; `"TNT"` (Tiada No Tiang)
  allowed. (Today this lives in `name`/metadata.)
- `fedFromAssetId String? @db.Uuid` + self-relation — the **physical radial parent**
  (the conductor span feeding this pole). **Observed truth, captured explicitly**,
  pre-filled from the parser's `parentKey` + GPS proximity (+ last cycle). `null` at
  a feeder head (fed from the feeder breaker). The rare correction is exactly how a
  **route change** is detected (north-star §3).

`Asset.id` (UUID) + `latitude`/`longitude` are the cross-cycle anchor. **`assetCode`
is kept during/after migration as a *rendered mirror* of `formatRondaan(...)`** for
back-compat, not as the source of truth.

### 2. Feeder becomes a first-class entity
```prisma
model Feeder {
  id           String  @id @default(uuid()) @db.Uuid
  tenantId     String  @db.Uuid
  substationId String  @db.Uuid   // the Pencawang the feeder originates from
  code         String              // canonical single token: "A","B","E","F"…
  name         String?
  isActive     Boolean @default(true)
  @@unique([substationId, code])
}
```
**`code` is a single canonical feeder token.** `"CD"` is **not** a stored feeder —
it is a render-time *combine* of the C and D memberships that share an index
(`formatRondaan`). The parser splits `"CD 1"` into `{C,1}+{D,1}`; the formatter
recombines. Preserve that symmetry.

### 3. Pole↔feeder membership (multi-feeder, per-feeder index)
```prisma
model PoleFeederMembership {
  id            String @id @default(uuid()) @db.Uuid
  assetId       String @db.Uuid   // the pole
  feederId      String @db.Uuid
  sequenceIndex Int               // per-feeder index (the parser's baseNumber)
  branchSuffix  String @default("")  // canonical lineage: "" | "/1" | "/2/1A"
  @@unique([feederId, sequenceIndex, branchSuffix]) // one pole per slot on a feeder
  @@unique([assetId, feederId])                     // a pole appears once per feeder
}
```
A pole's RONDAAN is rendered by `formatRondaan(memberships.map(m => ({
feeder: feeder.code, index: m.sequenceIndex, branchParts: parse(m.branchSuffix) })))`.
This is what makes `E 4 & F 2` (two memberships, different indices) and `CD 1` (two
memberships, shared index) both fall out of one mechanism.

### 4. NOP tie-edges (the isolation differentiator)
Radial tree = `Asset.fedFromAssetId`. The **exceptions** — Normally Open Points for
back-feed — are a separate tagged edge with state. NOPs are themselves inspected
assets.
```prisma
enum TieEdgeKind { NOP }
enum SwitchState { OPEN CLOSED }

model NetworkTieEdge {
  id            String      @id @default(uuid()) @db.Uuid
  tenantId      String      @db.Uuid
  fromAssetId   String      @db.Uuid
  toAssetId     String      @db.Uuid
  kind          TieEdgeKind @default(NOP)
  switchState   SwitchState @default(OPEN)   // NOP = normally OPEN
  deviceAssetId String?     @db.Uuid         // the NOP device's own Asset row
}
```
Model = "tree + a few tagged tie-edges with state" (north-star §3) — Postgres-
friendly, **no graph DB**. Isolation = traverse `fedFromAssetId` down from a feeder
breaker; back-feed = the `CLOSED`-able NOP edges.

### 5. Sequence edges are derived, not stored
The per-feeder "from→to" ordering (report sections, the radial map draw along a
feeder) is **implied by consecutive `sequenceIndex` values** and produced by the
existing `buildFeederLines` logic. Only the **physical `fed-from`** and **NOP** edges
are stored, because those are *observed truth* whose divergence from the parse-implied
parent is the signal we care about (route change).

## Alternatives considered

- **(A) Parent column only; derive feeders from the string (status quo+).** Rejected:
  keeps the §3 inversion (string as source of truth), can't store the captured
  `fed-from` correction, no feeder entity for isolation.
- **(B) One generic edge table for everything / a graph DB.** Rejected: over-built
  for a mostly-radial LV network; north-star explicitly says tree + tagged tie-edges,
  no graph DB. Radial parent as a column is simpler and faster to traverse.
- **(C) Branch lineage as JSON `branchParts[]` on the membership.** Viable, more
  queryable, but the canonical `branchSuffix` string ("/2/1A") is lossless, directly
  renderable, and round-trips through the parser. Chose the string; can add a parsed
  view later if querying by branch level is needed.
- **(D) Drop `assetCode`, render-only.** Deferred: keeping `assetCode` as a rendered
  mirror preserves every existing read path during migration; we can retire it once
  all consumers read `formatRondaan`.

## Consequences

- **Migration / backfill (Phase 1):** for each pole, parse the legacy `assetCode` with
  `@ascure/shared-utils` → upsert `Feeder` rows (per substation, per feeder token) →
  create `PoleFeederMembership` rows → pre-fill `fedFromAssetId` from the parser's
  `parentKey` (left unconfirmed until a human/closing pass confirms) → set `noTiangLama`
  from `name`/metadata → keep `assetCode = formatRondaan(...)`. Invalid/duplicate codes
  surface via the parser's existing validation (`validateFeederSequences`) for cleanup,
  not silent loss.
- **Back-compat:** existing reads of `assetCode` / `name` keep working; new reads move
  to memberships + `noTiangLama`.
- **Isolation, schematic, delta** all become possible (they consume persisted edges).
- **Cost:** three new tables/relations + a backfill; the formatter must be corpus-
  validated (below).

## Open questions (resolve during Phase 1)

1. **Convergence physical parent.** Is a single `fedFromAssetId` per pole sufficient
   for `E 4 & F 2` poles, or do isolation cases need a parent *per membership*? Decide
   against real KL topology before finalising the column vs. a per-membership edge.
2. **Feeder source/breaker node.** Represent a feeder head's source as `fedFromAssetId
   = null` + index-1 membership, or model the feeder breaker as an explicit node?
   (Affects how cleanly isolation starts "at the breaker".)
3. **Formatter fidelity at scale.** Re-validate the combined-`CD` vs `&` collapse and
   the converged-feeder ordering (assumed alphabetical) against the **full KL corpus**,
   not just the §3 grammar examples, at backfill time.
4. **NOP device asset placement.** Confirm a NOP's own `Asset` (its `AssetType`) and how
   `deviceAssetId` relates to the two poles it ties.
