# PLAN — Team feedback batch (2026-07)

> Status: **Decisions locked with owner 2026-07-01.** Four items from field/manager feedback.
> Sequencing: **(1)+(2) → (4) → (3)**. SAVT cross-team redundancy **explicitly deferred** (see end).
>
> **Build status (2026-07-01, all typecheck-clean; runtime pending — local DB/Docker down):**
> - **Item 1 ✅ built** — API (SiteVisit delete + Pencawang cascade, own-org MANAGER, `DeletionLog`
>   audit, `canDeleteSurvey` flag) · mobile (Danger Zone card) · admin-web (survey panel + Pencawang
>   cascade). 1 migration `20260701000000_add_deletion_log` (NOT yet applied).
> - **Item 2 ✅ built** — API `PATCH /site-visits/:id` (lifecycle-gated) · mobile Edit-Details card
>   (text + GPS re-capture + manual lat/lng). Deferred: draggable map-pin picker; admin-web edit form.
> - **Item 4 ✅ built** — API `/dashboard/daily-user-activity` + `/reports/crew-performance(.xlsx)` ·
>   mobile per-user card + "This Month" pay view · admin-web Crew Performance page (nav: admin+manager).
> - **Item 3 ⚠ foundation built + KEY FINDING** — manager half already worked; technician map scope
>   added (`crossTeamMainheadIds` + `siteVisitMapWhere`, def = "where my team works"). **But the
>   mobile map's `GET /assets` feed is already TENANT-scoped and carries each pole's latest SUBMITTED
>   inspection regardless of team** — so a technician already sees other teams' poles + inspection
>   status on the mobile map. The practical "avoid double-inspect" goal is largely met there today;
>   the API change only makes the (role-scoped) web map semantically correct. **Needs runtime
>   confirmation** of the mobile map before any further mobile UI. Owner chose **Map only for now**
>   (no work-queue/list change) + Mainhead def = **"where my team works (auto)"**.

Grounding refs (verified): scope matrix `apps/api/src/common/authorization/site-visit-scope.ts`;
SiteVisit delete `apps/api/src/site-visits/site-visits.service.ts` (`deleteWithAssets`,
`previewDeleteWithAssets`, `resolveSurveyDeletionPlan`); Substation delete
`apps/api/src/master-data/master-data.service.ts:92`; dashboard `apps/api/src/dashboard/`;
countable row = `Inspection.createdByUserId` + `submittedAt` + `completionStatus=SUBMITTED`.

---

## Item 1 — Manager hard-delete (Pencawang / Site Visit + full cascade)

**Why:** lots of training/demo Pencawang + Site Visits cluttering app + web; teams can't remove them.

**What already exists (reuse):**
- `deleteWithAssets(user, id)` cascades a SiteVisit → inspections → results → defects → images →
  lifecycle/report rows, and **keeps poles shared with other surveys** (`resolveSurveyDeletionPlan`).
- `previewDeleteWithAssets(user, id)` returns what will be removed vs kept.
- `deleteSubstation` (master-data) refuses while the Pencawang has any reference (poles/visits/
  feeders/route links) — **this non-empty guard is the cross-org safety lock; keep it.**
- Mobile already has `deleteAsset` / `deleteAssetsBulk`.
- Both SiteVisit delete endpoints are `@Roles(ADMIN)` today.

**Locked decisions (owner):**
- **Full delete power on mobile** (not web-only).
- **Add a lightweight `DeletionLog`** audit table.

**Build:**
1. **API gating:** open SiteVisit `delete` + `delete-preview` to `@Roles(ADMIN, MANAGER)`; inside the
   service enforce **own-org scope for MANAGER** (manager can only delete a visit whose
   `team.organizationId === user.organizationId`; ADMIN unrestricted). Reuse the scope helper.
2. **API Pencawang cascade (convenience):** new own-org-scoped "delete Pencawang + everything"
   that orchestrates existing pieces — loop `deleteWithAssets` over the Pencawang's visits, drop
   feeders, then delete the (now-empty) Substation. **Block if any non-own-org data references it**
   (manager); ADMIN unconditional. Add a Pencawang delete-preview mirroring the visit preview.
