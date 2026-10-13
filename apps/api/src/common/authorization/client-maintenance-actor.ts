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
  // Plan §19 (N55): acts too, but only for its assigned companies — every
  // maintenance service narrows a Supervisor with resolveClientSupervisorCompanyIds.
  ClientRank.SUPERVISOR,
]);

/** TNB ranks that may assign companies to a Supervisor (plus ADMIN). */
export const CLIENT_SUPERVISOR_MANAGER_RANKS: ReadonlySet<ClientRank> = new Set([
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

/**
 * Plan §19 (N55): the contractor companies a TNB Supervisor handles, or null
 * when the caller is not a TNB Supervisor (CLIENT role, active TNB org, rank
 * SUPERVISOR). FAILS CLOSED: a Supervisor with no (active) company gets [] and
 * sees nothing — never "unscoped".
 */
export async function resolveClientSupervisorCompanyIds(
  prisma: PrismaService,
  user: RequestUser,
): Promise<string[] | null> {
  if (user.role !== UserRole.CLIENT) {
    return null;
  }
  const record = await prisma.user.findFirst({
    where: { id: user.id, tenantId: user.tenantId, isActive: true },
    select: {
      role: true,
      clientRank: true,
      organization: { select: { type: true, isActive: true } },
      clientCompanyAccesses: {
        where: { organization: { isActive: true } },
        select: { organizationId: true },
      },
    },
  });
  if (
    !record ||
    record.clientRank !== ClientRank.SUPERVISOR ||
    record.organization?.type !== OrganizationType.TNB ||
    record.organization.isActive !== true
  ) {
    return null;
  }
  return record.clientCompanyAccesses.map((row) => row.organizationId);
}

/** ADMIN, or a TNB Foreman / Technician (active TNB org): may set a Supervisor's companies. */
export function canManageClientSupervisorsShape(user: {
  role: UserRole;
  clientRank: ClientRank | null;
  organization: { type: OrganizationType; isActive: boolean } | null;
}): boolean {
  if (user.role === UserRole.ADMIN) return true;
  return (
    user.role === UserRole.CLIENT &&
    user.organization?.type === OrganizationType.TNB &&
    user.organization.isActive === true &&
    user.clientRank !== null &&
    CLIENT_SUPERVISOR_MANAGER_RANKS.has(user.clientRank)
  );
}
