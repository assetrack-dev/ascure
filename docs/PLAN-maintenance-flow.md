# PLAN — Maintenance Flow (Kejanggalan → repaired → closed → claimed)

Status: **APPROVED 2026-09-26 — M1 unblocked; minor open Qs in §9 (Q2/Q7/Q8).** No code yet.

Goal: every Kejanggalan the surveyor reports gets closed by a maintenance company
(or TNB where necessary), as fast as possible. ASCURE helps TNB hand out work,
helps the contractor plan and find the poles, captures proof of repair, and
produces one PDF per Pencawang for the contractor's claim.

---

## 1. Locked decisions (owner, 2026-09-26)

| # | Decision |
|---|---|
| A1 | **TNB assigns a Pencawang (PE) to a maintenance COMPANY.** The company's Manager assigns its own teams. |
| A2 | Unit = **whole PE** by default; optional **split by work type** (Rentis / Cat Tiang / Selenggaraan). No per-Kejanggalan split. |
| A3 | ASCURE **Admin can assign on TNB's behalf** until TNB users are onboarded. |
| B4 | Maintenance sees Kejanggalan only after **LAPORAN SELESAI**; **emergencies instantly**. |
| B5 | Existing open Kejanggalan on PEs already at LAPORAN SELESAI become assignable packages. |
| C6 | Evidence per Kejanggalan: **BEFORE + AFTER required, DURING optional.** |
| C7 | Evidence is **per Kejanggalan** (not shared across Kejanggalan on the same pole). |
| C8 | Closure verified by **TNB, Main Contractor, or Admin.** |
| C9 | "Cannot repair" + reason is a valid outcome → goes back to TNB. |
| D10 | Contractor: **Manager** assigns PE/work to teams; **Supervisor** may see all teams in the company; **Technician** sees own team only. |
| D11 | TNB ranks: **Engineer, Foreman, Technician** (TNB Technician outranks Foreman). Engineer/Foreman mostly web; Technician on site → mobile. |
| E12 | One PDF per PE listing every Kejanggalan with before/after photos. TNB's official format to follow (owner to obtain) — build an interim layout now. |
| E13 | Proof of work only. Rates/amounts later. |
| F14 | Surveyor re-inspects in the next cycle (official). Every Kejanggalan keeps a **track record**: first surveyed → released → assigned → repaired → closed → (next cycle) confirmed / recurred. |

---

## 2. What already exists (reuse, don't rebuild)

- **Release on report** — `DEFECT_GOVERNANCE_MODE=RELEASE_ON_REPORT` (`common/authorization/defect-governance.ts`, `defects/defect-release.util.ts`). Defects open DETECTED (dormant), promote to VERIFIED at LAPORAN SELESAI, emergencies VERIFIED at once. Deployed (Deploy 32) but **dormant** — prod runs INSPECTOR_OWNS.
- **Routing stamp** — `Defect.maintenanceOrganizationId`; today its source is `Mainhead.maintenanceOrganizationId` (auto). Cross-company visibility via `defectAccessScope` + `ScopeContext.maintenanceOrgIds` (own org + active contractor subtree).
- **Maintenance workspace** — `GET /defects/maintenance-workspace`: PE packages → work-type lanes, bulk team assign (`PATCH /defects/maintenance-workspace/assign`). Web only.
- **Delegate to subcontractor** — `PATCH /defects/:id/delegate`.
- **Lifecycle** — `DefectLifecycleStatus` DETECTED→VERIFIED→ASSIGNED→IN_PROGRESS→COMPLETED→VERIFICATION_PENDING→CLOSED (+REJECTED); `ResolutionOutcome` already has EXTERNAL_CONSTRAINT / DEFERRED / ESCALATED etc.; `DefectTimelineEvent`.
- **Evidence** — `DefectEvidenceImage` (evidenceType string, lat/lng, timestamp) + photo/video upload.
- **TNB org** — `OrganizationType.TNB`, `OrganizationMainhead` (which mainheads TNB owns), read-only client scope (`resolveClientScope`, fails closed).
- **Supervisor ↔ team** — `TeamSupervisor` (linking a supervisor to all company teams = "sees all teams", no code needed).
- **Mobile** — maintenance-authority gate, manager dispatch card, clustered map layers, offline read-cache/write-queue, GPS/time photo burn-in.
- **PDF** — pdf-lib code-owned layout of Laporan Kejanggalan (Kad Kerja) — template for the repair report.

---

## 3. Gaps to build

1. **TNB can act.** Today every TNB/CLIENT user is read-only (`assertCanMutate` blocks CLIENT). Need TNB ranks + permissions (§4).
2. **Maintenance package** = TNB's assignment of a PE (per survey cycle) to a company, optionally per work type. Replaces the Mainhead auto-registry as the source of `Defect.maintenanceOrganizationId` (§5).
3. **Closure authority** = TNB / Main Contractor / Admin (today: ADMIN or ASCURE QA actor only in QA mode; assigned maintainer in INSPECTOR_OWNS).
4. **Before/During/After evidence** + completion gate + anti-fraud checks (§6).
5. **Mobile maintenance mode** for contractor technicians, and a **verification mode** for TNB technicians (§7).
6. **Repair report PDF per PE** (§8).
7. **Track record** view + next-cycle reconcile (§5.4).
8. Activation + backfill of existing data (§10).

---

## 4. Roles & permissions

