# ADR 0002 — Work assignment, reassignment & org hierarchy realignment

- **Status:** Accepted (2026-06-11)
- **Context refs:** [north-star §5–§6](../ASCURE-north-star.md) (teams scope visibility, work stays fluid), [ADR 0001](./0001-network-graph-storage-model.md), [survey lifecycle](../ASCURE-build-sequence.md)
- **Decision owner:** domain owner + build
- **Supersedes:** the north-star "Org → **Branch** → Mainhead → Team" hierarchy line (Branch is retired here)

---

## Context

The role/hierarchy model exists in the schema but is **under-enforced and mis-shaped** for how the business actually runs, especially for contractors:

1. **Roles don't differentiate scope.** `accessScope()` ([site-visits.service.ts:2404](../../apps/api/src/site-visits/site-visits.service.ts)) gives **every** non-admin, non-QA user the *same* visibility — "visits of teams I'm a member of." A `MANAGER` does **not** see all teams in their company today; a `SUPERVISOR` has no notion of which teams they oversee. The Org→Manager→Supervisor→Team hierarchy is real on paper, invisible in code.
2. **Work ownership can't move.** A `SiteVisit` is created with a mandatory, **immutable** `teamId`. There is no reassignment — if Team A can't finish a Pencawang, no one can hand it to Team B (only parallel `join()` as a participant, which requires already sharing the team).
3. **Branch is a redundant level.** The schema carries both `Branch` (an Org sub-unit with capability inheritance) and `OperationalRegion` (a tenant-level geographic unit), converging at `Mainhead`. Once management scope is "by Company" and geography is "Region → Mainhead", Branch's two jobs collapse into Org + Region.
4. **Contractors aren't first-class.** `OrganizationType` exists but lacks `MAIN_CONTRACTOR`, and contractor data-isolation isn't enforced.

This ADR realigns the org model, retires Branch, makes role-based visibility real, and adds **work reassignment with billing-grade attribution** — the unit of ownership being the *work* (`SiteVisit`), never the Pencawang permanently.

## Decision

### 1. Organization types & company hierarchy
`OrganizationType` becomes:
```prisma
enum OrganizationType {
  ASCURE          // platform owner — oversees everything (god scope)
  TNB             // asset owner; carries the geography (Region → Mainhead)
  MAIN_CONTRACTOR // manages its SUBCONTRACTORs
  SUBCONTRACTOR   // executes field work
  CLIENT          // read-only / demo for prospective clients
}
```
- **Add** `MAIN_CONTRACTOR`; **drop** `CONSULTANT` and `OTHER`.
- Company nesting uses the **existing** `Organization.parentOrganizationId`: a `SUBCONTRACTOR`'s parent is its `MAIN_CONTRACTOR`. The Organization is the unit of **management scope and contractor data-isolation**.
- `CLIENT` orgs/users stay read-only via the existing gate (`assertCanMutate` blocks `VIEWER`/`CLIENT`).

### 2. Retire Branch — two clean axes
Drop `Branch` and `BranchCapability`. The hierarchy splits into two orthogonal axes that meet at the work:

