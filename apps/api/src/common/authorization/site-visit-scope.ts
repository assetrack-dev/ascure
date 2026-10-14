import { Prisma, UserRole } from '@prisma/client';
import { RequestUser } from '../interfaces/request-user.interface';
import { ScopeContext } from './scope-context';

/**
 * Canonical role-aware SiteVisit visibility filter (ADR 0002 §3 / north-star §5).
 *
 * Single source of truth for "which site visits — and, transitively, which
 * inspections / defects / assets — may this user see". Returns a
 * Prisma.SiteVisitWhereInput so it can be used directly on a SiteVisit query, or
 * nested under `siteVisit` (Inspection/Defect queries) or
 * `inspections.some.siteVisit` / `createdDuringVisit` (Asset queries).
 *
 * - ADMIN      : empty filter (full tenant visibility).
 * - QA actor   : visits in a MAINHEAD the QA user has access to (ctx.qaMainheadIds).
 * - MANAGER    : every team in their own Organization, plus their own teams.
 * - SUPERVISOR : teams they are explicitly assigned to (TeamSupervisor), plus own teams.
 * - Other      : their own teams only.
 *
 * `ctx` is built once per request by buildScopeContext(); when omitted, legacy
 * (non-QA) behaviour is preserved for callers that haven't been migrated yet.
 *
 * SiteVisitsService.accessScope and DefectsService.inspectionAccessScope are
 * thin wrappers over this; keep the matrix here so they cannot drift apart.
 */
export function siteVisitAccessWhere(
  user: RequestUser,
  ctx?: ScopeContext,
): Prisma.SiteVisitWhereInput {
  return buildSiteVisitScope(user, ctx, false);
}

/**
 * READ-ONLY oversight variant of {@link siteVisitAccessWhere}.
 *
 * Identical to the strict scope for every role EXCEPT a MANAGER, whose company
 * filter widens from "own Organization" to "own Organization + the company's
 * active SUBCONTRACTOR subtree" (`ctx.maintenanceOrgIds` — own org plus every
 * active contractor descendant, already resolved once per request by
 * buildScopeContext / resolveMaintenanceOrgIds). This lets a MAIN_CONTRACTOR
 * manager MONITOR the site visits / inspections / dashboards / map of work it
 * delegated to its subcontractors, without gaining any write access.
 *
 * ⚠ READ PATHS ONLY. Every mutation / approval / lifecycle gate MUST keep using
 * {@link siteVisitAccessWhere} (strict, own-org): those gates rely on the scope
 * filter as their company boundary, so widening them here would let a main
 * contractor edit / approve / complete / claim a subcontractor's work. The
 * widening is self-limiting — for any role other than MANAGER, or a MANAGER
 * with no subcontractors (maintenanceOrgIds = [own org]), this returns exactly
 * the same filter as siteVisitAccessWhere.
 */
export function siteVisitOversightWhere(
  user: RequestUser,
  ctx?: ScopeContext,
): Prisma.SiteVisitWhereInput {
  return buildSiteVisitScope(user, ctx, true);
}

/**
 * MAP read scope. Like {@link siteVisitOversightWhere}, but a TECHNICIAN also
 * sees (read-only) their own company's OTHER teams working a MAINHEAD where
 * their own team works (`ctx.crossTeamMainheadIds`) — so same-area crews see
 * each other's poles on the map and don't double-inspect one. MAP READS ONLY:
 * the work queue stays on oversight scope, and every mutation stays on the
 * strict {@link siteVisitAccessWhere}, so a technician can look but not touch
 * another team's work.
 */
export function siteVisitMapWhere(
  user: RequestUser,
  ctx?: ScopeContext,
): Prisma.SiteVisitWhereInput {
  return buildSiteVisitScope(user, ctx, true, true);
}

