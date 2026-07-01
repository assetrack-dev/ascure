# PLAN — Manager-settable Mainhead / operational grants (spec, not built)

> Status: **SPEC for review (2026-07-01).** Follow-up to the observation that a MANAGER
> can't set Mainhead/Region/asset-domain for their team or users. Decisions needed before build.

## Why it's blocked today (verified)

- **User form** ([users-client.tsx:619](../apps/admin-web/src/components/users-client.tsx),
  gate `isManagerOnly` at :987): the Mainhead / Region / Capability pickers render **only for
  ADMIN**. And the API **strips** them for a manager on both paths —
  `resolveCreateScope` ([users.service.ts:250](../apps/api/src/users/users.service.ts)) and
  `applyManagerUpdateScope` ([:319](../apps/api/src/users/users.service.ts)) blank out
  `branchId, mainheadId, capabilityIds, mainheadAccessIds, operationalRegionAccessIds, accessRole`.
  Rationale (code comment): *"never grant advanced access … to avoid privilege escalation."*
- **Team form** (generic `enterprise-list-client.tsx`; `lockTeamOrganization` at :1439/:872):
  hides **org + branch + Mainhead** for a manager, but **keeps** the Workspace / Governance /
  Asset-Domain **capability** groups. Unlike users, the **teams API does NOT strip `mainheadId`
  or `capabilityIds`** — it only pins the organization (`resolveManagedOrganizationId` :370). So the
  team-Mainhead block is **UI-only**.

## Security facts that shape the design (verified)

1. **Team-level `QA_VALIDATION` is INERT.** `isQaActor`
   ([qa-actor.ts:23](../apps/api/src/common/authorization/qa-actor.ts)) requires the **user's own**
   `capabilityAssignments` **and** `organization.type === ASCURE`. A manager's team getting the QA
   checkbox confers no governance.
2. **Team-level `REPORTING` is EFFECTIVE.** `resolveCanReport`
   ([reporting-actor.ts:25](../apps/api/src/common/authorization/reporting-actor.ts)) resolves the
   effective-capability model **including team level** — *"REPORTING may be granted at the
   organization, branch or team level."* So a manager checking **REPORTING** on a team **grants their
   crew export access today.** Real, un-audited escalation.
3. **Server already validates team Mainhead ∈ company.** `resolveOperationalLinks`
   ([teams.service.ts:547](../apps/api/src/teams/teams.service.ts)) rejects a Mainhead whose
   `branch.organizationId` ≠ the (manager-pinned) org. **Gap:** a *region-only* Mainhead (no branch)
   skips that check.
4. **Mainhead has a company; Region does not.** `Mainhead.branch.organizationId` gives a company for
   **branch-based** Mainheads. `OperationalRegion` ([schema.prisma:629](../prisma/schema.prisma)) is
   **tenant-scoped** (no `organizationId`) and region-based Mainheads are company-less. → Mainhead can
   be company-scoped for a manager; **Region cannot** (granting it = tenant-wide visibility).
5. **Capability classes** ([capability-groups.ts](../apps/admin-web/src/lib/capability-groups.ts)):
   WORKSPACE = {INSPECTION, MAINTENANCE}; GOVERNANCE = {QA_VALIDATION, REPORTING};
   ASSET_DOMAIN = {SAVR, SAVT, PENCAWANG, FEEDER_PILLAR, LINK_BOX, CABLE_BRIDGE, UNDERGROUND_CABLE,
   THERMAL_INSPECTION}. This classifier is **client-only** today; the guarded loosenings below need a
   **server-side twin** (a `GOVERNANCE_CAPABILITY_CODES` set in `common/authorization`).

---

## Item A — Manager may set a TEAM's Mainhead  *(easy; UI + 1 guard)*

**Change**
- **UI** (`enterprise-list-client.tsx`): for a manager on teams, keep org+branch hidden but render a
  **Mainhead picker** whose options are filtered to `options.mainheads` where the mainhead's company
  (`branch.organizationId`) === `session.user.organizationId`. Options already carry `organizationId`/
  `branchId` (`EnterpriseOptionRecord`), so this is a client-side filter.
- **API hardening** (`teams.service.resolveOperationalLinks` / create+update): for a **non-ADMIN**,
  reject a Mainhead that isn't branch-owned by the manager's company — closes the region-only-Mainhead
  gap (#3 above). Branch-based Mainheads are already validated.

**Effort:** small (admin-web + one server guard). **Decision A:** allow it? *(recommend yes)*

---

## Item B — Manager may set a USER's Mainhead access + operational capabilities  *(guarded loosening)*

**Change (API — the guardrails are the point):** in `resolveCreateScope` + `applyManagerUpdateScope`,
for a MANAGER:
- **Allow `mainheadAccessIds`** (and the derived legacy `mainheadId`) **but validate** every id is a
  company-owned Mainhead (`branch.organizationId === actor.organizationId`); reject anything else.
- **Keep `operationalRegionAccessIds` STRIPPED** — Regions are tenant-global (#4), so this stays
  ADMIN-only.
- **Allow `capabilityIds` limited to WORKSPACE + ASSET_DOMAIN**; **strip GOVERNANCE**
  (`QA_VALIDATION`, `REPORTING`) server-side via the new shared classifier.
- **Keep `accessRole` and `branchId` ADMIN-only** (accessRole is the QA/UserMainheadAccess role).

**Change (UI — `users-client.tsx`):** show a **reduced** advanced section for managers: a Mainhead
Access picker (company-scoped options) + a Capability picker restricted to Workspace + Asset Domains.
Hide Region Access, the Governance capability group, and the access-role control.

**Effort:** moderate (2 server validators + shared classifier + UI un-gate with filtered options).
**Decisions B:** (B1) allow manager → user Mainhead access, company-scoped? *(rec yes)* ·
(B2) Region access stays ADMIN-only? *(rec yes)* · (B3) managers may grant Workspace + Asset-Domain
capabilities to users but NOT governance? *(rec yes)*

---

## Item C — Close the team REPORTING escalation  *(small tightening of existing behaviour)*

Today a manager can grant a **team** the `REPORTING` capability, which is effective (#2). QA_VALIDATION
is inert (#1) but confusing.

**Change:** strip GOVERNANCE-group capabilities (`QA_VALIDATION`, `REPORTING`) from a **manager's**
team create/update **server-side** (teams.service, before `syncTeamCapabilities`) using the shared
classifier, and **hide the "Governance & Reporting" group** on the manager team form. Aligns teams
with the user-form guard.

**Effort:** small. **Decision C:** managers should NOT grant governance/reporting to teams? *(recommend
yes — this removes a real, currently-live escalation.)*

---

## Shared prerequisite

A server-side capability classifier `GOVERNANCE_CAPABILITY_CODES = {QA_VALIDATION, REPORTING}` in
`apps/api/src/common/authorization/` (twin of the client `capability-groups.ts`), used by Items B and C.

## Surfaces / deploy shape

- Admin-web only for the UI (managers provision users/teams there, not on mobile).
- API changes to `users.service.ts`, `teams.service.ts`, + one shared const. **No migration.**
- All own-company scoped; no new roles.

## Not in scope

- "Workspace" and "asset domain" the owner named map to **capabilities** (Workspace / Asset-Domain
  groups), covered by Item B/A — there is no separate team/user "operational domain" field on these
  forms. Visit-level `operationalDomain` is a different surface, untouched here.