- **Management / RBAC axis:** `Organization (Company) → Team` (+ Supervisor's assigned subset, §3).
- **Geography axis:** `OperationalRegion (Region) → Mainhead → Substation/work`.

Schema deltas:
- Remove `branchId` from `Team`, `SiteVisit`, `Mainhead`, `User` (`UserOperationalBranch`), `Project`, `InspectionTemplate`, `OperationalSession`.
- `Mainhead` keeps `operationalRegionId` only (pure geography).
- Migrate `BranchCapability` rows → `OrganizationCapabilityAssignment` (capability inheritance moves up to the company).
- Migrate the geographic intent of each Branch (`Branch.region` text + its mainheads) → the correct `OperationalRegion`.
- **Templates re-scope to Mainhead** (primary, per domain owner): drop `InspectionTemplate.branchId`; the scope chain shortens from `Mainhead → Branch → Region → Org` to `Mainhead → Region → Org`. Branch-scoped templates migrate to their mainhead(s) (or up to Region if they were branch-wide). `InspectionTemplate` already has `mainheadId`/`operationalRegionId`/`organizationId`, so no new columns.

This is a broad but mechanical refactor (**~366 `branchId` refs across ~37 files**) — taken as its **own slice**, drop-last.

### 3. Roles & visibility — make `accessScope()` role-aware
Add an explicit, **geography-independent** supervisor↔team link (per domain owner: "manage multiple teams under the same Company, regardless of Mainhead/Region"):
```prisma
model TeamSupervisor {
  id               String  @id @default(uuid()) @db.Uuid
  teamId           String  @db.Uuid
  supervisorUserId String  @db.Uuid
  isActive         Boolean @default(true)
  @@unique([teamId, supervisorUserId])
  @@index([supervisorUserId])
}
```
Extend `accessScope()` by role (everything still `AND tenantId`):

| Actor | Visibility scope |
|---|---|
| **ASCURE / ADMIN** | all visits (tenant-wide) |
| **MANAGER** | all teams where `team.organizationId = my org` (whole company) |
| **SUPERVISOR** | teams in my `TeamSupervisor` set (a subset of my company) |
| **TECHNICIAN / team member** | team membership (unchanged) |
| **QA actor** | mainhead access (unchanged) |
| **VIEWER / CLIENT** | as above, read-only |

**Contractor isolation falls out for free:** a contractor `MANAGER` is scoped to *their own org*, so they never see TNB's or another contractor's work. *(Initially a small company may link its one Supervisor to all teams; as it grows it adds teams + supervisors with narrower `TeamSupervisor` sets — no model change.)*

### 4. Ownership = the SiteVisit; add reassignment
Ownership is `SiteVisit.teamId` — **already exists**, no new entity. Reassignment is "change `teamId`, atomically, with an audit + a contribution snapshot."

```
POST /site-visits/:id/reassign  { toTeamId, reason }
```
- **Allowed only** when `lifecycleStatus ∈ { DALAM_RONDAAN (in-progress), PERLU_PINDAAN (rejected) }`. Blocked on `RONDAAN_SELESAI` / `LAPORAN_SELESAI` / `ARKIB` and `status COMPLETED/CANCELLED`.
- **Offline gate:** reassign is blocked until the outgoing team's device sync queue is flushed (no pending `SiteVisit`/inspection mutations) — Team B inherits a consistent, fully-synced state, nothing lost in transit.
- **Authz:** same-org reassign → `SUPERVISOR` (over both teams) / `MANAGER` / `ADMIN`. **Cross-org** reassign (`toTeam` in a different Organization) → `ADMIN` only.
- **On reassign (one transaction):** snapshot the outgoing team's contribution (§5) → write a reassignment audit row → set `teamId = toTeamId`. **Team A loses the Pencawang entirely — live *and* historical** (the new `teamId` no longer matches its `accessScope`, and the history view applies the same filter). All inspections / photos / defects hang off the `SiteVisit`, so **they transfer automatically — Team B continues, nothing redone.** `SiteVisitUser` participant rows from Team A are **kept in the DB for billing attribution** but are never surfaced back to Team A.
- Exposed in **both** the admin web (managers/supervisors) and a supervisor action in mobile.

```prisma
model SiteVisitReassignment {           // audit trail
  id                 String   @id @default(uuid()) @db.Uuid
  siteVisitId        String   @db.Uuid
  fromTeamId         String   @db.Uuid
  toTeamId           String   @db.Uuid
  reason             String
  reassignedByUserId String   @db.Uuid
  createdAt          DateTime @default(now())
  @@index([siteVisitId])
}
```

### 5. Billing-grade attribution — contribution ledger
Because work can be split across teams, "who did what %" must be recorded, not inferred:
```prisma
model SiteVisitTeamContribution {
  id              String   @id @default(uuid()) @db.Uuid
  siteVisitId     String   @db.Uuid
  teamId          String   @db.Uuid
  assetsCompleted Int                       // assets with a COMPLETED inspection by this team at snapshot
  totalAssets     Int                       // denominator at snapshot time
  snapshotReason  String                    // "REASSIGNED" | "COMPLETED"
  snapshotAt      DateTime @default(now())
  @@index([siteVisitId])
  @@index([teamId])
}
```
A row is written for the **outgoing team at each handover** and for the **final team at completion**. Sum across rows = each team's share of the Pencawang for contractor billing. **"Done" = an asset with a completed inspection** (per domain owner) — the metric is inspection-count, not visits or time.

## Alternatives considered

- **(A) Own the Pencawang (teamId on `Substation`).** Rejected: a Substation is surveyed every cycle; ownership must live on the *work* (`SiteVisit`) or next cycle's assignment is stuck on last cycle's team.
- **(B) Keep Branch as the management level.** Rejected: with Supervisor scoped by Company (geography-independent) and Region as the geographic level, Branch is a redundant tier; its `region` text already duplicates `OperationalRegion`.
- **(C) Derive supervisor scope from geography (Region/Mainhead).** Rejected: domain owner requires a supervisor's teams to span the company "regardless of Mainhead/Region" → needs an explicit link (`TeamSupervisor`).
- **(D) Open cross-team visibility (the earlier "anyone continues anyone's work" idea).** Rejected in favour of scoped visibility + *controlled, audited* reassignment — accountable and keeps each team's screen clean.
- **(E) New generic "assignment" entity.** Rejected: `SiteVisit.teamId` already is the assignment; reuse it.

## Consequences

- **Prod has live data — migration is staged:**
  1. `OrganizationType`: add `MAIN_CONTRACTOR` (additive); **before** dropping `CONSULTANT`/`OTHER`, repoint any rows using them (likely none in pilot — verify first).
  2. **Branch retire (its own slice):** (i) migrate `BranchCapability` → org, branch→mainhead geography → region; (ii) backfill `Mainhead.operationalRegionId`; (iii) drop `branchId` columns + `Branch`/`BranchCapability` tables; (iv) refactor the ~37 files. Additive-first, **drop last**, after the data move is verified.
  3. New tables `TeamSupervisor`, `SiteVisitReassignment`, `SiteVisitTeamContribution` are purely additive.
- **Back-compat:** `SiteVisit.teamId` shape unchanged; reassignment + ledger are additive; technician visibility unchanged; managers/supervisors **gain** visibility — no one loses access except via Branch removal.
- **North-star update required (on accept):** rewrite the "Org → Branch → Mainhead → Team" lines to the two-axis model and amend the "Keep" list to drop Branch.
- **Sequencing:** ship as two independent slices — **(S1) reassignment + role-aware `accessScope` + contribution ledger** (high value, additive) and **(S2) Branch retire** (broad, drop-last). S1 does not depend on S2.

## Resolutions (2026-06-11)

1. **Offline handover → flush first.** Reassign is blocked until the outgoing team's offline sync queue is empty (baked into §4 *Offline gate*).
2. **Contribution metric → inspection-count.** "Done" = an asset with a **completed inspection** (§5). Not weighted, not time-based.
3. **"Lose entirely" → includes history.** Team A loses live *and* historical visibility; contribution rows persist in the DB for billing but are never surfaced to Team A.
4. **Tenancy → one tenant per utility; contractors are Organizations inside it** *(confirmed 2026-06-11)*. A **Tenant** is the hard data wall — it maps to a **utility** (TNB now; SESB / SESCO / TM later, each its own tenant). **Organizations** (ASCURE / TNB / main- / sub-contractor / client) live *inside* a tenant with soft, role-based isolation. Contractors must share TNB's asset register, and reassignment is a same-tenant `teamId` flip — so separate tenants are unworkable; contractor↔contractor isolation is done by org-scoping, not tenancy. **Refinement:** `Organization` has no `tenantId` today (it's global) — add one so multi-utility productization can't leak contractors across utilities.
5. **Template scoping → Mainhead-primary.** Drop `InspectionTemplate.branchId`; group by **Mainhead** with Region/Org fallback (§2). No new columns — `mainheadId` already exists.

→ All five resolved; ADR **Accepted (2026-06-11)**. Build order: **S1** (reassignment + role-aware visibility + contribution ledger) first; **S2** (Branch retire) drop-last.