### 4.1 Contractor (MAIN_CONTRACTOR / SUBCONTRACTOR) — existing `UserRole`
| Role | Sees | Can |
|---|---|---|
| MANAGER | all packages routed to own company + subcontractor subtree | assign package/lane → team, delegate to subcontractor, **verify closure (main contractor only)**, download report |
| SUPERVISOR | teams linked via TeamSupervisor (link all = whole company) | update work, upload evidence, mark done / cannot repair, download report |
| TECHNICIAN | own team's assigned work | locate poles, update work, upload evidence, mark done / cannot repair |

### 4.2 TNB — new rank, **not** the contractor `UserRole`
TNB "Technician" means something different from a contractor Technician, so do
not overload `UserRole`. Proposal: TNB users keep a non-admin role and gain a
`clientRank: ENGINEER | TECHNICIAN | FOREMAN` (new enum on `User`; the existing
`MainheadAccessRole` has ENGINEER/SENIOR_TECHNICIAN/FOREMAN but is per-mainhead
access metadata — decide in §9 whether to reuse it). Scope stays
`OrganizationMainhead` (TNB sees only its own mainheads).

Permission matrix (**locked 2026-09-26, corrected by owner**):
| Action | Engineer | Technician | Foreman |
|---|---|---|---|
| View packages, map, track record, reports | ✅ | ✅ | ✅ |
| Assign / reassign PE → company (incl. unrouted emergencies) | ❌ | ✅ | ✅ |
| Verify closure / reject repair | ❌ | ✅ | ✅ |
| Re-open a closed Kejanggalan | ❌ | ✅ | ✅ |
| Decide "cannot repair" items | ❌ | ✅ | ✅ |

Engineer = **view only**.

`assertCanMutate` becomes rank-aware for TNB (only the maintenance actions
above), never opening survey/inspection mutations to TNB.

---

## 5. Data model

### 5.1 `MaintenancePackage` (new)
One row = one PE survey cycle (SiteVisit) assigned to one company, optionally one work type.
```
MaintenancePackage
  id, tenantId
  siteVisitId        -> SiteVisit (the surveyed PE cycle; carries substation + mainhead)
  category           MaintenanceCategory?   -- null = whole PE (all lanes)
  maintenanceOrganizationId -> Organization (MAIN_CONTRACTOR/SUBCONTRACTOR)
  status             OPEN | IN_PROGRESS | COMPLETED | CLOSED
  assignedByUserId, assignedAt
  dueDate?           -- optional target date set by TNB
  notes?
  @@unique(siteVisitId, category)
```
Rules: a whole-PE row and per-category rows are mutually exclusive for one
siteVisit. Assigning stamps `Defect.maintenanceOrganizationId` on every VERIFIED
defect in scope (reusing the existing stamp, so `defectAccessScope`, workspace,
delegate all keep working unchanged). Reassign = restamp + reset work state
(same rules as `delegateDefect`) for Kejanggalan with NO evidence yet; ones already evidenced stay with the original company (§9 Q3).

`Mainhead.maintenanceOrganizationId` (auto-route) becomes an optional **default
suggestion** in TNB's assign screen rather than an automatic route.

### 5.2 Emergencies
Emergencies release instantly. If the PE already has a package → route to that
company; else → unrouted emergency queue, TNB Foreman / TNB Technician / Admin assign manually (§9 Q4).

### 5.3 Lifecycle (per Kejanggalan)
```
DETECTED (surveyed, dormant)
  └─ LAPORAN SELESAI ─→ VERIFIED (released, awaiting TNB package)
        └─ package assigned → company pool  (still VERIFIED, maintenanceOrganizationId set)
              └─ Manager assigns team ─→ ASSIGNED
                    └─ first BEFORE photo ─→ IN_PROGRESS
                          ├─ BEFORE+AFTER, "Done" ─→ VERIFICATION_PENDING
                          │     ├─ TNB / Main Contractor / Admin verifies ─→ CLOSED
                          │     └─ rejected (reason) ─→ IN_PROGRESS (back to team)
                          └─ "Cannot repair" + reason ─→ VERIFICATION_PENDING (outcome EXTERNAL_CONSTRAINT/ESCALATED)
                                └─ TNB decides: close as not-repairable / keep open (TNB owns) / send back
```

### 5.4 Track record
Every transition already writes a `DefectTimelineEvent`. Add a **track-record view**
per Kejanggalan and per pole: surveyed (date, inspector, survey photo) → released →
package assigned (by, to) → team assigned → started → repaired (before/after) →
closed (by, rank) → **next cycle**: when the cycle-N+1 inspection of the same pole
answers the same template item, stamp `CONFIRMED_FIXED` (PASS) or `RECURRED` (FAIL,
link the new defect to the old). Needs `Defect.previousDefectId?` + two timeline
event types.

---

## 6. Evidence & anti-fraud

- `evidenceType` ∈ `BEFORE | DURING | AFTER` (keep legacy MAINTENANCE_PROOF/EMERGENCY readable).
- Completion gate (server): ≥1 BEFORE and ≥1 AFTER on that defect, else 400.
- Photos taken **in-app camera only** (no gallery) with the existing GPS + time burn-in.
- Server flags (not blocks) for review: AFTER timestamp not later than BEFORE;
  BEFORE→AFTER gap under a threshold; photo GPS far from the pole. Lesson from the
  Gerik audit: **time gap** is the signal, distance alone is not.
- Verifier sees before/after side by side + the original survey photo.

---

## 7. Mobile

### 7.1 Contractor maintenance mode (Technician/Supervisor/Manager)
- **My packages** — PE list with open / in-progress / done counts, due date.
- **Package map** — only poles with open Kejanggalan, coloured by status, filter by
  work type / Kejanggalan type; clustered GPU layer (never per-pole MarkerViews).
