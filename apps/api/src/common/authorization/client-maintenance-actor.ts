import { ClientRank, OrganizationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../interfaces/request-user.interface';

/**
 * TNB ranks that may ACT in the maintenance flow (docs/PLAN-maintenance-flow.md
 * §4.2): assign / reassign a PE to a company (incl. unrouted emergencies),
 * verify / reject / re-open a repair, and decide "cannot repair" items.
 * ENGINEER is deliberately absent — view only.
 */
export const CLIENT_MAINTENANCE_ACTOR_RANKS: ReadonlySet<ClientRank> = new Set([
  ClientRank.FOREMAN,
  ClientRank.TECHNICIAN,
]);

type ClientMaintenanceActorShape = {
  role: UserRole;
  clientRank: ClientRank | null;
  organization: {
    type: OrganizationType;
    isActive: boolean;
  } | null;
};

/**
 * A rank is only ever honoured on a CLIENT user inside an ACTIVE TNB
 * organization — the rank never lifts a contractor or ASCURE account, and a
 * deactivated TNB org loses its authority. Everything else stays read-only.
 */
export function hasClientMaintenanceActorShape(
  user: ClientMaintenanceActorShape,
): boolean {
  return (
    user.role === UserRole.CLIENT &&
    user.organization?.type === OrganizationType.TNB &&
    user.organization.isActive === true &&
    user.clientRank !== null &&
    CLIENT_MAINTENANCE_ACTOR_RANKS.has(user.clientRank)
  );
}

/**
 * Whether the caller is a TNB Foreman / Technician allowed to act on
 * maintenance. The maintenance endpoints use this as the ONLY exception to the
 * CLIENT read-only rule; survey / inspection mutations never consult it.
 */
export async function isClientMaintenanceActor(
  prisma: PrismaService,
  user: RequestUser,
): Promise<boolean> {
  if (user.role !== UserRole.CLIENT) {
    return false;
  }

  const record = await prisma.user.findFirst({
    where: { id: user.id, tenantId: user.tenantId, isActive: true },
    select: {
      role: true,
      clientRank: true,
      organization: { select: { type: true, isActive: true } },
    },
  });

  return record ? hasClientMaintenanceActorShape(record) : false;
}
