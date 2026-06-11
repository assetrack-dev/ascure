# ASCURE — North Star

> The reference for *what ASCURE is*. Every build decision gets measured against this.
> If a feature doesn't serve **legible · navigable · provable · perpetual**, it's seasoning — not ASCURE.
> Drafted 2026-06-09 from first principles with the domain owner. Supersedes the implicit direction baked into the current codebase where they conflict.

---

## 0. The core, in one sentence

**Walk the feeder, name it, see it on a map, prove it with a photo.**

ASCURE is the **authoritative register of TNB's low-voltage supply network** — the Pencawang (substations), the poles, the feeders, and *how they connect* — captured by walking each feeder from source to premises, proven with timestamped photos, and **re-surveyed every year by law**. Everything else (defects, the TNB documents, maintenance, the map) is a *view* of that register at a point in time.

It started with **SAVR** (*Sesalur Atas Voltan Rendah* — LV overhead service cable from a Pencawang to customer premises). Other asset types follow: SAVT, Pencawang, Feeder Pillar, Link Box, Cable Bridge.

## 1. The soul test (apply to every feature)

- **Legible** — the network is human-readable via the NO TIANG RONDAAN sequential system.
- **Navigable** — the network is a real graph the system can traverse (routing, isolation).
- **Provable** — every observation is backed by a timestamped photo / sensor reading.
- **Perpetual** — it's re-surveyed on a legal annual cycle; data compounds year over year.

A feature that doesn't strengthen one of these is a candidate for "drop or defer."

## 2. The spine — three pillars

1. **Asset register (persistent):** PEs, poles, feeders, accessories. The long-lived truth.
2. **Network graph:** `fed-from` edges + feeder membership + **NOP** tie-edges (with switch state). This is what makes the network *navigable* and is the differentiator no spreadsheet/AppSheet can match.
3. **Annual cycle:** Year 1 lays the **baseline** (tag + topology + first condition). Year N **re-surveys** it and records the **delta** (new/removed poles, route or source changes — minimal but real).

## 3. Pole identity (decided)

A pole carries **two** identifiers doing different jobs:

- **NO TIANG RONDAAN** — *our* sequential numbering system; the **structural / ordering key**. **Derived** from structured feeder-membership + branch lineage (not stored as opaque text). Used to **arrange** data and **navigate** the network.
- **NO TIANG LAMA** — the **actual painted label** on the pole (often road-name based in KL, e.g. `JK1 1`); a **captured** value, may be faded/unreadable → recorded as **`TNT`** (Tiada No Tiang). This is what **prints** in reports.

**Rule: arrange by RONDAAN, display LAMA.**

