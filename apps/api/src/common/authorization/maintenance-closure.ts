import {
  OrganizationType,
  ResolutionOutcome,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../interfaces/request-user.interface';
import { buildScopeContext } from './scope-context';

/**
 * Outcomes a contractor reports when it could NOT repair a Kejanggalan (needs an
 * outage, landowner problem, pole replacement …). Owner decision C9: these go
 * back to TNB — only TNB (or ADMIN) decides them; a main contractor cannot
 * close its own "cannot repair" (docs/PLAN-maintenance-flow.md §5.3).
 */
export const CANNOT_REPAIR_OUTCOMES: ReadonlySet<ResolutionOutcome> = new Set([
  ResolutionOutcome.EXTERNAL_CONSTRAINT,
  ResolutionOutcome.ESCALATED,
  ResolutionOutcome.DEFERRED,
]);

export function isCannotRepairOutcome(outcome: ResolutionOutcome | null): boolean {
  return outcome !== null && CANNOT_REPAIR_OUTCOMES.has(outcome);
}

/**
 * The maintenance companies a MAIN CONTRACTOR manager may verify closure for
 * (owner decision C8): their own company plus its active subcontractor subtree.
 * Null when the caller is not a MANAGER of an active MAIN_CONTRACTOR — a
 * subcontractor manager never signs off its own work.
 */
export async function resolveMainContractorOrgIds(
  prisma: PrismaService,
  user: RequestUser,
): Promise<string[] | null> {
  if (user.role !== UserRole.MANAGER || !user.organizationId) {
    return null;
  }

  const organization = await prisma.organization.findUnique({
    where: { id: user.organizationId },
    select: { type: true, isActive: true },
  });
  if (
    organization?.type !== OrganizationType.MAIN_CONTRACTOR ||
    !organization.isActive
  ) {
    return null;
  }

  const ctx = await buildScopeContext(prisma, user);
  return ctx.maintenanceOrgIds.length > 0
    ? ctx.maintenanceOrgIds
    : [user.organizationId];
}
