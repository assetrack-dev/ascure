import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClientRank, OrganizationType, Prisma, UserRole } from '@prisma/client';
import { canManageClientSupervisorsShape } from '../common/authorization/client-maintenance-actor';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const CONTRACTOR_TYPES: OrganizationType[] = [OrganizationType.MAIN_CONTRACTOR, OrganizationType.SUBCONTRACTOR];

const SUPERVISOR_SELECT = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  organization: { select: { id: true, name: true } },
  clientCompanyAccesses: {
    select: { organization: { select: { id: true, name: true, isActive: true } } },
    orderBy: { organization: { name: 'asc' } },
  },
} satisfies Prisma.UserSelect;

/** TNB Supervisors ↔ the contractor companies they handle (plan §19, N55). */
@Injectable()
export class ClientSupervisorsService {
  constructor(private readonly prisma: PrismaService) {}

  /** ADMIN → every TNB org (null); a TNB Foreman / Technician → its own TNB org. */
  private async managerScope(user: RequestUser): Promise<{ tnbOrganizationId: string | null }> {
    const record = await this.prisma.user.findFirst({
      where: { id: user.id, tenantId: user.tenantId, isActive: true },
      select: {
        role: true,
        clientRank: true,
        organizationId: true,
        organization: { select: { type: true, isActive: true } },
      },
    });
    if (!record || !canManageClientSupervisorsShape(record)) {
      throw new ForbiddenException('Only an admin or a TNB Foreman / Technician can manage TNB Supervisors.');
    }
    return { tnbOrganizationId: record.role === UserRole.ADMIN ? null : record.organizationId };
  }

  private supervisorWhere(user: RequestUser, tnbOrganizationId: string | null): Prisma.UserWhereInput {
    return {
      tenantId: user.tenantId,
      role: UserRole.CLIENT,
      clientRank: ClientRank.SUPERVISOR,
      organization: { type: OrganizationType.TNB },
      ...(tnbOrganizationId ? { organizationId: tnbOrganizationId } : {}),
    };
  }

  private view(row: Prisma.UserGetPayload<{ select: typeof SUPERVISOR_SELECT }>) {
    return {
      userId: row.id,
      name: row.name,
      email: row.email,
      isActive: row.isActive,
      tnb: row.organization,
      companies: row.clientCompanyAccesses.map((access) => access.organization),
    };
  }

  async list(user: RequestUser) {
    const { tnbOrganizationId } = await this.managerScope(user);
    const [supervisors, companies] = await Promise.all([
      this.prisma.user.findMany({
        where: this.supervisorWhere(user, tnbOrganizationId),
        select: SUPERVISOR_SELECT,
        orderBy: { name: 'asc' },
      }),
      this.prisma.organization.findMany({
        where: {
          isActive: true,
          type: { in: CONTRACTOR_TYPES },
          OR: [{ tenantId: user.tenantId }, { tenantId: null }],
        },
        select: { id: true, name: true, code: true, type: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { supervisors: supervisors.map((row) => this.view(row)), companies };
  }

  /** Replaces the Supervisor's companies with exactly `organizationIds`. */
  async setCompanies(user: RequestUser, supervisorUserId: string, organizationIds: string[]) {
    const { tnbOrganizationId } = await this.managerScope(user);
    const supervisor = await this.prisma.user.findFirst({
      where: { id: supervisorUserId, ...this.supervisorWhere(user, tnbOrganizationId) },
      select: { id: true },
    });
    if (!supervisor) {
      throw new NotFoundException('TNB Supervisor not found.');
    }
    const wanted = [...new Set(organizationIds)];
    const valid = wanted.length
      ? await this.prisma.organization.findMany({
          where: {
            id: { in: wanted },
            isActive: true,
            type: { in: CONTRACTOR_TYPES },
            OR: [{ tenantId: user.tenantId }, { tenantId: null }],
          },
          select: { id: true },
        })
      : [];
    if (valid.length !== wanted.length) {
      throw new BadRequestException('A Supervisor can only handle active contractor companies.');
    }
    await this.prisma.$transaction([
      this.prisma.clientCompanyAccess.deleteMany({
        where: { userId: supervisor.id, organizationId: { notIn: wanted } },
      }),
      ...wanted.map((organizationId) =>
        this.prisma.clientCompanyAccess.upsert({
          where: { userId_organizationId: { userId: supervisor.id, organizationId } },
          create: { userId: supervisor.id, organizationId, createdByUserId: user.id },
          update: {},
        }),
      ),
    ]);
    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: supervisor.id },
      select: SUPERVISOR_SELECT,
    });
    return this.view(updated);
  }
}
