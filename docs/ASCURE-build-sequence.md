# ASCURE — Build Sequence

> The re-sequenced build plan. Turns north-star **§9 (codebase verdict)** into a
> concrete, dependency-ordered roadmap, grounded in the code as it actually is.
> Drafted 2026-06-09. Companion to [`ASCURE-north-star.md`](./ASCURE-north-star.md);
> the north-star says *what ASCURE is*, this says *in what order we build it*.

---

## 1. Where the code actually is vs. the spine

The platform shell is real; the **spine is not** — exactly the north-star verdict,
confirmed by inspection:

- **Pole = `Asset`**, flat under `Substation` — [`prisma/schema.prisma`](../prisma/schema.prisma)
  `Asset` has no `parentId`, no feeder FK. NO TIANG RONDAAN is just `Asset.assetCode`
  (a string); NO TIANG LAMA is `Asset.name`/metadata
  ([`apps/mobile/src/assetDisplay.ts`](../apps/mobile/src/assetDisplay.ts)).
- **The RONDAAN grammar is already codified** — [`apps/mobile/src/utils/feederSequence.ts`](../apps/mobile/src/utils/feederSequence.ts)
  parses `<FEEDER> <INDEX>`, multi-feeder `&`, branch `/1`/`/1A`, **derives the
  `fed-from` parent** (`parentKey`), validates sequences, and **builds the graph
  edges** (`buildFeederLines`). But it is *ephemeral* — recomputed client-side from
  the string every render, never persisted. **This is the north-star §3 inversion in
  the flesh: today the string IS the structure; the north-star wants structure
  stored, string rendered.**
- **No `Feeder` model, no persisted edge, no NOP, no isolation.** `feederId` /
  `feederRouteId` are loose `String?` on `SiteVisit` — not relations.
- **Cycle is loose ints** — `SiteVisit.cycleNumber` + `Inspection.inspectionCycle`.
  No first-class survey-cycle, no baseline/delta.
- **Two heavy governance state machines** that the north-star collapses into one:
  the `OperationalSession` machine (~1,533-line service, `DRAFT→…→QA_REVIEW→APPROVED`)
  and the defect-QA apparatus (~3,301-line defects service, 9-state
  `DefectLifecycleStatus`, `canGovernQa`).
- **Document factory:** only F1 (Excel export) exists; QR01/02/03, Kelegaan,
  schematic, isolation, visual reports do not.

## 2. The re-sequenced build

Honours north-star §9's order (**spine → governance → documents**) with one
refinement the code makes obvious:

> **"Relax governance" is not a standalone delete step.** The relaxed governance
> *is* the one PE-survey lifecycle, which is also the cycle. North-star §4 says
> that single machine replaces **both** OperationalSession **and** defect-QA. So
> we don't delete-first and leave a gap — we **build the replacement lifecycle and
> migrate onto it**, retiring the old machinery as part of that phase. That folds
> "relax governance" into the cycle phase rather than floating it separately.