- **Pole sheet** — Kejanggalan list with the survey photo + severity; "Navigate"
  (Google Maps intent); per Kejanggalan: Before → (During) → After → Done / Cannot repair.
- **Offline** — package + photos cached before going to site; evidence + status
  queued and synced later (reuse the write-queue + temp-ID reconciler).
- Manager: assign package/lane to team from mobile (extend the dispatch card).

### 7.2 TNB mode (Technician on site; Engineer/Foreman mostly web)
- Pending-verification list + map; before/after side by side; Verify / Reject (reason).

Ships via APK (and the next APK already carries other pending mobile work).

---

## 8. Repair report (per PE)

- One PDF per PE package: header (PE, mainhead, company, team(s), dates, status
  counts) + one block per Kejanggalan: pole id/number, GPS, Kejanggalan, severity,
  survey date, BEFORE / AFTER (DURING if any) photos with stamps, repaired by/date,
  verified by/date. "Cannot repair" items listed with reason.
- pdf-lib code-owned layout (like Laporan Kejanggalan); photos downscaled with sharp.
  ⚠ StandardFonts are WinAnsi-only.
- Downloadable by contractor Manager/Supervisor, TNB, Admin. Available any time
  (marked DRAFT until all Kejanggalan are CLOSED).
- Swap to TNB's official format when the owner provides it.

---

## 9. Questions

Resolved 2026-09-26:
- Q1 TNB matrix → as §4.2 (Foreman + Technician assign, verify, re-open, decide cannot-repair; Engineer view-only).
- Q3 Reassign after work started → **yes**; only Kejanggalan with no evidence move, done work stays credited to the original company.
- Q4 Emergency with no package → **manual** assignment by TNB Foreman / TNB Technician / Admin (unrouted emergency queue).
- Q5 TNB may **re-open** a contractor-closed Kejanggalan (→ back to IN_PROGRESS, timeline event, reason required).
- Q6 Due date → **one target date per package, set by TNB** (no per-severity SLA).

Resolved later:
- Q2 TNB rank storage → new `User.clientRank` (built M1 step 1).
- Q7 Repair report download → **contractor Manager / Supervisor only** (+ TNB, Admin); Technicians do not (owner, 2026-10-07).

Still open:
- Q8 Photo time-gap threshold for the fraud flag — **on hold** (owner, 2026-10-07); flags off until set — M2/M3.

---

## 10. Activation & backfill (prod)

1. Dry-run counts on prod: open defects by lifecycle × visit status.
2. Defects on visits **not yet** at LAPORAN SELESAI and still VERIFIED + unassigned → back to DETECTED (dormant).
3. Defects on visits at LAPORAN SELESAI / ARKIB → stay VERIFIED → appear in TNB's "awaiting package" list.
4. Flip `DEFECT_GOVERNANCE_MODE=RELEASE_ON_REPORT` (pm2 env — careful: never bare `--update-env`; see deploy runbook).
5. Create TNB users with ranks; assign TNB org mainheads.

---

## 11. Build phases

| Phase | Scope | Ships |
|---|---|---|
| **M1 Foundation** | TNB rank + rank-aware authz; `MaintenancePackage` + TNB/Admin assign screen (web); closure authority (TNB/Main Contractor/Admin); BEFORE/DURING/AFTER evidence + completion gate; backfill script (dry-run first) | API + web + migration |
| **M2 Contractor mobile** | maintenance mode §7.1, offline | APK |
| **M3 TNB verification** | web verify queue + mobile §7.2, reject loop, cannot-repair handling | API + web + APK |
| **M4 Repair report** | per-PE PDF §8 | API + web |
| **M5 Track record** | timeline view, next-cycle CONFIRMED_FIXED/RECURRED link, TNB dashboard (open vs closed, time-to-close per contractor) | API + web |

Activation (§10) after M1+M2 are live and a pilot TNB + contractor are set up.

---

## 12. Fine-tune 2026-10-01 — team assignment + Map assign

Owner direction 2026-10-01 (decisions G15–G19). Builds on M1/M2 (live, Deploys 188/190).

| # | Decision |
|---|---|
| G15 | **Who assigns: TNB and Main Contractor.** TNB has confirmed the Main Contractor may assign; MC assignments go **live immediately** (no TNB approval step). |
| G16 | **TNB picks company OR team.** TNB may stop at the company (its Manager then picks the team, as today) or go straight to a team (company filled in from the team). |
| G17 | **MC reach = own teams + every subcontractor team under it** (same subtree as MC oversight, `resolveMainContractorOrgIds`). |
| G18 | Package unit unchanged: **whole Pencawang, or one scope** (Rentis / Cat Tiang / Selenggaraan). |
| G19 | Two ways to assign: **the Maintenance Package list** (exists) and **the Map** (new) — select nearby Pencawang so crew travel is optimised. |

### 12.1 Who can do what (replaces the assign rows of §4)
| Actor | Sees on the board/map | Can assign to |
|---|---|---|
| ADMIN | tenant-wide | any company / any team |
| TNB Foreman / Technician | own TNB mainheads | any contractor company, or any team of one |
| TNB Engineer | own TNB mainheads | — (view only) |
| MC Manager | **default:** PEs in the mainheads assigned to its company (`OrganizationMainhead`) that are unassigned or routed into its subtree | its own company or a subcontractor (company), or any team in that subtree |
| Subcontractor Manager | unchanged — Maintenance Workspace, own teams only | own teams |

