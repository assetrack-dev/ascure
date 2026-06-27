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

function buildSiteVisitScope(
  user: RequestUser,
  ctx: ScopeContext | undefined,
  includeManagedOrgs: boolean,
): Prisma.SiteVisitWhereInput {
  if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
    return {};
  }

  if (ctx?.isQa) {
    return {
      mainheadId: { in: ctx.qaMainheadIds },
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

  // TECHNICIAN / VIEWER / CLIENT: only their own teams' visits.
  return { team: ownTeamMembership };
}
