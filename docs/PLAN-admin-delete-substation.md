# PLAN — ADMIN: completely delete a Substation (Pencawang) + all its data

> Status: **PLANNED, not built** (owner: 2026-06-25 "I'll need ability to completely
> delete substation + their assets, admin only — plan first, do it later").
> Destructive feature on a live pilot — design for safety before building.

## Goal
Let an **ADMIN** permanently delete a whole Pencawang (Substation) and everything
under it — assets/poles, their inspections + defects + images, the network graph
(feeders, memberships, tie edges), and the site visits/surveys scoped to it — in
one guarded action. Used to remove test/junk Pencawang from prod (the leftover
`ABC TEST` / `TEST1` / `TSLG` / `KLANG` / `PANDAN` … records that the Deploy-50
network filter currently only *hides*).

## Current state (what already exists — reuse it)
- `DELETE /assets/by-substation/:substationId` → `AssetsService.deleteBySubstation` →
  `hardDeleteAssets(tenantId, ids)` (ADMIN-only). Deletes a substation's **assets +
  their dependents** (inspections / item-results / defects / images / pole-feeder
  memberships / network edges) in the correct order. **This already solves the
  "+ their assets" half.**
- `DELETE /site-visits/:id` → `SiteVisitsService` delete (ADMIN-only) — deletes a
  visit + its created-and-unshared poles + cascade (inspections/links/participants/
  reassignments/contributions/lifecycle/report), with a `delete-preview`.
- **Missing:** deleting the **`Substation` record itself**, and there is **no admin
  Substation-management page** (substations only appear in dropdowns on Network /
  Reports, created via import / the mobile add-asset + site-visit flow).

## Dependency graph (from `prisma/schema.prisma`) — the critical part
Deleting a `Substation` row interacts with these FKs:

| Referencing model | FK | onDelete | Implication |
|---|---|---|---|
| `Asset.substationId` | → Substation | **Cascade** | assets auto-delete, BUT their own dependents (Inspection/Defect/images/PoleFeederMembership/NetworkTieEdge) may `Restrict` → must delete assets via `hardDeleteAssets` FIRST, not rely on the raw cascade |
| `SiteVisit.substationId` | → Substation | **Restrict** ⚠ | **blocks** the substation delete while any visit references it → must delete all its site-visits first |
| `SiteVisit.fromPencawangId` / `toPencawangId` | → Substation | SetNull | route references auto-nullify — fine |
| `Feeder.substationId` | → Substation | **Cascade** | feeders (and their cascade: memberships/edges) auto-delete with the substation |

**Order of operations (must be a single `prisma.$transaction`):**
1. `hardDeleteAssets` for all the substation's assets (clears Asset dependents — the
   Restrict edges off Asset).
2. Delete all `SiteVisit` rows with `substationId = X` + their cascade (the Restrict
   blocker). Reuse the site-visit delete cascade logic.
3. Delete the `Substation` row → `Feeder`/`PoleFeederMembership`/`NetworkTieEdge`
   cascade; `fromPencawang`/`toPencawang` route refs SetNull.

⚠ **To verify at build time:** exact onDelete of `PoleFeederMembership` and
`NetworkTieEdge` vs Asset/Feeder (confirm they cascade and don't Restrict);
whether any other model gained a `substationId` since (grep before building).

## Proposed design
**API (new, ADMIN-only, tenant-scoped, `@Roles(ADMIN)` + RolesGuard):**
- `GET  /substations/:id/delete-preview` → counts of what will be removed
  (assets, site-visits, inspections, defects, feeders) + the substation code/name,
  so the UI can show "you are about to delete N poles, M visits…".
- `DELETE /substations/:id` → the transactional cascade above; returns a summary.
  (Place on a new `SubstationsController`, or extend `AssetsController` — but a
  dedicated substations module is cleaner since this deletes the substation entity,
  not just assets.)

**UI (admin-web, ADMIN only):**
- Needs a home — there's no Pencawang admin page today. Options:
  - (A) New **`/substations`** admin page (list all Pencawang + asset/visit counts +
    per-row "Delete" in a Danger zone). Most discoverable; reuses the `assetCount`
    field already added in Deploy 50.
  - (B) Add a "Danger zone — delete this Pencawang" panel on an existing surface
    (e.g. the Network page once a Pencawang is selected, or an asset-by-substation
    view). Lower effort, less discoverable.
- **Confirm flow** (mirror the site-visit delete): show the preview counts +
  **type-the-Pencawang-code to confirm** + explicit "This permanently deletes N
  poles and all their inspections/defects/photos. Cannot be undone." Gate the
  button on `sourceRole === ADMIN` (the web collapses MANAGER/SUPERVISOR→VIEWER, so
  check the server `canX` flag, per the QA-gate pattern).

## Safety / guardrails (non-negotiable for a live pilot)
- **ADMIN only** (server RolesGuard, not just UI hiding).
- **Tenant-scoped** — never delete across tenants.
- **Type-to-confirm** the Pencawang code in the UI.
- **Preview before delete** (show counts).
- **DB backup first** when run on prod (runbook step — `pg_dump` like every deploy).
- **Irreversible** — single transaction so a mid-failure rolls back cleanly.
- Consider a **soft-delete / `isActive=false`** alternative for non-test data (the
  Substation already has `isActive`); hard-delete reserved for genuine test junk.

## Open questions for the owner (decide at build time)
1. UI placement: dedicated `/substations` page (A) vs Danger-zone panel (B)?
2. Hard-delete only, or also offer "archive/deactivate" (soft) for real-but-retired
   Pencawang?
3. Block (or warn + force) when a Pencawang still has **submitted/ARKIB** surveys or
   open defects? (Test junk has none; real data might.)
4. Bulk (select several test Pencawang) vs one-at-a-time?

## Out of scope (for the first cut)
- Restore/undo, audit-log entry, cross-tenant tooling. (Audit-log entry is worth
  adding even in v1 — a row in a deletions log — given how destructive this is.)
