import { UserRole } from '@prisma/client';
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
}

export async function buildScopeContext(
  prisma: PrismaService,
  user: RequestUser,
): Promise<ScopeContext> {
  const isAdmin = user.role === UserRole.ADMIN;

  if (isAdmin) {
    return { isAdmin: true, isQa: false, qaMainheadIds: [] };
  }

  const isQa = await isQaActor(prisma, user);

  if (!isQa) {
    return { isAdmin: false, isQa: false, qaMainheadIds: [] };
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
  };
}
