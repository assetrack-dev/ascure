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
  /**
   * MAINHEAD IDs a TECHNICIAN may additionally SEE ON THE MAP (read-only) — the
   * Mainheads "where their own team works", so same-company crews in the same
   * Mainhead can see each other's poles and avoid double-inspecting. Empty for
   * non-technicians. Widens the MAP read scope ONLY (siteVisitMapWhere); the
   * work queue + every mutation stay strict own-team.
   */
  crossTeamMainheadIds: string[];
  /**
   * The caller is a CLIENT viewer — a user in a TNB / CLIENT organization, i.e.
   * the party who OWNS the network rather than one of the companies working it.
   */
  isClientViewer: boolean;
  /**
   * MAINHEAD IDs a client viewer may see, from their organization's active
   * {@link OrganizationMainhead} assignments.
   *
   * ⚠ Client scope is orthogonal to contractor scope: a contractor is scoped by
   * WHO DID THE WORK (team / organization), a client by WHOSE NETWORK IT IS
   * (Mainhead) — so TNB sees every survey on its own lines no matter which
   * subcontractor performed it. Only populated when isClientViewer is true;
   * EMPTY means the client org has no Mainhead assigned and must see NOTHING
   * (fail closed — never widen to the tenant).
   */
  clientMainheadIds: string[];
}

/** Organization types that OWN the network rather than work it. */
const CLIENT_ORG_TYPES: ReadonlySet<OrganizationType> = new Set([
  OrganizationType.TNB,
  OrganizationType.CLIENT,
]);

export async function buildScopeContext(
  prisma: PrismaService,
  user: RequestUser,
): Promise<ScopeContext> {
  const isAdmin = user.role === UserRole.ADMIN;

  if (isAdmin) {
    return {
      isAdmin: true,
      isQa: false,
      qaMainheadIds: [],
      maintenanceOrgIds: [],
      crossTeamMainheadIds: [],
      isClientViewer: false,
      clientMainheadIds: [],
    };
  }

  const [maintenanceOrgIds, crossTeamMainheadIds, isQa, client] =
    await Promise.all([
      resolveMaintenanceOrgIds(prisma, user),
      resolveCrossTeamMainheadIds(prisma, user),
      isQaActor(prisma, user),
      resolveClientScope(prisma, user),
    ]);

  if (!isQa) {
    return {
      isAdmin: false,
      isQa: false,
      qaMainheadIds: [],
      maintenanceOrgIds,
      crossTeamMainheadIds,
      ...client,
    };
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
    crossTeamMainheadIds,
    ...client,
  };
}

/**
 * Client (network-owner) scope: the MAINHEADs assigned to the caller's TNB /
 * CLIENT organization. Any other org type is not a client viewer and gets the
 * empty result, so this can be resolved unconditionally.
 *
 * ⚠ FAILS CLOSED. A client org with no active Mainhead assignment yields an
 * EMPTY list, and every consumer must read that as "see nothing" — never as
 * "unscoped". Assignments are managed through the existing ADMIN
 * Company↔MAINHEAD screen.
 */
async function resolveClientScope(
  prisma: PrismaService,
  user: RequestUser,
): Promise<{ isClientViewer: boolean; clientMainheadIds: string[] }> {
  if (!user.organizationId) {
    return { isClientViewer: false, clientMainheadIds: [] };
  }

  // Look up by id only — `Organization.tenantId` is NULLABLE and real rows carry
  // null, so filtering on it silently matches nothing. Safe without the filter:
  // the id comes from the caller's OWN user row, which the JWT strategy already
  // loaded tenant-scoped. Matches how dashboard/defects read an organization.
  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { type: true },
  });

  if (!organization || !CLIENT_ORG_TYPES.has(organization.type)) {
    return { isClientViewer: false, clientMainheadIds: [] };
  }

  const assignments = await prisma.organizationMainhead.findMany({
    where: {
      organizationId: user.organizationId,
      isActive: true,
      mainhead: { isActive: true },
    },
    select: { mainheadId: true },
  });

  return {
    isClientViewer: true,
    clientMainheadIds: assignments.map((row) => row.mainheadId),
  };
}

/**
 * MAINHEAD IDs a TECHNICIAN may additionally SEE ON THE MAP (read-only) — the
 * Mainheads "where their own team works", so same-company crews in the same
 * Mainhead can see each other's poles and avoid double-inspecting. Derived from
 * the technician's active teams: each team's assigned MAINHEAD plus the
 * MAINHEADs of that team's site visits. Empty for any non-technician, or a
 * technician with no company/teams — they keep own-team-only visibility. This
 * widens the MAP read scope ONLY; the work queue + every mutation stay own-team.
 */
async function resolveCrossTeamMainheadIds(
  prisma: PrismaService,
  user: RequestUser,
): Promise<string[]> {
  if (user.role !== UserRole.TECHNICIAN || !user.organizationId) {
    return [];
  }

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id, isActive: true },
    select: { teamId: true, team: { select: { mainheadId: true } } },
  });
  const teamIds = memberships.map((row) => row.teamId);
  if (teamIds.length === 0) {
    return [];
  }

  const ids = new Set<string>();
  for (const row of memberships) {
    if (row.team?.mainheadId) {
      ids.add(row.team.mainheadId);
    }
  }

  const visits = await prisma.siteVisit.findMany({
    where: {
      tenantId: user.tenantId,
      teamId: { in: teamIds },
      mainheadId: { not: null },
    },
    select: { mainheadId: true },
    distinct: ['mainheadId'],
  });
  for (const visit of visits) {
    if (visit.mainheadId) {
      ids.add(visit.mainheadId);
    }
  }

  return Array.from(ids);
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
export async function resolveMaintenanceOrgIds(
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
