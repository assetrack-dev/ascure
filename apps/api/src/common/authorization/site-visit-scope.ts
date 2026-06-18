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
  // personally belong to. (north-star §5 / ADR 0002 §3)
  if (user.role === UserRole.MANAGER && user.organizationId) {
    return {
      team: {
        OR: [{ organizationId: user.organizationId }, ownTeamMembership],
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
