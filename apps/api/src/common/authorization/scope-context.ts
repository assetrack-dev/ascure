import { OrganizationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../interfaces/request-user.interface';
import { isQaActor } from './qa-actor';

/**
 * Governance Fix Package G3 — QA visibility.
 *
 * Pre-computed access context used by site-visits / dashboard / defects
 * scope helpers. Building it once per request keeps the underlying scope
 * helpers synchronous (they remain pure Prisma WhereInput builders).
 *
 * ADMIN  : empty filters (full tenant visibility).
 * QA     : visibility scoped to MAINHEADs the user has explicit access to
 *          via UserMainheadAccess, plus every MAINHEAD inherited through
 *          UserOperationalRegionAccess. Bypasses the team-membership filter.
 * Other  : team-membership filter (legacy behaviour).
 *
 * A QA actor is a user whose Organization.type = ASCURE AND who carries an
 * active QA_VALIDATION capability assignment. See common/authorization/qa-actor.ts.
 */
export interface ScopeContext {
  isAdmin: boolean;
  isQa: boolean;
  /**
   * MAINHEAD IDs visible to a QA actor. Only populated when isQa is true.
   * Empty array means "no MAINHEAD access granted" — i.e. the QA actor is
   * scoped to nothing and should see nothing through the QA bypass.
   */
  qaMainheadIds: string[];
  /**
   * Organization IDs whose ROUTED maintenance defect pool this user may see
   * (maintenance handoff Phase 4 + self-management oversight). Always the user's
   * own operational org; for a MANAGER it additionally includes the company's
   * active SUBCONTRACTOR child orgs, so a main contractor retains oversight of
   * work it delegated. Empty when the user has no operational org. Defects are
   * matched on Defect.maintenanceOrganizationId IN these ids.
   */
  maintenanceOrgIds: string[];
}

export async function buildScopeContext(
  prisma: PrismaService,
  user: RequestUser,
): Promise<ScopeContext> {
  const isAdmin = user.role === UserRole.ADMIN;

  if (isAdmin) {
    return { isAdmin: true, isQa: false, qaMainheadIds: [], maintenanceOrgIds: [] };
  }

  const [maintenanceOrgIds, isQa] = await Promise.all([
    resolveMaintenanceOrgIds(prisma, user),
    isQaActor(prisma, user),
  ]);

  if (!isQa) {
    return { isAdmin: false, isQa: false, qaMainheadIds: [], maintenanceOrgIds };
  }

  const [directAccess, regionAccess] = await Promise.all([
    prisma.userMainheadAccess.findMany({
      where: {
        userId: user.id,
        mainhead: { isActive: true },
      },
      select: { mainheadId: true },
    }),
    prisma.userOperationalRegionAccess.findMany({
      where: {
        userId: user.id,
        operationalRegion: { isActive: true },
      },
      select: { operationalRegionId: true },
    }),
  ]);

  const regionIds = regionAccess
    .map((row) => row.operationalRegionId)
    .filter((id): id is string => Boolean(id));

  const regionMainheads =
    regionIds.length > 0
      ? await prisma.mainhead.findMany({
          where: {
            operationalRegionId: { in: regionIds },
            isActive: true,
          },
          select: { id: true },
        })
      : [];

  const mainheadIds = new Set<string>();

  for (const row of directAccess) {
    mainheadIds.add(row.mainheadId);
  }

  for (const row of regionMainheads) {
    mainheadIds.add(row.id);
  }

  return {
    isAdmin: false,
    isQa: true,
    qaMainheadIds: Array.from(mainheadIds),
    maintenanceOrgIds,
  };
}

/**
 * The org IDs whose routed maintenance defect pool a non-admin user may see: the
 * user's own operational org, plus — for a MANAGER — the company's entire active
 * contractor subtree (subcontractors, their subcontractors, …) so a main
 * contractor keeps oversight of work it delegated, however many levels deep it
 * was re-delegated. Technicians/supervisors get only their own org → exact-match
 * visibility (unchanged from Phase 4). The walk is type-filtered to contractor
 * orgs (mirrors the delegate-target rules) and de-duplicated, so a malformed
 * org graph can't loop or widen the set beyond contractors.
 */
async function resolveMaintenanceOrgIds(
  prisma: PrismaService,
  user: RequestUser,
): Promise<string[]> {
  if (!user.organizationId) {
    return [];
  }

  const ids = new Set<string>([user.organizationId]);

  // Only a MANAGER gets oversight of delegated work; everyone else stays exact-org.
  if (user.role !== UserRole.MANAGER) {
    return Array.from(ids);
  }

  let frontier = [user.organizationId];
  while (frontier.length > 0) {
    const children = await prisma.organization.findMany({
      where: {
        parentOrganizationId: { in: frontier },
        isActive: true,
        type: {
          in: [
            OrganizationType.MAIN_CONTRACTOR,
            OrganizationType.SUBCONTRACTOR,
          ],
        },
      },
      select: { id: true },
    });

    frontier = [];
    for (const child of children) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        frontier.push(child.id);
      }
    }
  }

  return Array.from(ids);
}