3. **Audit:** `DeletionLog` row per delete — `{ tenantId, actorUserId, entityType, entityId,
   label (pencawang/visit name), summary (counts removed), createdAt }`. Written inside the same
   transaction. (1 additive migration.)
4. **Mobile:** Manager-gated delete on VisitDetail (single visit) + a Pencawang delete surface;
   preview → typed/explicit confirm → call API. New `deleteSiteVisit` + preview in mobile `api.ts`.
5. **Admin-web:** flip existing delete UI gating ADMIN → ADMIN|MANAGER (server flag, since web
   collapses MANAGER→VIEWER for display — must use a server-provided `canDelete` flag, not client role).

**Deploy:** API + admin-web + **APK**. **1 migration** (DeletionLog). Destructive → preview + confirm + audit mandatory.

---

## Item 2 — Edit a Site Visit after it's started

**Why:** wrong GPS / wrong Pencawang / wrong mainhead forces recreate → more clutter.

**What exists:** **no `PATCH /site-visits/:id` at all.** `assertVisitIsMutable` blocks COMPLETED/CANCELLED.
Substation has **no** name/code edit (only status toggle + delete).

**Locked decisions (owner):**
- **Edit window:** after check-in & **before RONDAAN_SELESAI** → **crew + manager** may edit.
  After **RONDAAN_SELESAI** → **manager only**. (LAPORAN_SELESAI / ARKIB = frozen report → locked;
  default no edits once the report is compiled.)
- **GPS fix:** support **both** re-capture live position **and** manual map-pin correction.

**Build:**
1. **API:** `PATCH /site-visits/:id` editing `{ mainhead/mainheadId, functionalLocation, notes,
   checkInLatitude/Longitude/AccuracyMeters/CapturedAt, pencawang link/label }`. Gate by lifecycle:
   `< RONDAAN_SELESAI` → `assertCanMutate` (crew or mgr, own scope); `>= RONDAAN_SELESAI` →
   manager-only (own org); frozen states rejected. Append a lifecycle/audit event per edit
   (`field X: A → B`).
2. **Pencawang correction (3 cases):** (a) edit the visit's denormalized label only; (b) re-point
   `substationId` to a different existing Substation (+ refresh denormalized code/name); (c) rename
   the Substation **only if it's own-org and not referenced by other teams' visits** (else (a)/(b)).
3. **Mobile:** "Edit visit details" screen on VisitDetail — fields above; GPS = re-capture button +
   map-pin drag; manager sees it in all editable states, crew only pre-RONDAAN_SELESAI.
4. **Admin-web:** edit form on the site-visit detail (manager-gated via server flag).

**Deploy:** API + admin-web + **APK**. No migration. *(Item 2 is the cure for Item 1's disease — ship together.)*

---

## Item 4 — Per-user performance (mobile dashboard + monthly payment report)

**Why:** managers monitor + **pay crew by # assets inspected/month**; today analytics are per-TEAM only.

**What exists:** `/dashboard/daily-team-activity` → `getDailyTeamActivity` (per team, distinct assets,
SUBMITTED today). Mobile `TeamActivityCard`. Export infra = exceljs + Gotenberg in reports module.
`applyManagerUpdateScope` / users-list scope = the manager's own-company roster.

**Locked decisions (owner):**
- **Pay metric = distinct assets inspected per user per month** (`Inspection.createdByUserId`,
  `completionStatus=SUBMITTED`, count DISTINCT `assetId` within the month).
- **Report home = admin-web download (XLSX)** + **mobile live table**.
- **No rate/money column** — counts only (owner applies the rate offline).

**Build:**
1. **API daily-per-user:** `/dashboard/daily-user-activity` mirroring the team endpoint, grouped by
   `createdByUserId`, scoped to the manager's own-company roster (ADMIN = all). Returns
   `{ users[]: { userId, name, role, teamName, assetsInspectedToday } }`.
2. **API monthly report:** `/reports/crew-performance?from&to` → per user over the range:
   `{ distinctAssetsInspected, submittedInspections, visitsParticipated, defectsRaised, activeDays }`.
   XLSX export (reuse exceljs/StreamableFile pattern). Scope = own company.
3. **Mobile:** per-user drill-down under the dashboard (today + month-to-date table), manager-gated.
4. **Admin-web:** "Crew performance" page with month picker + Download XLSX.

**Deploy:** API + admin-web + **APK**. No migration.

---

## Item 3 — Cross-team visibility (read-only for technicians) — *partly already built*

**Why:** teams only see own data → risk of double-inspecting the same asset; want to see others'
work (read-only) to coordinate.

**Reality check (verified):**
- **Manager half is ALREADY DONE.** `buildSiteVisitScope` strict path gives a MANAGER read **and**
  write across **every team in their own `organizationId`** (`site-visit-scope.ts:88`). So "Manager
  sees/edits all their company's data regardless of Mainhead/Team" already holds (transitively for
  assets too). → Only need to **verify** the map + list + asset endpoints honor it end-to-end.