MC may NOT touch a PE that TNB routed to a company outside its subtree. Re-teaming a
PE TNB sent straight to an MC-subtree team is allowed (it's MC's crews) and logs a
timeline event.

### 12.2 Data
- `MaintenancePackage.assignedTeamId String? -> Team` (**additive migration**). Rule: if set, the team's `organizationId` must equal `maintenanceOrganizationId`.
- Routing (`package-routing.util`, still the ONLY writer): with a team, every in-scope not-yet-evidenced Kejanggalan gets `maintenanceOrganizationId` + `assignedToTeamId` + lifecycle ASSIGNED (same as the Workspace lane assign does today); without a team, behaviour unchanged (company pool, VERIFIED).
- The Workspace lane assign (`PATCH /defects/maintenance-workspace/assign`) keeps the covering package's `assignedTeamId` in sync, so the board never shows a stale team.
- Crews need no change: `/maintenance-work` already scopes by `assignedToTeamId`/`assignedTeamId` → APK v2.0.15 works as-is.

### 12.3 API
- `POST /maintenance-packages` gains optional `assignedTeamId`; `maintenanceOrganizationId` becomes optional when a team is given.
- **Bulk:** `POST /maintenance-packages/bulk` `{ siteVisitIds[], category?, maintenanceOrganizationId?, assignedTeamId?, dueDate?, notes? }` → one transaction, per-PE result (assigned / skipped + reason). Used by the Map and by multi-select on the list.
- Board returns per PE `latitude/longitude` (from `Substation`: manual pin wins over check-in), package team, and for MC callers a `canAssign` scoped as §12.1. Board also returns the assignable **teams** (grouped by company, in the actor's reach).
- Authz: `resolveActor` accepts MC Managers (today it 403s every non-TNB non-admin).

### 12.4 Web — Maintenance Packages page
- **List** (exists): add a Team column + team picker in the assign dialog ("Company" OR "Team"); row checkboxes → bulk assign bar.
- **Map tab (new):** Pencawang markers at their saved location, labelled with open-Kejanggalan count, coloured: unassigned · assigned to the *focus team* · assigned to others · finished.
  - Select: click to toggle · drag a box · "within X km of this Pencawang".
  - Selection tray: N Pencawang, poles, Kejanggalan by scope, spread (km between the two farthest) → choose company/team + scope + target date → Assign all.
  - **Focus team** filter: shows that team's current Pencawang so nearby ones can be added to the same team.
  - "No location" list beside the map (PEs without coordinates) so nothing is hidden.
  - Scales to thousands of PEs (markers per PE, not per pole; cluster when zoomed out).
- Nav: MC Managers get the Maintenance Packages entry.

### 12.5 Build order
1. Migration + routing with team + bulk endpoint + MC authz (e2e: TNB→team, TNB→company, MC→sub team, MC blocked outside subtree, Engineer blocked, workspace sync).
2. List: team picker + multi-select bulk bar.
3. Map tab.
Ships API + web + 1 additive migration; **no APK**.

Open: Q9 MC visibility of unassigned PEs — default = its company's assigned mainheads (§12.1); confirm with owner.
Later (not now): suggested visiting order per team (nearest-neighbour route).

### 12.6 Several teams on one Pencawang — split by poles (owner, 2026-10-01)
| # | Decision |
|---|---|
| G20 | A Pencawang can be **split by poles**: TNB / MC select poles on the map and give them (whole, or one work type) to another team — **from any company** (TNB; an MC still only within its group). Each pole + work type has exactly ONE owner, so no duplicate trips and every repair is credited to one team. Supersedes A2's "no split below work type" at pole level (still no per-Kejanggalan split). |

- Data: `MaintenancePoleAssignment` (siteVisitId, assetId, category?, maintenanceOrganizationId, assignedTeamId?, dueDate?, notes?) — unique per (visit, pole, category) + partial unique for the whole-pole row.
- Routing precedence for a Kejanggalan: pole+work type → pole (whole) → PE work-type package → PE whole package. Still one writer (`package-routing.util`); same reassign rules (evidenced work stays).
- Pole splits survive a PE-level reassign/withdraw (the rest of the PE moves); "Return to Pencawang owner" clears them.
- API: `GET /maintenance-packages/:siteVisitId/poles`, `POST …/poles` (assign), `POST …/poles/clear`. Board rows carry a pole-split summary.
- Web: "Split by poles" view — pole map coloured by owner team, click / box select, give to a company/team, or return to the PE owner.
- Crews: no APK — `/maintenance-work` already scopes by team; Team B sees the PE with only its poles.
- The per-PE repair PDF (M4) will be per company (each company's own Kejanggalan).

## 13. New finding during maintenance (owner, 2026-10-04)

Field request: a pole that did not need work at survey time (e.g. no Rentis) needs it now.
The crew must be able to record it and repair it in the same flow.

| # | Decision |
|---|---|
| H21 | A **new Kejanggalan** can be added to a pole of a maintenance package — by the **office on the web** and by the **crew in the app**. |
| H22 | **Repair straight away**, no prior approval. A stamped **BEFORE photo is required** when adding; it is tagged **"New finding (not in survey)"**, and TNB / Main Contractor / Admin see the tag + photos when verifying closure (C8 unchanged). |
| H23 | **Any checklist item** of the pole's template; severity and work type come from that item (and the chosen defect option), exactly like the survey. |

### 13.1 Model — one flagged answer on the pole's survey inspection
- A Defect must hang off an `InspectionItemResult` (`inspectionItemResultId` is required + unique).
  The finding is **one extra `InspectionItemResult`** on the pole's **latest SUBMITTED survey
  inspection in the packaged visit**, flagged `source = MAINTENANCE_FINDING` (new enum, default
  `SURVEY`), plus its Defect. Same pattern as `declareEmergency` (inspections.service).
- The survey's own answers (`InspectionResult`) and item results are **never touched**.
- Rejected alternative: a separate `Inspection` row. It would need an `origin` filter in 40+
  "latest inspection" / count / export / billing paths, and one missed filter would blank a
  pole's survey data. With the flagged answer, a missed filter only shows one extra line.
- Migration (additive): `InspectionItemResultSource` enum + `InspectionItemResult.source`
  (default SURVEY) + `createdByUserId?` (who added the finding).

### 13.2 API
- `POST /maintenance-work/:siteVisitId/findings` `{ clientRef, assetId, templateItemId, optionValue?, remark? }`
  (clientRef = idempotency for the offline queue). In one transaction:
  1. Pole must be in the visit, with a SUBMITTED survey inspection there (else 400 "pole not surveyed in this package").
  2. **No duplicate:** if the pole already has an open Kejanggalan for that item (survey or finding) → 409 with its id ("already listed — use it").
  3. Create the item result (FAIL, isDefect, checklistItemId, label, severity via the option/item, maintenanceCategory from the item, remark, source=MAINTENANCE_FINDING, createdByUserId).
  4. Create the Defect opened **VERIFIED** (not DETECTED), timeline `CREATED` "New finding (not in survey)".
  5. `applyPackageRouting(tx, siteVisitId)` → company + team from the pole/PE package (→ ASSIGNED).
     If routing yields no team and the actor is a contractor team member, assign the actor's team
     (so the crew that found it can complete it).
- Who may add: contractor Manager / Supervisor / Technician whose scope covers that pole (same rule
  as `workScope`), TNB maintenance actors, Main Contractor managers (own group), Admin.
- Pack payload (`GET /maintenance-work/:siteVisitId`): each Kejanggalan gets `isNewFinding`,
  `addedBy`, `addedAt`; plus **all poles of the visit** (id, code, lat/lng — so a pole with no
  Kejanggalan yet can be picked) and **`findingItems`** = the visit template's defect-capable items
  with their defect options (so adding works offline after "Save for offline").
- Verification queue item + defect detail: `isNewFinding`.
- **Survey isolation** (`source = SURVEY` filter): Laporan Kejanggalan + its ZIP, checklist / QR /
  SAVT exports, visit rollup `defectsFound`, client progress defect counts, asset detail checklist
  rows. Survey re-save must **keep** finding rows (today it deletes all item results except
  emergencies), and office checklist edits must ignore them (match by checklistItemId on SURVEY rows only).
  Defect lists / board / dashboards / maintenance views read the Defect table → findings appear there (intended).
- Repair report PDF (M4): findings listed under their own heading.

### 13.3 Admin web (office)
- Maintenance Packages → a package's **Poles** view: "Add Kejanggalan" on any pole (incl. poles with
  none yet) → pick item / defect option, note, **upload BEFORE photo (required)** → appears in the
  crew's pack on their next refresh. "New finding" chip in the pole table and on the verification RepairCard.

### 13.4 Mobile (crew) — next APK
- Pole screen: **"+ Add Kejanggalan"**; package screen: add on another pole (list / map pick).
- Flow: pick item → defect option (if several) → note → **stamped BEFORE photo** (marking circle,
  colour from the item's category) → shows immediately ("New finding", pending sync).
- Offline: new queue op `CREATE_DEFECT_FINDING` mints a temp defect id; the BEFORE upload and
  "Mark done" `dependsOn` it; temp id remapped on sync (same reconciler as offline creates).
  A 409 duplicate on sync → drop the local copy and point the crew to the existing Kejanggalan.

### 13.5 Build order
1. API: migration + endpoint + routing + survey-isolation filters + pack/verification fields; unit + e2e
   (add → routed → BEFORE → AFTER → done → verify; duplicate 409; technician scope; survey report/export
   unchanged; survey re-save keeps the finding). **Deploy API + web together** → office can add same day.
2. Admin web: add dialog + chips.
3. Mobile: add flow + offline op → APK v2.0.17 (+ release notes BM/EN).

## 14. Crew navigation — all poles, work-type filter, pole photos (owner, 2026-10-07)

Smoke-test feedback from crews: maintenance teams are not the surveyors — they need more
visual help to find the pole in front of them.

| # | Decision |
|---|---|
| I24 | The package **map shows every pole the crew works on** (incl. poles with no Kejanggalan, so one can be added there). Colours: red = to repair, amber = in progress, blue = submitted, green = closed, grey/white = no Kejanggalan. On a pole-split PE: **only the crew's own poles** (other teams' poles hidden). |
| I25 | **Work-type filter** All / Rentis / Selenggaraan / Cat Tiang — matching poles coloured by state, the rest grey but visible. |
| I26 | **My location**: button asks permission + centres on the crew; heading puck; a **nearest pole** card (number, distance, photo, Kejanggalan, Open). Tapping a pole shows the same card. |
| I27 | **Pole survey photos** (up to 4 per pole; whole-pole IMAGE field first, labelled) on the pole screen + map card, so the crew can match the pole. |
| I28 | **Save for offline** downloads photos to app storage (not the ~40 MB image cache): every photo on poles with work + the first pole photo on the others; total size shown first. |
| I29 | Ships in **APK v2.0.18** together with §13 (v2.0.17 is never distributed). API change is additive → deploy API first. |

## 15. Contractor Manager view, progress, maintenance crew performance (owner, 2026-10-08)

| # | Decision |
|---|---|
| J30 | **Every contractor Manager gets Maintenance Packages (List + Map).** A SUBCONTRACTOR Manager sees only the PEs / work types / poles routed to **its company** and may **assign / re-team its own teams** (single, bulk, map box, split by poles between its own teams). Company change + withdraw stay with TNB / Main Contractor / Admin. MC + TNB unchanged. |
| J31 | **Contractor Supervisors: view only** (their company's packages + progress, no assign). |
| J32 | **Progress at a glance** on List + Map: per PE To do · In progress · Awaiting verification · Closed bar, % closed, target date (red when overdue); map marker colour by progress (not started / in progress / awaiting verification / all closed; hollow = no team), label done/total; KPI strip (total, % closed, awaiting verification, overdue PEs, no team) + per work type. |
| J33 | **Crew Performance → "Maintenance" tab** — **credit by TEAM only**: repaired (marked done), closed (verified), sent back, cannot repair, active days, avg assigned→done, verification pass rate; month picker; same scope as survey tab (Admin all, Manager own company, MC + subtree). **XLSX download** too. |

Data exists (Defect.maintainedAt/maintainedByUserId, assignedToTeamId, closureVerifiedAt, timeline STATUS_CHANGED) → **no migration**. Ships API + web, no APK.

## 16. Repair report (M4) — decisions (owner, 2026-10-08)

| # | Decision |
|---|---|
| K34 | **One PDF per Pencawang per company** ("Laporan Pembaikan Kejanggalan"); optional **one work type** (e.g. a Rentis-only claim). |
| K35 | **Every** Kejanggalan of that company on the PE, each with its status; the PDF is watermarked **DRAF** until all are Closed. Sections: survey Kejanggalan · new findings (not in survey) · cannot repair (with reason). |
| K36 | Photos per Kejanggalan: **BEFORE + DURING (if any) + AFTER** with stage + time captions (no survey photo). |
| K37 | Download from the **Maintenance Packages row** and as a **batch ZIP** of many PEs (background job, like the Laporan Kejanggalan ZIP). |
| Q7 | Contractor **Manager / Supervisor** (own company), Main Contractor (own group), TNB, Admin — not Technicians. |

Layout: pdf-lib, Kad Kerja style (ASCURE + TNB logos, navy title, identity + company/teams/scope/target, status summary strip); one card per Kejanggalan: pole + GPS + work type + A/B/C + status, Kejanggalan text, repaired by team/date, verified by name/date, photo row. API + web, no migration, no APK.

## 17. Maintenance mode for contractor Managers (owner, 2026-10-11)

Subcontractors do **either** survey **or** maintenance, so a maintenance company's Manager / Supervisor gets a web view built only for repair work. Most of the data already exists (§12, §15, §16). This section **rearranges** it and adds three new pieces: the **grid**, the **overview** and **reports by date**.

| # | Decision |
|---|---|
| L38 | **Each company has an explicit work mode**, set by Admin on the Organization form: `SURVEY` · `MAINTENANCE` · `BOTH`. Empty = today's full view, so nothing changes until Admin sets it. It does **not** reuse the capability tags. |
| L39 | **Main Contractors get `BOTH` → a Survey \| Maintenance switch** at the top of the sidebar, remembered per browser. SUB companies get a single mode with no switch. |
| L40 | **Progress = one bar with two parts:** *done, waiting for TNB* (awaiting) and *closed* (verified). **Only closed counts toward 100%.** |
| L41 | **"Reports by date" = Kejanggalan repaired or closed in the date range** (maintainedAt OR closureVerifiedAt in [from, to]), i.e. a claim period. |
| L42 | **TNB + Admin are unchanged.** Maintenance Packages / Repair Verification stay as they are for them. The new **Grid** tab is added to Maintenance Packages for everyone (additive), but it only becomes the *default* tab in maintenance mode. |

### 17.1 Sidebar in maintenance mode (contractor MANAGER / SUPERVISOR)

| Item | Page | New? |
|---|---|---|
| **Overview** (home, `/` redirects here) | `/maintenance` | **new** |
| **Pencawang** | `/maintenance-packages?view=grid` (List / Map / **Grid** tabs) | grid new |
| **Map** | `/maintenance-packages?view=map` | exists (side panel gains the 3 work-type cells) |
| **Reports** | `/maintenance-reports` (By Pencawang · By date) | **new page** |
| **Teams** | `/crew-performance?tab=maintenance` | exists |
| **Users** | `/users` | exists (Manager only) |

Hidden in maintenance mode: Dashboard, Site Visits, Assets, Defects, Network, Surveys, Reports (survey), Maintenance workspace. **This is navigation only:** a typed URL still works, and the data is still server-scoped. Supervisors see the same pages with no assign / re-team buttons (J31). The Survey-mode sidebar is today's minus the maintenance items. It gets its own redesign later.

### 17.2 Grid: which PE → which team, per work type (needs #4 + #6)

- One row per PE (the company's routed PEs, same scope as the §15 COMPANY board). Columns are **Rentis · Selenggaraan · Cat Tiang**, then Total, Target date and Report.
- Cell = **team chip** (or "No team", amber) + **two-part bar** (L40) + `closed/total` + overdue flag. "—" = no Kejanggalan of that type. Pole splits (§12.6) show as "Split: Team A 8 · Team B 4".
- Click a cell to assign / re-team that lane (own teams only, J30). Tick rows for bulk assign of one work type.
- Filters: team, work type, overdue, no team, fully closed, search PE. Sort by % closed, overdue, name. Excel export of the grid.
- Built from the existing **board** payload (lanes already carry team + `progress`). No new endpoint unless the payload proves too heavy at prod scale. Check with the largest company first.

### 17.3 Overview (need #1)

New `GET /maintenance-packages/overview` (board actors; COMPANY = own company, MC = own group, Admin/TNB optional `organizationId`):
- **KPIs:** Kejanggalan assigned · done-waiting-for-TNB · closed · sent back · cannot repair · overdue PEs · lanes with no team.
- **By work type:** three two-part bars (L40).
- **Team table:** team, PEs on hand, Kejanggalan on hand, done this week, closed this week, sent back, overdue. Click a team to open the Grid filtered to it. Reuses the `maintenance-performance` query from §15 J33.
- **Last 30 days:** repaired per day vs closed per day (line chart, same style as the dashboard).

### 17.4 Reports (need #5)

- **By Pencawang:** pick PEs from a searchable list (+ optional work type) → one PDF, or a ZIP when several. Reuses M4 (K34–K37) unchanged.
- **By date:** from / to (+ optional work type, team) → background ZIP job:
  - every PE with ≥1 of the company's Kejanggalan repaired or closed in the range (L41)
  - one repair PDF per PE listing **only the Kejanggalan in the range**, header line `Tempoh: dd/mm/yyyy – dd/mm/yyyy`; DRAF watermark if any listed item isn't Closed
  - plus `ringkasan.xlsx`: one row per Kejanggalan (PE, pole, work type, A/B/C, team, repaired date, closed date, status, materials from Deploy 206)
- API: `RepairReportZipDto` gains optional `from`, `to`, `teamId`. When dates are given, `siteVisitIds` becomes optional and is resolved server-side. `repair-report.service` filters items by the range.

### 17.5 Data / API

- Migration (additive): `enum OrganizationWorkMode { SURVEY MAINTENANCE BOTH }` + `Organization.workMode OrganizationWorkMode?` (nullable, no default).
- Organizations update DTO: `workMode` (ADMIN only). Login + `/auth/me` return the user's company `workMode`.
- Overview endpoint (17.3); date-range report jobs (17.4).
- No mobile change, no APK.

### 17.6 Build order

1. API: migration + `workMode` on org + `/auth/me`; Admin org form field. *(e2e: ADMIN-only set; me returns it)*
2. Web: **Grid** tab on Maintenance Packages (+ Map side panel work-type cells).
3. API + web: **Overview** endpoint + `/maintenance` page. *(e2e: COMPANY / MC / ADMIN scope)*
4. API + web: **Reports** page + date-range ZIP + `ringkasan.xlsx`. *(e2e: range picks repaired-or-closed only; company scope)*
5. Web: sidebar by mode + MC switch + home redirect.

Each step can ship on its own. One additive migration (step 1) → prod `migrate deploy`. Deploy = API + admin picks, no APK. Before the switch-over (step 5), Admin sets `workMode` on every contractor company in prod.

## 18. Manager progress view in the mobile app (owner, 2026-10-12)

Today a contractor Manager on the phone only gets the crew's "My Pencawang packages" list: a "N to repair" chip per PE, no teams, no progress bar, no work-type breakdown, no filters. To see who is doing what, they have to open every Pencawang.

| # | Decision |
|---|---|
| M43 | **Who:** contractor **MANAGER / SUPERVISOR** get a new **Pencawang progress** screen. Technicians keep "My Pencawang packages" unchanged. **Subcontractor** = its own teams. **Main Contractor** Manager = its own teams **and its subcontractors** (grouped by company → team). Supervisors view only. |
| M44 | **Data = the web's board** (`GET /maintenance-packages/board`). Same scope rules as the web (§12, §15), so no new authorization. Cached for offline viewing; **assigning is online-only** ("Connect to assign"). |
| M45 | **Assign from the phone:** tap a work-type row on a tile (or on the map card) → pick a team (SUB) or a subcontractor / team (MC); plus "Whole Pencawang → one team". ⚠ The app sends the **existing target date + notes unchanged** (the API clears them on an MC assign without them). Split by poles and bulk assign stay on the web for now. |
| M46 | **Map of all assigned Pencawang:** clustered circle layer (never MarkerViews, see the mobile cluster lesson) coloured like the web (red not started · amber in progress · blue waiting TNB · green all closed; hollow = no team), label closed/total, locate-me. Tap → bottom card = the tile + Open + Assign. Filters are shared with the list. |
| M47 | **By team tab** (SUB) / **By company tab** (MC, expands to teams): Pencawang on hand, still to repair, waiting TNB, closed, no team. Tap → the list filtered to it. Counts come from the board only (no "done this week", which would need another endpoint). |
| M48 | **Ships as an APK only (v2.0.20):** the prod board already carries team + progress per work type (Deploy 201), so **no API deploy** is needed. Before release, check the board payload size for the largest prod Main Contractor (offline cache chunks rows >2 MB since v2.0.16). |

### 18.1 Screen: Pencawang progress (tabs List · Map · Teams)

- **Summary card:** % closed, waiting TNB, still to repair, overdue PEs, no team. Three work-type bars; tapping one filters every tab to that work type.
- **Filter chips:** All · In progress · Not started · Waiting TNB · Done · Overdue · No team; team (or company) picker; search.
- **Tile per PE:** name + status word; bar + `closed/total` + waiting TNB; one row per work type `Rentis · Team A · 5/8` (MC: `SubCo · Team A`); target date (red when overdue); pole count. Tap the tile → the existing Pencawang screen (poles, photos). Tap a work-type row → assign sheet (Managers only).
- **Entry:** Home maintenance tile → this screen for Managers / Supervisors; the crew list stays one tap away ("My crew work").

### 18.2 Mobile pieces

- `src/maintenance/board.ts`: board types + helpers (port of the web's `laneCell` / state / progress).
- `MaintenanceProgressScreen` (List / Map / Teams), `AssignLaneSheet` (bottom sheet: work type → destination, online-only).
- `api.getMaintenanceBoard`, `api.assignMaintenancePackage` (POST `/maintenance-packages`, same body as the web).

### 18.3 Build order

1. Board types/helpers + List tab (summary, filters, tiles) + Home entry.
2. Assign sheet (lane + whole PE), refresh after save.
3. Map tab.
4. Teams / companies tab.
5. Trial APK (LAN) → owner device test as a SUB manager and an MC manager → official **v2.0.20** + release notes BM + EN.

## 19. Maintenance web usability, TNB Supervisor, notifications, activity log, daily crew performance (owner, 2026-10-12/13)

**Context that shapes everything:** TNB opens the console **on their phones**; `admin.ascure.com.my` is blocked on TNB laptops (worth asking TNB IT to whitelist it, outside our code). So every page touched here must work at phone width, not just shrink.

| # | Decision |
|---|---|
| N49 | **Phone width first.** Every page in this section works at 375 px: wide tables become cards below 768 px, buttons are thumb-sized, filters fold into a sheet. |
| N50 | **Buttons look like buttons.** Owner didn't know Poles / Report were clickable (ghost buttons read as text). Action column **pinned to the right edge**; Manage = solid; Poles / Report = outlined + icon; "+ Kejanggalan" → "⋯" menu. Same pass over Grid, Map panel, Repair Verification. |
| N51 | **Emergency folds** into one red bar "⚠ N emergencies waiting for a company · Show" (hidden when none). Assign stays inside it on Maintenance Packages; the Maintenance page shows the same fold. |
| N52 | **Maintenance Packages shorter:** KPIs + work-type bars in one compact strip with "Hide summary" (remembered); filters + table header stay pinned; **50 Pencawang per page**. "Another company" is relabelled to what it really is: **"Your poles: N (split) · Manage poles"** or **"Started by your crew: N"**, and own work shows own team. |
| N53 | **Quick team assign in the Grid:** the old Maintenance page's per-work-type "Assign…" dropdown (owner: easier for subcontractors) goes **into each Grid cell**: pick a team → saved at once, "Saved · Undo". The old Maintenance page stays (cards folded into rows) until the owner OKs retiring it. |
| N54 | **Repair Verification grouped:** one folded row per **Pencawang + company** ("PE BKT SEKILAU · Other Co · 12 waiting"); filters company / Pencawang / work type / submitted date; 20 groups per page with server paging (replaces the 200-item cap). Phone: one group at a time, swipe photos, big Verify / Send back. |
| N55 | **TNB Supervisor rank** (Option 1 = rank order only, below Technician; no per-person link): new `ClientRank.SUPERVISOR` + table `ClientCompanyAccess` (user ↔ contractor company). Set by **Admin, TNB Technician, TNB Foreman** (user form + a Supervisors panel). **Their companies decide everything they see**: maintenance (Packages, Verification, Map) **and** surveys (Progress / Surveys / Asset Map = those companies' surveys). They may **verify, send back, re-open, decide cannot-repair**, and **assign / change Pencawang work only to or from their own companies** (or unassigned work on their Mainheads), never another company's. |
| N56 | **Notifications:** 🔔 in the console (count + list) **and Web Push** on the phone (Add to Home screen + Allow; Android Chrome; iPhone iOS 16.4+ from the home screen), no app, no outside account (VAPID keys on the VPS). v1 event: **repairs submitted** → that company's TNB Supervisors (none set → the Mainhead's Foreman / Technician), **grouped per Pencawang + company** within 15 min ("Other Co submitted 12 repairs at PE BKT SEKILAU"). Tap → Repair Verification filtered to it. |
| N57 | **Activity log (Admin only)**, for accountability, disputes and security audit. **Phase 1:** one feed from what is already recorded (Kejanggalan history, survey status changes, deletions): time · who · what · where, filters person / company / Pencawang / action / date, Excel export. **Phase 2:** new append-only `AuditEvent`: package assign / change / withdraw, pole splits, supervisor company access, user / company / rank changes, **logins (success + failed, device / browser)**. Never edited. **Retention:** work actions forever; logins 2 years (nightly prune). |
| N58 | **Crew Performance by day:** period = **calendar from–to** + presets (Today, Yesterday, This week, Last 7 days, This month, Last month), both Survey and Maintenance tabs; a **By day** view (one row per day per person / team); the Maintenance tab gets the per-team daily drill the Survey tab already has. The API already takes any from / to. |

### 19.1 Build order (each ships on its own)

1. **N50 + N51 + N52 relabel**: web only.
2. **N49 phone layouts + N53 + N54**: web + API paging for verification.
3. **N58**: web + a small API addition (maintenance daily per team).
4. **N55 Supervisor**: migration (enum value + table), scope rules across board / verification / client views, user form. Biggest.
5. **N56 🔔 + Web Push**: migration (notifications + push subscriptions), service worker, VAPID env on the VPS.
6. **N57 activity log**: Phase 1, then Phase 2 (migration).

⚠ §17 steps 1–2 (company work mode + Grid, with 1 additive migration) are still dev-only: they ship with the first deploy of this batch.
