# ADR 0003 — Per-cycle RONDAAN & pole identity (deferred to the cycle boundary)

- **Status:** Proposed (2026-06-18) — design locked; the model change is **deliberately deferred** to the cycle-1 → cycle-2 boundary. A small run-critical UX slice ("Phase 0", below) is built now.
- **Context refs:** [north-star](../ASCURE-north-star.md) (RONDAAN = *arrange* vs LAMA = *display*; annual cycle), [ADR 0001](./0001-network-graph-storage-model.md) (network graph / per-cycle edge snapshots), [ADR 0002](./0002-work-assignment-and-org-hierarchy.md)
- **Decision owner:** domain owner + build
- **Supersedes:** nothing; refines how pole identity and sequence are modelled across cycles

---

## Context

A pole is inspected **every annual cycle**. One physical pole → many inspections over time. Today the mobile flow captures two numbers, both stored as **permanent Asset fields**:

- `asset.assetCode` = **NO TIANG RONDAAN** — the pole's position in that cycle's patrol/route sequence.
- `asset.name` = **NO TIANG LAMA** — the pole's legacy/display tag.

Two facts make this wrong **across cycles** (it is fine within a single cycle):

1. **RONDAAN is per-cycle, not a property of the pole.** When the route changes between cycles — pole added/removed, power source changed, route re-walked — the *same physical pole* gets a *different* RONDAAN. Storing it on the asset means a cycle-2 sequence change must **overwrite** the asset code, destroying cycle-1's recorded sequence (a history-integrity loss, not just UX).
2. **NO TIANG LAMA is not a stable identity.** Many poles have no legible tag and are recorded as **TNT (Tiada No Tiang)**; tags fade and get re-tagged. LAMA changes over time, so it cannot be the cross-cycle key.

There is therefore **no reliable human-readable key** for a pole. And the field reality has **two coexisting workflows** that both must be supported:

- **Workflow 1 — interleaved:** Add → Inspect → Add → Inspect …
- **Workflow 2 — batch:** Add all poles (tag the route) → then Inspect each.

## Decision

### 1. Identity = the record + GPS, never the numbers
A pole's stable identity is its **system id (the durable key)** anchored in the real world by **GPS location** + its inspection history. `NO TIANG LAMA` and `NO TIANG RONDAAN` are reclassified as **mutable captured observations**, never identity.

### 2. RONDAAN moves to the per-cycle layer
Capture RONDAAN on the **per-cycle layer** (the `Inspection`, or a per-cycle route-membership row), so each cycle preserves its own sequence and history is never overwritten. The Asset may cache a "latest RONDAAN" for display, but the per-cycle row is the source of truth.

### 3. LAMA is a mutable per-visit observation
Allow `TNT` and per-visit changes to LAMA without touching the pole's identity. Editing LAMA never re-keys the pole.

### 4. Cycle-2 entry = spatial reconcile, not number lookup
Re-walking the route in cycle 2 surfaces **poles near the user's GPS**; the user **confirms "this is the existing pole"** or **adds a new one**. Matching is spatial + human-confirmed (with a tolerance), because no number is dependable. This ties into the **per-cycle edge-snapshot / Year-N delta** work (ADR 0001) — sequence is route order, which is graph order.

### 5. Migrate at the cycle boundary, not mid-pilot
The model change is **deferred to between cycle 1 and cycle 2**, for concrete reasons:
- The current model is **correct and lossless for cycle 1** (one cycle ⇒ `asset.assetCode` *is* the cycle-1 RONDAAN; nothing is being corrupted now). The loss only begins at the first cycle-2 overwrite.
- The cycle boundary is **also when the design can be done right** — with a finished cycle-1 dataset (clean one-time backfill: `cycle-1 inspection.rondaan = asset.assetCode`) and real field learnings (how often LAMA is TNT, pole density, how routes actually change) to tune the spatial match.
- Doing it now would be an **unvalidatable** change (no cycle 2 exists to test spatial re-match against), a **hard-to-reverse structural migration** on live data (vs. the additive migrations used so far), with an **app-wide blast radius** (`assetCode`/RONDAAN is wired into map markers, asset list, inspection form, report columns, masterlist exports, defect & maintenance screens), and it **entangles the unbuilt network-graph edge-snapshot spine** — i.e. it is a coordinated spine effort (~1–2 weeks), not an isolated change. The trade — destabilising a working pilot to solve a problem a year away — is bad.

### 6. The two workflows are a state machine (built now — Phase 0)
The field flow is a state machine: **tagged → inspected → (defects)**. Both workflows are just traversal orders over it. Two changes deliver this without any model change, so they ship now:
- **Add-Asset fork:** "Save & inspect" (Workflow 1) and "Save & add another" (Workflow 2) — no mode switch; the crew picks per pole. "Save & add another" returns to the map, which already shows tagged-vs-inspected state via the **red (tagged) → lime (inspected)** markers, so the batch sweep is visible.
- **`createInspection` idempotency per (asset, site-visit):** opening/inspecting a pole that already has an inspection this visit returns the existing one instead of minting a duplicate cycle (fixes the "Inspection button spawns a new cycle on every tap" bug).

## Consequences

**Positive**
- Per-cycle history is preserved; identity is robust to unreliable LAMA/RONDAAN.
- Both field workflows are first-class; the map red/lime is the batch progress view.
- The full model is captured and ready to build at the right moment, with real data.

**Costs / risks (for the deferred model change)**
- Spatial re-match needs threshold tuning against real cycle-2 data (GPS drift; dense pole clusters).
- `assetCode`-as-RONDAAN is wired across the app; the boundary migration must update every consumer + run a backfill + full regression.
- Couples to ADR 0001's per-cycle edge snapshots — sequence it with the graph spine.

**Built now (Phase 0, no schema change):** Add-Asset fork + `createInspection` idempotency per (asset, visit). Everything else in this ADR is deferred to the cycle boundary.
