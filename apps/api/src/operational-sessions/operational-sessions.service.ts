import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  OperationalSessionScope,
  OperationalSessionStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOperationalSessionDto } from './dto/create-operational-session.dto';
import { ListOperationalSessionsQueryDto } from './dto/list-operational-sessions-query.dto';
import { OperationalSessionActionDto } from './dto/operational-session-action.dto';
import { UpdateOperationalSessionDto } from './dto/update-operational-session.dto';

const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
} as const;

const ORGANIZATION_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  isActive: true,
} as const;

const BRANCH_SUMMARY_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  code: true,
  region: true,
  isActive: true,
} as const;

const MAINHEAD_SUMMARY_SELECT = {
  id: true,
  branchId: true,
  name: true,
  code: true,
  description: true,
  isActive: true,
} as const;

const OPERATIONAL_SESSION_INCLUDE =
  Prisma.validator<Prisma.OperationalSessionInclude>()({
    workspace: {
      select: {
        id: true,
        name: true,
        code: true,
      },
    },
    organization: {
      select: ORGANIZATION_SUMMARY_SELECT,
    },
    branch: {
      select: BRANCH_SUMMARY_SELECT,
    },
    mainhead: {
      select: MAINHEAD_SUMMARY_SELECT,
    },
    assignedCompany: {
      select: ORGANIZATION_SUMMARY_SELECT,
    },
    assignedQaUser: {
      select: USER_SUMMARY_SELECT,
    },
  });

type OperationalSessionRecord = Prisma.OperationalSessionGetPayload<{
  include: typeof OPERATIONAL_SESSION_INCLUDE;
}>;

type OperationalSessionProgress = {
  totalAssets: number;
  completedAssets: number;
  completionPercentage: number;
};

type LifecycleActor = 'FIELD' | 'QA';

type TransitionOptions = {
  from: OperationalSessionStatus[];
  to: OperationalSessionStatus;
  actor: LifecycleActor;
  timestampField?: 'startedAt' | 'submittedAt' | 'approvedAt' | 'rejectedAt';
  requireRemarks?: boolean;
};

@Injectable()
export class OperationalSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser, query: ListOperationalSessionsQueryDto) {
    const sessions = await this.prisma.operationalSession.findMany({
      where: await this.buildListWhere(user, query),
      include: OPERATIONAL_SESSION_INCLUDE,
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
    });

