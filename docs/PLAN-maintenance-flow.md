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