**Storage model (decided): store the structure, render the label.**
- The cross-cycle anchor is an internal **UUID + GPS** — *never* the name string.
- A pole holds a set of `(feeder, index)` memberships + branch lineage.
- `NO TIANG RONDAAN` is **rendered** from that by a canonical formatter (must reproduce TNB's exact format).
- `NO TIANG LAMA` is a captured field (free text / `TNT`).

**A "section (from → to)" in a report IS a graph edge.** The report's sections, the schematic's lines, and the isolation traversal are the *same edges* rendered three ways.

### NO TIANG RONDAAN naming grammar (preserve)
Format: `<FEEDER><SPACE><INDEX>`.
- Basic: `A 1 → A 2 → A 3` (Feeder A, poles 1,2,3).
- Feeders sharing first pole: `CD 1 → CD 2 → …`.
- Feeders converging: `E 1 → E 2 → E 3 & F 1 → E 4 & F 2 → …` (F joins at E's 3rd pole; from there poles carry both, with **per-feeder indices**).
- Junction / T-off: from `B 2` → `B 2/1 → B 2/2 …`. Multiple T-offs off the same pole: `B 4/1` (1st), `B 4/1A` (2nd), `B 4/1B` (3rd).

### Edge capture (decided)
Capture the `fed-from` edge **explicitly**, but **pre-fill** it from the name + GPS proximity (and, from cycle 2, from last year's edge) → one confirm-tap 95% of the time. The edge is *observed truth*, not a parse guess. The rare correction is exactly how a **route change** is detected.

### Topology is a graph, not a tree
Mostly radial (one `fed-from` parent per pole), **plus** occasional **NOP** (Normally Open Point) tie-edges between feeders for back-feed. NOPs are themselves inspected assets. Switching/isolation = "open feeder F's breaker → these poles de-energize → closing NOP-x could back-feed from feeder G." Model = "tree + a few tagged tie-edges with state" (Postgres-friendly; no graph DB needed).

## 4. The one lifecycle (per PE, per cycle)

Lives on the **cycle survey** (the per-cycle visit to a PE), **not** permanently on the PE:

```
DALAM RONDAAN  →  RONDAAN SELESAI  ⟲ PERLU PINDAAN  →  LAPORAN SELESAI  →  ARKIB
(inspecting)      (inspector done)   (DC sends back     (DC generated      (Admin + DC
                                      for amendments)    the report)         only)
```

- Inspector checks in at the PE, inputs PE data, then adds poles (children) and inspects them; marks **RONDAAN SELESAI**.
- **DC** reviews **data quality** (duplicate/wrong RONDAAN, missing photos, naming errors). If issues → **PERLU PINDAAN** (reject + remark) → inspector fixes → back to RONDAAN SELESAI.
- **Report generation is the gate** into **LAPORAN SELESAI** → PE auto-**archived**.
- Next cycle opens a fresh survey against the same persistent poles. *Archive archives the cycle, not the asset.*

**This single machine replaces both the old defect-QA lifecycle and "Operational Sessions."**

## 5. Roles (corrected)

- **Inspector** owns the **defect call** — competence-based, authoritative on submit. No QA approve/reject step.
- **DC (Document Controller)** owns **data-quality + document production**. "Reject" exists **at the survey level** (amendments), never at the defect level.
- **Teams** (buddy system, ~2 people): the **Org (Company) → Team** hierarchy scopes **visibility** (Manager = whole company, Supervisor = their assigned teams); geography is a separate **Region → Mainhead** axis (Branch retired). **Work stays fluid** — controlled cross-team **reassignment** when a team can't finish ([ADR 0002](adr/0002-work-assignment-and-org-hierarchy.md)). Structure for permissions, not choreography.

## 6. Defects + Maintenance = one system

One dataset, real-time (no more manual re-keying into a separate DRS):
- Inspector flags defect on-site → maintenance lifecycle `Open → In Progress → Repaired`.
- Maintenance captures **SEBELUM / SEMASA / SELEPAS** photos per repaired defect (a pole often has several defects).
- **Defect segregation is configurable per Mainhead.** KL Barat example: **RENTIS** (`PENGALIR - Kawasan Perlu Rentis`), **CAT TIANG** (`Nombor Pudar`), **TIER 1** (normal), **TIER 2** (urgent). Other Mainheads differ — definition must be data-driven, not hardcoded.

## 7. The outputs ARE the product (not "Phase 3")

For each PE survey:
- **QR01, QR02, QR03**, **Kelegaan** (ground-clearance) table — TNB's required documents.
- **Schematic drawing** — the network graph rendered (poles, feeders, branches, NOPs).
- **Map** — same nodes with real GPS; planning + avoiding redundant inspection.
- **Isolation / switching view** — graph traversal; the killer, unique feature.
- **Visual reports** — per-pole (inspection, grouped by PE) and per-defect (maintenance, before/during/after).

Reports **arrange by RONDAAN** (so sections/from→to work) and **display LAMA**.

## 8. Field realities to honour

- **Discovery mode:** most Mainheads have no base data — inspection *is* asset creation (tag GPS, name sequentially, inspect, photo). Only a few (KL Barat/Utara/Timur, Shah Alam) have legacy data to import as the Year-1 baseline.
- **Clearance reading** via smart sensor → image → **OCR** the value.
- **Photos require a timestamp overlay** (already solved in AppSheet; keep).
- AppSheet's clarity (PE → pole parent/child, global map, fluid teams) is the soul; the reason to leave AppSheet is **scale**, not dissatisfaction with the model.

## 9. Codebase verdict (re-centering, not rewrite)

- **Keep:** multi-tenant + Org→Team management + Region→Mainhead geography (Branch retired — [ADR 0002](adr/0002-work-assignment-and-org-hierarchy.md)) + capability RBAC; auth/users/teams; asset/PE/AssetType register; dynamic versioned templates; mobile offline + map + timestamp photos + OCR; reports + imports modules.
- **Reframe:** defect-QA lifecycle → maintenance lifecycle; site-visit "validation" → DC survey-amendment flow; **fold Operational Sessions into the PE-survey lifecycle**; teams → visibility-only.
- **Build (the real spine, currently missing):** the network **graph** (edges/feeders/NOP), the **cycle** as first-class, the **document factory**, the **isolation view**.
- **Defer:** SLA/health dashboards; AI validation — both get *more* powerful once graph + cycle exist (naming validation, anomaly detection, completeness, "what changed" diffs).

## 10. Why it drifted (so we don't repeat it)

The current build spent its complexity budget on an **enterprise defect-governance lifecycle** (QA verifies every defect) that the real process doesn't want — while leaving the actual spine (network graph + annual cycle + document factory) unbuilt. The "this isn't ASCURE anymore" feeling was the *visible center* shifting from "walk-the-feeder → map → documents" to governance ceremony. The fix is to put the spine back at the center and demote governance to a thin, honest survey lifecycle.