    return sessions.map((session) => this.serializeSession(session));
  }

  async getDetail(user: RequestUser, id: string) {
    const session = await this.prisma.operationalSession.findFirst({
      where: {
        AND: [
          {
            id,
            workspaceId: user.tenantId,
          },
          await this.accessScope(user),
        ],
      },
      include: OPERATIONAL_SESSION_INCLUDE,
    });

    if (!session) {
      throw new NotFoundException('Operational session not found.');
    }

    return this.serializeSession(session);
  }

  async create(user: RequestUser, dto: CreateOperationalSessionDto) {
    this.assertAdmin(user);
    this.assertWorkspaceAccess(user, dto.workspaceId);

    const status = this.getCreateStatus(dto.status);
    const links = await this.resolveCreateLinks(dto);
    const baseData: Prisma.OperationalSessionUncheckedCreateInput = {
      id: randomUUID(),
      sessionNo: this.generateSessionNo(dto.scope),
      workspaceId: dto.workspaceId,
      organizationId: dto.organizationId,
      branchId: links.branchId,
      mainheadId: dto.mainheadId ?? null,
      assignedCompanyId: dto.assignedCompanyId,
      assignedQaUserId: dto.assignedQaUserId ?? null,
      scope: dto.scope,
      status,
      targetDate: this.parseOptionalDate(dto.targetDate, 'Target date'),
      dueDate: this.parseOptionalDate(dto.dueDate, 'Due date'),
      remarks: this.normalizeOptionalString(dto.remarks),
    };

    if (dto.metadata !== undefined) {
      baseData.metadata = this.toNullableJsonInput(dto.metadata);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const session = await this.prisma.operationalSession.create({
          data: {
            ...baseData,
            sessionNo: this.generateSessionNo(dto.scope),
          },
          include: OPERATIONAL_SESSION_INCLUDE,
        });

        return this.serializeSession(session);
      } catch (error) {
        if (this.isUniqueSessionNoConflict(error) && attempt < 2) {
          continue;
        }

        throw error;
      }
    }
  }

  async update(
    user: RequestUser,
    id: string,
    dto: UpdateOperationalSessionDto,
  ) {
    this.assertAdmin(user);

    if (dto.status !== undefined) {
      throw new BadRequestException(
        'Use operational session lifecycle endpoints to change status.',
      );
    }

    const session = await this.findSessionInWorkspace(user, id);
    const links = await this.resolveUpdateLinks(session, dto);
    const data: Prisma.OperationalSessionUncheckedUpdateInput = {};

    if (dto.branchId !== undefined || dto.mainheadId !== undefined) {
      data.branchId = links.branchId;
      data.mainheadId = links.mainheadId;
    }

    if (dto.assignedCompanyId !== undefined) {
      data.assignedCompanyId = dto.assignedCompanyId;
    }

    if (dto.assignedQaUserId !== undefined) {
      data.assignedQaUserId = dto.assignedQaUserId ?? null;
    }

    if (dto.metadata !== undefined) {
      data.metadata = this.toNullableJsonInput(dto.metadata);
    }

    if (dto.targetDate !== undefined) {
      data.targetDate = this.parseOptionalDate(dto.targetDate, 'Target date');
    }

    if (dto.dueDate !== undefined) {
      data.dueDate = this.parseOptionalDate(dto.dueDate, 'Due date');
    }

    if (dto.remarks !== undefined) {
      data.remarks = this.normalizeOptionalString(dto.remarks);
    }

    this.assertHasChanges(data);

    const updated = await this.prisma.operationalSession.update({
      where: {
        id: session.id,
      },
      data,
      include: OPERATIONAL_SESSION_INCLUDE,
    });

    return this.serializeSession(updated);
  }

  start(user: RequestUser, id: string) {
    return this.transitionStatus(user, id, {
      from: [
        OperationalSessionStatus.DRAFT,
        OperationalSessionStatus.ASSIGNED,
        OperationalSessionStatus.AMENDMENT_REQUIRED,
      ],
      to: OperationalSessionStatus.IN_PROGRESS,
      actor: 'FIELD',
      timestampField: 'startedAt',
    });
  }

  submit(user: RequestUser, id: string) {
    return this.transitionStatus(user, id, {
      from: [
        OperationalSessionStatus.IN_PROGRESS,
        OperationalSessionStatus.AMENDMENT_REQUIRED,
      ],
      to: OperationalSessionStatus.SUBMITTED,
      actor: 'FIELD',
      timestampField: 'submittedAt',
    });
  }

  sendToQa(user: RequestUser, id: string) {
    return this.transitionStatus(user, id, {
      from: [OperationalSessionStatus.SUBMITTED],
      to: OperationalSessionStatus.QA_REVIEW,
      actor: 'QA',
    });
  }

  approve(user: RequestUser, id: string) {
    return this.transitionStatus(user, id, {
      from: [OperationalSessionStatus.QA_REVIEW],
      to: OperationalSessionStatus.APPROVED,
      actor: 'QA',
      timestampField: 'approvedAt',
    });
  }

  requestAmendment(
    user: RequestUser,
    id: string,
    dto: OperationalSessionActionDto,
  ) {
    return this.transitionStatus(user, id, {
      from: [OperationalSessionStatus.QA_REVIEW],
      to: OperationalSessionStatus.AMENDMENT_REQUIRED,
      actor: 'QA',
      requireRemarks: true,
    }, dto);
  }

  reject(
    user: RequestUser,
    id: string,
    dto: OperationalSessionActionDto,
  ) {
    return this.transitionStatus(user, id, {
      from: [OperationalSessionStatus.QA_REVIEW],
      to: OperationalSessionStatus.REJECTED,
      actor: 'QA',
      timestampField: 'rejectedAt',
      requireRemarks: true,
    }, dto);
  }

  cancel(
    user: RequestUser,
    id: string,
    dto: OperationalSessionActionDto,
  ) {
    return this.transitionStatus(user, id, {
      from: [
        OperationalSessionStatus.DRAFT,
        OperationalSessionStatus.ASSIGNED,
        OperationalSessionStatus.IN_PROGRESS,
      ],
      to: OperationalSessionStatus.CANCELLED,
      actor: 'FIELD',
    }, dto);
  }

  private async transitionStatus(
    user: RequestUser,
    id: string,
    options: TransitionOptions,
    dto?: OperationalSessionActionDto,
  ) {
    const session = await this.findSessionInWorkspace(user, id);

    await this.assertCanActOnSession(user, session, options.actor);

    if (!options.from.includes(session.status)) {
      throw new BadRequestException(
        `Operational session cannot move from ${this.formatEnumLabel(
          session.status,
        )} to ${this.formatEnumLabel(options.to)}.`,
      );
    }

    const remarks = this.getActionRemarks(dto, options.requireRemarks ?? false);
    const data: Prisma.OperationalSessionUncheckedUpdateInput = {
      status: options.to,
    };

    if (options.timestampField) {
      data[options.timestampField] = new Date();
    }

    if (remarks !== undefined) {
      data.remarks = remarks;
    }

    // TODO: Persist operational session lifecycle events when ASCURE has a shared audit trail for session-level governance.
    const updated = await this.prisma.operationalSession.update({
      where: {
        id: session.id,
      },
      data,
      include: OPERATIONAL_SESSION_INCLUDE,
    });

    return this.serializeSession(updated);
  }

  private async buildListWhere(
    user: RequestUser,
    query: ListOperationalSessionsQueryDto,
  ): Promise<Prisma.OperationalSessionWhereInput> {
    const filters: Prisma.OperationalSessionWhereInput[] = [
      {
        workspaceId: user.tenantId,
      },
      await this.accessScope(user),
      query.workspaceId ? { workspaceId: query.workspaceId } : {},
      query.scope ? { scope: query.scope } : {},
      query.status ? { status: query.status } : {},
      query.assignedCompanyId
        ? { assignedCompanyId: query.assignedCompanyId }
        : {},
      query.assignedQaUserId ? { assignedQaUserId: query.assignedQaUserId } : {},
      query.mainheadId ? { mainheadId: query.mainheadId } : {},
    ].filter((filter) => Object.keys(filter).length > 0);

    return {
      AND: filters,
    };
  }

  private async accessScope(
    user: RequestUser,
  ): Promise<Prisma.OperationalSessionWhereInput> {
    if (user.role === UserRole.ADMIN) {
      return {};
    }

    const organizationIds = await this.getUserOrganizationIds(user);
    const accessFilters: Prisma.OperationalSessionWhereInput[] = [
      {
        assignedQaUserId: user.id,
      },
    ];

    if (organizationIds.length > 0) {
      accessFilters.push({
        assignedCompanyId: {
          in: organizationIds,
        },
      });
    }

    return {
      OR: accessFilters,
    };
  }

  private async findSessionInWorkspace(user: RequestUser, id: string) {
    const session = await this.prisma.operationalSession.findFirst({
      where: {
        id,
        workspaceId: user.tenantId,
      },
      include: OPERATIONAL_SESSION_INCLUDE,
    });

    if (!session) {
      throw new NotFoundException('Operational session not found.');
    }

    return session;
  }

  private async resolveCreateLinks(dto: CreateOperationalSessionDto) {
    const [workspace, organization, branch, mainhead, assignedCompany] =
      await Promise.all([
        this.prisma.tenant.findUnique({
          where: {
            id: dto.workspaceId,
          },
          select: {
            id: true,
          },
        }),
        this.prisma.organization.findUnique({
          where: {
            id: dto.organizationId,
          },
          select: ORGANIZATION_SUMMARY_SELECT,
        }),
        dto.branchId
          ? this.prisma.branch.findUnique({
              where: {
                id: dto.branchId,
              },
              select: BRANCH_SUMMARY_SELECT,
            })
          : null,
        dto.mainheadId
          ? this.prisma.mainhead.findUnique({
              where: {
                id: dto.mainheadId,
              },
              select: {
                ...MAINHEAD_SUMMARY_SELECT,
                branch: {
                  select: {
                    organizationId: true,
                  },
                },
              },
            })
          : null,
        this.prisma.organization.findUnique({
          where: {
            id: dto.assignedCompanyId,
          },
          select: ORGANIZATION_SUMMARY_SELECT,
        }),
      ]);

    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }

    if (!organization) {
      throw new NotFoundException('Organization not found.');
    }

    if (dto.branchId && !branch) {
      throw new NotFoundException('Branch not found.');
    }

    if (dto.mainheadId && !mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }

    if (!assignedCompany) {
      throw new NotFoundException('Assigned company not found.');
    }

    this.assertEnterpriseLinks({
      organizationId: dto.organizationId,
      branch,
      mainhead,
    });

    await this.assertAssignableQaUser(dto.workspaceId, dto.assignedQaUserId);

    return {
      branchId: branch?.id ?? mainhead?.branchId ?? null,
    };
  }

  private async resolveUpdateLinks(
    session: OperationalSessionRecord,
    dto: UpdateOperationalSessionDto,
  ) {
    const nextAssignedCompanyId =
      dto.assignedCompanyId ?? session.assignedCompanyId;
    const nextMainheadId =
      dto.mainheadId === undefined ? session.mainheadId : dto.mainheadId ?? null;
    const requestedBranchId =
      dto.branchId === undefined ? session.branchId : dto.branchId ?? null;

    const [assignedCompany, branch, mainhead] = await Promise.all([
      this.prisma.organization.findUnique({
        where: {
          id: nextAssignedCompanyId,
        },
        select: {
          id: true,
        },
      }),
      requestedBranchId
        ? this.prisma.branch.findUnique({
            where: {
              id: requestedBranchId,
            },
            select: BRANCH_SUMMARY_SELECT,
          })
        : null,
      nextMainheadId
        ? this.prisma.mainhead.findUnique({
            where: {
              id: nextMainheadId,
            },
            select: {
              ...MAINHEAD_SUMMARY_SELECT,
              branch: {
                select: {
                  organizationId: true,
                },
              },
            },
          })
        : null,
    ]);

    if (!assignedCompany) {
      throw new NotFoundException('Assigned company not found.');
    }

    if (requestedBranchId && !branch) {
      throw new NotFoundException('Branch not found.');
    }

    if (nextMainheadId && !mainhead) {
      throw new NotFoundException('MAINHEAD not found.');
    }

    this.assertEnterpriseLinks({
      organizationId: session.organizationId,
      branch,
      mainhead,
    });

    await this.assertAssignableQaUser(
      session.workspaceId,
      dto.assignedQaUserId,
    );

    const branchId = branch?.id ?? mainhead?.branchId ?? null;

    if (branchId && mainhead && branchId !== mainhead.branchId) {
      throw new BadRequestException(
        'MAINHEAD does not belong to the selected branch.',
      );
    }

    return {
      branchId,
      mainheadId: nextMainheadId,
    };
  }

  private assertEnterpriseLinks(input: {
    organizationId: string;
    branch:
      | {
          id: string;
          organizationId: string;
        }
      | null;
    mainhead:
      | {
          id: string;
          branchId: string;
          branch: {
            organizationId: string;
          };
        }
      | null;
  }) {
    if (input.branch && input.branch.organizationId !== input.organizationId) {
      throw new BadRequestException(
        'Branch does not belong to the selected organization.',
      );
    }

    if (
      input.mainhead &&
      input.mainhead.branch.organizationId !== input.organizationId
    ) {
      throw new BadRequestException(
        'MAINHEAD does not belong to the selected organization.',
      );
    }

    if (
      input.branch &&
      input.mainhead &&
      input.mainhead.branchId !== input.branch.id
    ) {
      throw new BadRequestException(
        'MAINHEAD does not belong to the selected branch.',
      );
    }
  }

  private async assertAssignableQaUser(
    workspaceId: string,
    assignedQaUserId?: string | null,
  ) {
    if (!assignedQaUserId) {
      return;
    }

    const assignedQaUser = await this.prisma.user.findFirst({
      where: {
        id: assignedQaUserId,
        tenantId: workspaceId,
        isActive: true,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (!assignedQaUser) {
      throw new NotFoundException('Assigned QA user not found.');
    }

    if (this.isReadOnlyRole(assignedQaUser.role)) {
      throw new BadRequestException(
        'Assigned QA user must have an operational role.',
      );
    }
  }

  private async assertCanActOnSession(
    user: RequestUser,
    session: OperationalSessionRecord,
    actor: LifecycleActor,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (this.isReadOnlyRole(user.role)) {
      throw new ForbiddenException(
        'This role is read-only for operational session actions.',
      );
    }

    if (actor === 'QA') {
      if (session.assignedQaUserId === user.id) {
        return;
      }

      throw new ForbiddenException(
        'Only the assigned QA user can perform this session action.',
      );
    }

    const organizationIds = await this.getUserOrganizationIds(user);

    if (organizationIds.includes(session.assignedCompanyId)) {
      return;
    }

    throw new ForbiddenException(
      'Only users in the assigned company can perform this session action.',
    );
  }

  private async getUserOrganizationIds(user: RequestUser) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        organizationId: true,
        organizationMemberships: {
          where: {
            isActive: true,
          },
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!currentUser) {
      return [];
    }

    return Array.from(
      new Set(
        [
          currentUser.organizationId,
          ...currentUser.organizationMemberships.map(
            (membership) => membership.organizationId,
          ),
        ].filter((organizationId): organizationId is string =>
          Boolean(organizationId),
        ),
      ),
    );
  }

  private getCreateStatus(status?: OperationalSessionStatus) {
    if (!status) {
      return OperationalSessionStatus.ASSIGNED;
    }

    if (
      status !== OperationalSessionStatus.DRAFT &&
      status !== OperationalSessionStatus.ASSIGNED
    ) {
      throw new BadRequestException(
        'Operational sessions can only be created as Draft or Assigned.',
      );
    }

    return status;
  }

  private getActionRemarks(
    dto: OperationalSessionActionDto | undefined,
    required: boolean,
  ) {
    const remarks =
      this.normalizeOptionalString(dto?.remarks) ??
      this.normalizeOptionalString(dto?.comment);

    if (required && !remarks) {
      throw new BadRequestException('Remarks or comment is required.');
    }

    return remarks === null ? undefined : remarks;
  }

  private serializeSession(session: OperationalSessionRecord) {
    return {
      ...session,
      progress: this.emptyProgress(),
    };
  }

  private emptyProgress(): OperationalSessionProgress {
    return {
      totalAssets: 0,
      completedAssets: 0,
      completionPercentage: 0,
    };
  }

  private generateSessionNo(scope: OperationalSessionScope) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = randomUUID().slice(0, 8).toUpperCase();

    return `OPS-${scope}-${datePart}-${randomPart}`;
  }

  private parseOptionalDate(
    value: string | null | undefined,
    label: string,
  ) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} must be a valid date.`);
    }

    return date;
  }

  private toNullableJsonInput(value: Record<string, unknown> | null) {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }

  private assertHasChanges(data: object) {
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'At least one editable field must be provided.',
      );
    }
  }

  private assertAdmin(user: RequestUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'Only administrators can manage operational sessions.',
      );
    }
  }

  private assertWorkspaceAccess(user: RequestUser, workspaceId: string) {
    if (workspaceId !== user.tenantId) {
      throw new ForbiddenException(
        'Operational sessions cannot be managed outside your workspace.',
      );
    }
  }

  private isReadOnlyRole(role: UserRole) {
    return role === UserRole.VIEWER || role === UserRole.CLIENT;
  }

  private isUniqueSessionNoConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private formatEnumLabel(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}