- `mainheadId` is **required & populated** on every visit (`site-visits.service.ts:1863`) → scoping
  by Mainhead is viable, no backfill.

**Locked decisions (owner):**
- **Manager:** see/**edit** all own-company data, regardless of Mainhead/Team. *(already works)*
- **Technician:** **see (read-only)** all data **within their Mainhead, own company** — e.g. team A
  and team B in the same company + Mainhead can see each other's data/map. Mutations stay own-team.
- **Surface:** list + map.
- **SAVT redundancy: deferred** (see below).

**Build (technician cross-team read = the only new logic):**
1. **Scope variant:** extend the oversight read path so a TECHNICIAN (and SUPERVISOR) sees own-company
   visits where `mainheadId ∈ (my Mainheads)`, **read-only**; keep strict `siteVisitAccessWhere` on
   every mutation (the existing read/write split — `siteVisitOversightWhere` vs `siteVisitAccessWhere`
   — is exactly the mechanism; today it only widens for MANAGER).
2. **"My Mainheads" resolver** (decide exact def at build, default below): compute in
   `buildScopeContext` like `resolveMaintenanceOrgIds`. **Default:** union of the technician's active
   teams' `mainheadId` + `user.mainheadId`. (Alt: distinct mainheadIds of visits their own teams are
   on — "Mainheads I actually work in".) Pick + document before building.
3. **Read paths** (list, map, asset map) use the oversight scope; **client marks other-team rows
   read-only** (no add/edit/inspect actions). API mutations already reject via strict scope.
4. **Mobile + admin-web:** surface cross-team visits in the Mainhead-grouped list + on the map,
   visually distinct + read-only.

**Deploy:** API + admin-web + **APK**. No migration. *(Build last — confirm the "my Mainheads" definition first.)*

---

## DEFERRED — SAVT cross-team redundancy (revisit later)

**The problem:** SAVT route surveys (HV From→To Pencawang routes, `fromPencawangId`/`toPencawangId`,
`routeCode` = KOD TIANG) can **legitimately** inspect the **same physical pole from two different
routes/Pencawang**. So for SAVT, a naive "this asset was already inspected → skip / dedupe" hint is
**wrong** — the redundancy can be intended, and suppressing it would hide required work.

**Why deferred:** the cross-team visibility in Item 3 is meant to *inform* ("Team X already inspected
this on date Y"), never to *block*. For normal Pencawang surveys that's clearly right. For SAVT we
need to decide how to model/display a pole that appears under multiple routes before we add any
"already done" semantics — otherwise we'd mislead crews.

**Open questions for the SAVT pass (later):**
- Is a pole shared across two routes **one** asset (appearing in both) or **two** records by design?
- Should a cross-team hint for a SAVT pole show *per-route* status ("done on route A, pending on
  route B") instead of a single "done"?
- Does pay-by-asset (Item 4) double-count a pole inspected on two routes, or count once? (Affects the
  Item 4 counting rule for SAVT specifically — flag if it comes up.)
- Map rendering of a pole that belongs to multiple routes.

**Action:** revisit as a dedicated "SAVT redundancy model" slice after Items 1–4 land.

---

## Cross-cutting

- Rides with already-committed-not-deployed `ccc7b53` (bulk Select-All merged checklist + From→To
  SAVT filename) on the next deploy.
- Deploy discipline per `[[project_prod_deploy_runbook]]` (admin bakes absolute API URL; CORS
  allow-list env; `git checkout -- next-env.d.ts` before pull; backup before any migration).
- APK rebundle gotcha per `[[project_apk_rebundle_gotcha]]` (clear generated assets so JS isn't stale).
