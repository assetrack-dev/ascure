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

Still open:
- Q2 TNB rank storage: new `clientRank` field (recommended) vs reuse `MainheadAccessRole` — implementation detail, decided in M1.
- Q7 Do contractor Technicians download the report, or Manager/Supervisor only? (default: Manager/Supervisor) — M4.
- Q8 Photo time-gap threshold for the fraud flag — **owner to discuss later**; flags off until set — M2/M3.

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