function buildSiteVisitScope(
  user: RequestUser,
  ctx: ScopeContext | undefined,
  includeManagedOrgs: boolean,
  includeCrossTeamMainhead = false,
): Prisma.SiteVisitWhereInput {
  if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
    return {};
  }

  if (ctx?.isQa) {
    return {
      mainheadId: { in: ctx.qaMainheadIds },
    };
  }

  // CLIENT VIEWER (TNB / CLIENT org): scoped by WHOSE NETWORK IT IS, not by who
  // did the work — every survey on their assigned MAINHEADs, whichever company
  // performed it. Fails closed: an empty assignment list yields `in: []`, which
  // matches nothing on BOTH branches (the team filter below would have matched
  // nothing anyway, since a client user belongs to no crew team).
  //
  // ⚠ TWO branches on purpose. SiteVisit.mainheadId is NULLABLE and is stamped
  // at check-in, but the client's progress + map scopes reach a pole through
  // `substation.mainheadId` instead. Matching only the visit's own column would
  // silently drop a survey whose Mainhead was never stamped — its poles would
  // show on the client's map while the survey itself vanished from their feed.
  //
  // A TNB SUPERVISOR (plan §19 N55, step 4c) additionally sees only the surveys
  // its companies performed — the survey's company is its TEAM's organization
  // (SiteVisit.organizationId is optional and not reliable).
  if (ctx?.isClientViewer) {
    const network: Prisma.SiteVisitWhereInput = {
      OR: [
        { mainheadId: { in: ctx.clientMainheadIds } },
        { substation: { mainheadId: { in: ctx.clientMainheadIds } } },
      ],
    };
    const companyIds = ctx.clientSupervisorCompanyIds;
    if (!companyIds) {
      return network;
    }
    return {
      AND: [network, { team: { organizationId: { in: companyIds } } }],
    };
  }

  // Every actor at minimum sees visits of teams they actively belong to.
  const ownTeamMembership: Prisma.TeamWhereInput = {
    members: {
      some: {
        userId: user.id,
        isActive: true,
      },
    },
  };

  // MANAGER: all teams in their own company (Organization), plus any team they
  // personally belong to. (north-star §5 / ADR 0002 §3). The oversight variant
  // additionally spans the company's active subcontractor subtree — read-only,
  // so a main contractor can monitor (not mutate) the work it delegated.
  if (user.role === UserRole.MANAGER && user.organizationId) {
    const managedOrgIds =
      includeManagedOrgs && ctx?.maintenanceOrgIds?.length
        ? ctx.maintenanceOrgIds
        : null;
    const orgFilter: Prisma.TeamWhereInput = managedOrgIds
      ? { organizationId: { in: managedOrgIds } }
      : { organizationId: user.organizationId };
    return {
      team: {
        OR: [orgFilter, ownTeamMembership],
      },
    };
  }

  // SUPERVISOR: the teams they are explicitly assigned to via TeamSupervisor
  // (a company-scoped, geography-independent subset), plus their own teams.
  if (user.role === UserRole.SUPERVISOR) {
    return {
      team: {
        OR: [
          {
            supervisors: {
              some: { supervisorUserId: user.id, isActive: true },
            },
          },
          ownTeamMembership,
        ],
      },
    };
  }

  // TECHNICIAN (MAP read only): own teams' visits PLUS their own company's other
  // teams working a MAINHEAD where their team also works — read-only coordination
  // so crews don't double-inspect a pole. Gated to the MAP scope
  // (includeCrossTeamMainhead); the work queue + every mutation stay own-team.
  if (
    includeCrossTeamMainhead &&
    user.role === UserRole.TECHNICIAN &&
    user.organizationId &&
    ctx?.crossTeamMainheadIds?.length
  ) {
    return {
      OR: [
        { team: ownTeamMembership },
        {
          team: { organizationId: user.organizationId },
          mainheadId: { in: ctx.crossTeamMainheadIds },
        },
      ],
    };
  }

  // TECHNICIAN / VIEWER / CLIENT: only their own teams' visits.
  return { team: ownTeamMembership };
}

/**
 * The Pencawang a CLIENT viewer may see: those under its organization's
 * Mainheads. A TNB SUPERVISOR (plan §19 N55, step 4c — owner chose "by
 * Pencawang", 2026-10-14) sees only the Pencawang where one of its companies
 * has a survey, but then EVERY pole there — so Progress keeps real totals
 * (120 / 150 surveyed) instead of only the poles its crews touched.
 * Fails closed: no Mainhead / no company → `in: []` → nothing.
 */
export function clientSubstationWhere(
  ctx: ScopeContext,
): Prisma.SubstationWhereInput {
  const companyIds = ctx.clientSupervisorCompanyIds;
  return {
    mainheadId: { in: ctx.clientMainheadIds },
    ...(companyIds
      ? { siteVisits: { some: { team: { organizationId: { in: companyIds } } } } }
      : {}),
  };
}

/** Poles a CLIENT viewer may see — every pole of a {@link clientSubstationWhere} Pencawang. */
export function clientAssetWhere(ctx: ScopeContext): Prisma.AssetWhereInput {
  return { substation: clientSubstationWhere(ctx) };
}

/**
 * Asset visibility filter for the STRICT own-company scope. An Asset row carries
 * no team/org/mainhead column, so scope is applied transitively: an asset is
 * visible when the caller created it, has an inspection on it, or it was created
 * during a visit they may access ({@link siteVisitAccessWhere}). ADMIN → {}
 * (tenant-wide).
 *
 * Single source of truth shared by MasterDataService.listAssets (the company-
 * scoped /assets table) and AssetsService.mutableAssetScope (the edit/delete
 * gate), so the read scope and the mutation gate cannot drift apart.
 */
export function assetAccessWhere(
  user: RequestUser,
  ctx?: ScopeContext,
): Prisma.AssetWhereInput {
  if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
    return {};
  }
  const scopeWhere = siteVisitAccessWhere(user, ctx);
  return {
    OR: [
      { createdByUserId: user.id },
      { inspections: { some: { siteVisit: scopeWhere } } },
      { createdDuringVisit: scopeWhere },
    ],
  };
}

/**
 * Oversight variant of {@link assetAccessWhere}: identical, but the transitive
 * site-visit scope widens to {@link siteVisitOversightWhere}, so a MAIN_CONTRACTOR
 * manager also sees the assets of its active SUBCONTRACTOR subtree
 * (`ctx.maintenanceOrgIds`). Self-limiting — for any role other than a MANAGER, or
 * a MANAGER with no subcontractors, this returns exactly the same filter as
 * assetAccessWhere.
 *
 * Feeds the /assets table read scope (MasterDataService.listAssets) and the
 * cross-org DELETE scope (AssetsService.deletableAssetScope). The strict
 * {@link assetAccessWhere} still guards asset EDIT (AssetsService.mutableAssetScope):
 * a main contractor may VIEW + DELETE, but not EDIT, a subcontractor's poles.
 */
export function assetOversightWhere(
  user: RequestUser,
  ctx?: ScopeContext,
): Prisma.AssetWhereInput {
  if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
    return {};
  }
  const scopeWhere = siteVisitOversightWhere(user, ctx);
  return {
    OR: [
      { createdByUserId: user.id },
      { inspections: { some: { siteVisit: scopeWhere } } },
      { createdDuringVisit: scopeWhere },
    ],
  };
}