### Phase 0 — Decide & de-risk *(this slice; no prod schema change)*
The single most consequential decision is the graph storage model. Lock it in an
ADR, and stand up the canonical RONDAAN grammar as a shared module — the cheapest,
highest-leverage step, and it makes the Phase 1 migration safe.
- ✅ This build-sequence doc.
- ✅ [ADR 0001 — network graph storage model](./adr/0001-network-graph-storage-model.md).
- ✅ `@ascure/shared-utils` canonical RONDAAN module: proven parser lifted from
  mobile **+ the new formatter** (`formatRondaan` — structure→string, the "render
  the label" half of §3 that did not exist anywhere). Compile- and round-trip-
  verified against every §3 grammar example.
- ⏳ **Deferred to the Phase 1 opener** (deliberately, to not destabilise the live
  pilot build): wiring consumers onto the package — API import for the server-side
  formatter, and the mobile swap (`metro` `watchFolders` + delete the duplicate
  `feederSequence.ts`). Neither mobile nor admin consumes any workspace package
  today, so this is net-new cross-toolchain plumbing and gets built + build-verified
  with its consuming code, not rushed.

### Phase 1 — Network graph *(the keystone, the differentiator)*
Persist pole structure `(feeder, index, branch)` + LAMA as real fields; persist the
radial **`fed-from` edge** (pre-filled from the parser, one-tap confirm per §3);
server-side **canonical RONDAAN formatter** (from `@ascure/shared-utils`) validated
to reproduce TNB's exact format against live data; **NOP tie-edges + switch state**.
Unlocks map/schematic/isolation and report "from→to" sections (which *are* edges).
*Opener: wire the shared module into API + mobile (the Phase 0 deferred item).*

### Phase 2 — Annual cycle + the one lifecycle *(governance relaxes here)*
Promote the cycle survey to first-class with
`DALAM RONDAAN → RONDAAN SELESAI ⟲ PERLU PINDAAN → LAPORAN SELESAI → ARKIB`; fold the
OperationalSession machine into it; demote defect-QA to inspector-owns-the-call + DC
survey-level amendments; the **maintenance** lifecycle (`Open→In Progress→Repaired` +
SEBELUM/SEMASA/SELEPAS) survives. Year-N re-survey opens a fresh survey against
persisted poles and computes the **delta** — only possible *because* Phase 1
persisted the structure.

**Slice 2a — the lifecycle spine (landed 2026-06-10).** The cycle survey lifecycle
is now first-class on `SiteVisit`:
- ✅ Schema: `SurveyLifecycleStatus` enum + `SiteVisit.lifecycleStatus`/transition
  timestamps/`amendmentRemark` + `SiteVisitLifecycleEvent` audit model (one row per
  transition — the OperationalSession machine never had this). Additive migration
  `20260610100118_add_survey_lifecycle`; new visits open in `DALAM_RONDAAN`, legacy
  rows stay `null` and join the lifecycle on their first transition.
- ✅ API: `SurveyLifecycleService` + `POST /site-visits/:id/lifecycle/{rondaan-selesai,
  request-amendment,generate-report,archive}`. Role gates map to existing authority:
  inspector = not-VIEWER/CLIENT (owns RONDAAN SELESAI), **DC = `isQaActor`** (owns
  PERLU PINDAAN amendment + ARKIB), **report-gen = `REPORTING`** (gate into LAPORAN
  SELESAI). Each transition is guard-validated and appends an event.
- ✅ Admin UI: a Survey Lifecycle panel on the site-visit detail (stepper, role-gated
  actions, PERLU PINDAAN remark box, history timeline).
- **Demote-not-delete (deliberate, live pilot):** this slice *establishes the
  replacement spine* and folds the governance relaxation (the DC reject now lives at
  the survey level as PERLU PINDAAN). It does **not yet retire** the OperationalSession
  machine or strip the defect-QA verify/reject/closure gates — those migrate onto this
  lifecycle in a follow-up so the pilot is never left with a gap.
- **Deferred to Slice 2b:** Year-N re-survey + **delta** (new/removed poles, route/
  source change); mobile wiring of the inspector's RONDAAN SELESAI; attaching the
  generated report artifact (ties into Phase 3 document factory).

**Slice 2b.1 — year-N re-survey + delta (landed 2026-06-10).** The "perpetual"
pillar made real, purely additive:
- ✅ `POST /site-visits/:id/open-next-cycle` — opens a fresh survey against the same
  persistent poles, mirroring the prior survey's substation/team/links with
  `cycleNumber + 1`, `visitType = REINSPECTION`, opened in `DALAM_RONDAAN`. Archive
  archived the *cycle*, not the asset.
- ✅ `GET /site-visits/:id/cycle-delta` — compares the poles **observed** (created
  during / linked to / inspected in) this cycle against the prior cycle survey for
  the same Pencawang → **new / removed / carried** poles. `isBaseline` when there is
  no prior cycle. Verified end-to-end: a re-survey that dropped one pole and added
  another reported the delta correctly, including a removed pole observed only via an
  inspection link in the prior cycle.
- ✅ Admin UI: an "Open next cycle (re-survey)" action on an archived survey
  (navigates to the fresh cycle) + a Cycle Comparison card (new/removed/carried
  counts + pole lists).
- **Still deferred (Slice 2b.2+):** **route/source-change** detection (needs per-cycle
  edge snapshots — the current graph stores only *current* fed-from/feeder, not
  history); **retire the old machines** (fold OperationalSession; strip defect-QA
  verify/reject/closure → inspector-owns-the-call); mobile RONDAAN SELESAI; report
  artifact (→ Phase 3).

**Slice 2b.2 — inspector owns the defect call (landed 2026-06-10).** The north-star
§5/§6/§10 governance relaxation, done *reversibly* (a policy flag, not a delete):
- ✅ `DEFECT_GOVERNANCE_MODE` env policy (`common/authorization/defect-governance.ts`),
  default **`INSPECTOR_OWNS`**, legacy **`QA_GATED`** retained.
- ✅ Under INSPECTOR_OWNS a freshly-materialized defect opens **`VERIFIED`**
  (maintenance-ready) instead of `DETECTED` — it skips the QA verify/reject gate, so
  the inspector's detection is the authoritative call. New defects land in
  "Maintenance Ready", not "Awaiting QA/QC". Verified end-to-end: a fresh `isDefect`
  item result materialized straight to `VERIFIED`.
- ✅ Closure no longer needs a separate QA actor — the **assigned maintainer** (or
  DC / admin) may close (`assertCanCloseDefect`); QA_GATED keeps the QA requirement.
- The legacy QA verify/reject/closure code paths are intact behind the flag (reversible),
  and legacy `DETECTED` defects still flow through the QA queue. Nothing deleted.
- **Still deferred:** formally **fold/retire OperationalSession** (already optional —
  the survey lifecycle is its replacement); a UI indicator of the governance mode;
  route/source-change delta; mobile RONDAAN SELESAI; report artifact (→ Phase 3).

**Slice 2b.3 — F2 foundation import + date-driven cadence (landed 2026-06-10).**
The AppSheet importer becomes the **Year-1 baseline** loader (north-star §8), and the
cycle is reframed around dates, not counters:
- ✅ **Importer adopted + foundation-ified.** Each imported survey lands in **ARKIB**,
  type **DISCOVERY**, dated from the source 2025 inspection — a finished historical
  cycle the field team re-opens with "Open next cycle."
- ✅ **Imported defects = unverified historical baseline.** The defect materializer
  skips AppSheet-import inspections (`reportingGroup` prefixed `APPSHEET:`, null-safe
  filter in `defects.service`), so 2025 defects are recorded observations, **not live
  maintenance work**. The 2026 re-inspection establishes current truth, and the delta
  reconciles (present-2025/not-2026 ⇒ presumed cleared). This respects "provable": a
  defect cleared by an untracked third party can't be asserted fixed.
- ✅ **Date-driven cadence.** `common/inspection-cadence.ts` derives *last inspected /
  months since / on-time·due-soon·overdue* against a configurable statutory interval
  (`ANNUAL_SURVEY_INTERVAL_MONTHS`, default 12). Surfaced on `cycle-delta` and in the
  admin ("Last inspected: 14 Mar 2025 · 14 months ago · Overdue") in place of the
  abstract "Cycle N"; `cycleNumber` stays a quiet internal sequence. Verified:
  2025-dated → OVERDUE, recent → ON_TIME; foundation defect not materialized while a
  normal one still is.
- ✅ **Imported poles now feed the network graph (2026-06-10).** `AssetsService.
  syncPoleGraph` was split into `syncPoleMemberships` + `syncPoleFedFrom`, and a
  batch `syncImportedPolesGraph` (all memberships first, then all fed-from — so a
  parent's membership exists before its children resolve) runs inside the import
  transaction. So imported poles get feeders + memberships + fed-from + the
  first-class `noTiangLama`, and appear on the schematic / map / isolation views.
  Also removed the importer's eager `Defect` creation (it bypassed the materializer
  skip) — completing "imported defects = historical observation, not live work".
- ✅ **Admin import UI (2026-06-10).** `/imports` page: upload a SAVR KLB `.xlsx`,
  Validate (dry-run → plan: summary counts, template/file info, user/team/mainhead
  resolution, per-row issues, blocking errors), then Commit. Multipart upload via a
  dedicated `lib/imports.ts` (own fetch — `apiRequest` forces JSON). Gated by a new
  server `canImport` flag (ADMIN or IMPORT capability) on login + `/auth/me`, mirroring
  `canReport`; nav item gated to match.
- **Still deferred:** per-pole (vs per-survey) last-inspected; defect-level delta.

### Phase 3 — Document factory + isolation view *(the outputs ARE the product)*
Schematic (graph render), isolation/switching traversal, QR01/02/03, Kelegaan,
per-pole + per-defect visual reports; report-gen becomes the gate into
LAPORAN SELESAI (ties back to Phase 2). Reuse F1's data resolver.

### Deferred *(unchanged from §9)*
SLA/health dashboards; AI validation (naming checks, anomaly detection,
completeness, "what changed" diffs) — both get sharper once graph + cycle exist.

## 3. Dependency rationale (why this order)

- **Graph before cycle-delta:** "what changed year over year" (new/removed poles,
  route/source change) is a diff of *persisted structure*. No persisted edge → no
  honest delta. (The cycle *lifecycle* state machine could be built in parallel; the
  cycle's *value* depends on the graph.)
- **Cycle before/with governance-relax:** they share one state machine (see §2).
- **Documents last:** schematic, isolation, and report "from→to" sections all render
  *persisted edges*; report-gen gates the cycle lifecycle. Everything downstream
  lands on the graph + cycle.

## 4. Open questions / risks (carried into Phase 1)

- **Multi-feeder convergence physical parent.** A pole `E 4 & F 2` has two *naming*
  predecessors (per feeder) but one *physical* `fed-from` span. Confirm a single
  `fedFromAssetId` is sufficient, or whether per-membership parents are needed for
  isolation accuracy. (ADR 0001 §"Open questions".)
- **Formatter fidelity at corpus scale.** `formatRondaan` reproduces every §3 grammar
  example, but the combined-`CD` vs `&` collapse rule and converged-feeder ordering
  (assumed alphabetical) must be re-validated against the **full KL dataset** once it
  is in the DB (Phase 1 backfill is the moment to do this).
- **Mobile build is finicky and the pilot is live.** The shared-module wiring touches
  metro; it is sequenced into Phase 1 precisely so it is done + verified deliberately,
  not under pilot pressure.
