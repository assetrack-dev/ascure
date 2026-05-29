import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InspectionCompletionStatus,
  OperationalSessionScope,
  OperationalSessionStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AssignOperationalSessionAssetDto } from './dto/assign-operational-session-asset.dto';
import { BulkAssignOperationalSessionAssetsDto } from './dto/bulk-assign-operational-session-assets.dto';
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

const ASSET_SUMMARY_SELECT = Prisma.validator<Prisma.AssetSelect>()({
  id: true,
  assetCode: true,
  name: true,
  latitude: true,
  longitude: true,
  status: true,
  assetType: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
});

const OPERATIONAL_SESSION_ASSET_INCLUDE =
  Prisma.validator<Prisma.OperationalSessionAssetInclude>()({
    asset: {
      select: ASSET_SUMMARY_SELECT,
    },
    assignedBy: {
      select: USER_SUMMARY_SELECT,
    },
    removedBy: {
      select: USER_SUMMARY_SELECT,
    },
  });

// InspectionCompletionStatus currently has DRAFT and SUBMITTED; submittedAt is
// accepted too for compatibility with any historical rows already marked final.
const SESSION_COMPLETED_INSPECTION_STATUSES = [
  InspectionCompletionStatus.SUBMITTED,
] as const;
const SESSION_COMPLETED_INSPECTION_STATUS_SET =
  new Set<InspectionCompletionStatus>(SESSION_COMPLETED_INSPECTION_STATUSES);

type OperationalSessionRecord = Prisma.OperationalSessionGetPayload<{
  include: typeof OPERATIONAL_SESSION_INCLUDE;
}>;

type OperationalSessionAssetRecord =
  Prisma.OperationalSessionAssetGetPayload<{
    include: typeof OPERATIONAL_SESSION_ASSET_INCLUDE;
  }>;

type OperationalSessionProgress = {
  totalAssets: number;
  inspectedAssets: number;
  completedAssets: number;
  completionPercentage: number;
};

type SessionAssetInspectionContext = {
  latestInspectionId: string | null;
  latestInspectionStatus: InspectionCompletionStatus | null;
  inspected: boolean;
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

    const progressBySessionId = await this.getProgressBySessionIds(
      sessions.map((session) => session.id),
    );

    return sessions.map((session) =>
      this.serializeSession(session, progressBySessionId.get(session.id)),
    );
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

    const [progressBySessionId, recentAssets] = await Promise.all([
      this.getProgressBySessionIds([session.id]),
      this.findActiveSessionAssets(session.id, 10),
    ]);
    const inspectionContextByAssetId = await this.getInspectionContextByAssetId(
      session.id,
      recentAssets.map((assignment) => assignment.assetId),
    );

    return this.serializeSession(
      session,
      progressBySessionId.get(session.id),
      recentAssets,
      inspectionContextByAssetId,
    );
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

    const progress = await this.getProgress(updated.id);

    return this.serializeSession(updated, progress);
  }

  async listAssets(user: RequestUser, id: string) {
    const session = await this.findReadableSession(user, id);
    const assignments = await this.findActiveSessionAssets(session.id);
    const inspectionContextByAssetId = await this.getInspectionContextByAssetId(
      session.id,
      assignments.map((assignment) => assignment.assetId),
    );

    return assignments.map((assignment) =>
      this.serializeSessionAsset(
        assignment,
        inspectionContextByAssetId.get(assignment.assetId),
      ),
    );
  }

  async assignAsset(
    user: RequestUser,
    id: string,
    dto: AssignOperationalSessionAssetDto,
  ) {
    const session = await this.findSessionInWorkspace(user, id);
    await this.assertCanManageSessionAssets(user, session);

    const asset = await this.findWorkspaceAsset(user, dto.assetId);
    const existing = await this.prisma.operationalSessionAsset.findUnique({
      where: {
        operationalSessionId_assetId: {
          operationalSessionId: session.id,
          assetId: asset.id,
        },
      },
    });

    if (existing && !existing.removedAt) {
      throw new BadRequestException(
        'Asset is already assigned to this operational session.',
      );
    }

    const notes = this.normalizeOptionalString(dto.notes);
    const assignedAt = new Date();

    try {
      const assignment = existing
        ? await this.prisma.operationalSessionAsset.update({
            where: {
              id: existing.id,
            },
            data: {
              assignedAt,
              assignedByUserId: user.id,
              removedAt: null,
              removedByUserId: null,
              notes,
            },
            include: OPERATIONAL_SESSION_ASSET_INCLUDE,
          })
        : await this.prisma.operationalSessionAsset.create({
            data: {
              id: randomUUID(),
              operationalSessionId: session.id,
              assetId: asset.id,
              assignedAt,
              assignedByUserId: user.id,
              notes,
            },
            include: OPERATIONAL_SESSION_ASSET_INCLUDE,
          });

      return this.serializeSessionAsset(assignment);
    } catch (error) {
      if (this.isUniqueConstraintConflict(error)) {
        throw new BadRequestException(
          'Asset is already assigned to this operational session.',
        );
      }

      throw error;
    }
  }

  async bulkAssignAssets(
    user: RequestUser,
    id: string,
    dto: BulkAssignOperationalSessionAssetsDto,
  ) {
    const session = await this.findSessionInWorkspace(user, id);
    await this.assertCanManageSessionAssets(user, session);

    const requestedAssetIds = dto.assetIds;
    const uniqueAssetIds = Array.from(new Set(requestedAssetIds));
    const duplicateAssetIds = requestedAssetIds.filter(
      (assetId, index) => requestedAssetIds.indexOf(assetId) !== index,
    );
    const [assets, existingAssignments] = await Promise.all([
      this.prisma.asset.findMany({
        where: {
          id: {
            in: uniqueAssetIds,
          },
          tenantId: user.tenantId,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.operationalSessionAsset.findMany({
        where: {
          operationalSessionId: session.id,
          assetId: {
            in: uniqueAssetIds,
          },
        },
      }),
    ]);
    const assetIds = new Set(assets.map((asset) => asset.id));
    const existingByAssetId = new Map(
      existingAssignments.map((assignment) => [assignment.assetId, assignment]),
    );
    const assigned: Array<{ assetId: string; assignmentId: string }> = [];
    const restored: Array<{ assetId: string; assignmentId: string }> = [];
    const skipped: Array<{ assetId: string; reason: string }> =
      duplicateAssetIds.map((assetId) => ({
        assetId,
        reason: 'Duplicate asset ID in request.',
      }));
    const failed: Array<{ assetId: string; reason: string }> = [];

    for (const assetId of uniqueAssetIds) {
      if (!assetIds.has(assetId)) {
        failed.push({
          assetId,
          reason: 'Asset not found in this workspace.',
        });
        continue;
      }

      const existing = existingByAssetId.get(assetId);

      if (existing && !existing.removedAt) {
        skipped.push({
          assetId,
          reason: 'Asset is already assigned to this operational session.',
        });
        continue;
      }

      try {
        if (existing) {
          const assignment = await this.prisma.operationalSessionAsset.update({
            where: {
              id: existing.id,
            },
            data: {
              assignedAt: new Date(),
              assignedByUserId: user.id,
              removedAt: null,
              removedByUserId: null,
            },
            select: {
              id: true,
              assetId: true,
            },
          });

          restored.push({
            assetId: assignment.assetId,
            assignmentId: assignment.id,
          });
          continue;
        }

        const assignment = await this.prisma.operationalSessionAsset.create({
          data: {
            id: randomUUID(),
            operationalSessionId: session.id,
            assetId,
            assignedByUserId: user.id,
          },
          select: {
            id: true,
            assetId: true,
          },
        });

        assigned.push({
          assetId: assignment.assetId,
          assignmentId: assignment.id,
        });
      } catch (error) {
        if (this.isUniqueConstraintConflict(error)) {
          skipped.push({
            assetId,
            reason: 'Asset is already assigned to this operational session.',
          });
          continue;
        }

        failed.push({
          assetId,
          reason: 'Unable to assign asset.',
        });
      }
    }

    return {
      assigned,
      skipped,
      restored,
      failed,
      summary: {
        assigned: assigned.length,
        skipped: skipped.length,
        restored: restored.length,
        failed: failed.length,
      },
    };
  }

  async removeAsset(user: RequestUser, id: string, assetId: string) {
    const session = await this.findSessionInWorkspace(user, id);
    await this.assertCanManageSessionAssets(user, session);

    const assignment = await this.prisma.operationalSessionAsset.findUnique({
      where: {
        operationalSessionId_assetId: {
          operationalSessionId: session.id,
          assetId,
        },
      },
    });

    if (!assignment || assignment.removedAt) {
      throw new NotFoundException(
        'Active asset assignment was not found for this operational session.',
      );
    }

    const removed = await this.prisma.operationalSessionAsset.update({
      where: {
        id: assignment.id,
      },
      data: {
        removedAt: new Date(),
        removedByUserId: user.id,
      },
      include: OPERATIONAL_SESSION_ASSET_INCLUDE,
    });

    return this.serializeSessionAsset(removed);
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

    const progress = await this.getProgress(updated.id);

    return this.serializeSession(updated, progress);
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

  private async findReadableSession(user: RequestUser, id: string) {
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

    return session;
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

  private async findWorkspaceAsset(user: RequestUser, assetId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return asset;
  }

  private async findActiveSessionAssets(
    operationalSessionId: string,
    take?: number,
  ) {
    return this.prisma.operationalSessionAsset.findMany({
      where: {
        operationalSessionId,
        removedAt: null,
      },
      include: OPERATIONAL_SESSION_ASSET_INCLUDE,
      orderBy: [
        {
          assignedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      ...(take ? { take } : {}),
    });
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

  private async assertCanManageSessionAssets(
    user: RequestUser,
    session: OperationalSessionRecord,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (this.isReadOnlyRole(user.role)) {
      throw new ForbiddenException(
        'This role is read-only for operational session asset assignments.',
      );
    }

    if (session.assignedQaUserId === user.id) {
      return;
    }

    const organizationIds = await this.getUserOrganizationIds(user);

    if (organizationIds.includes(session.assignedCompanyId)) {
      return;
    }

    throw new ForbiddenException(
      'Only authorized session users can manage assigned assets.',
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

  private serializeSession(
    session: OperationalSessionRecord,
    progress = this.emptyProgress(),
    recentAssets: OperationalSessionAssetRecord[] = [],
    inspectionContextByAssetId = new Map<string, SessionAssetInspectionContext>(),
  ) {
    return {
      ...session,
      progress,
      assignedAssets: {
        count: progress.totalAssets,
        activeCount: progress.totalAssets,
        recent: recentAssets.map((assignment) =>
          this.serializeSessionAsset(
            assignment,
            inspectionContextByAssetId.get(assignment.assetId),
          ),
        ),
      },
    };
  }

  private async getProgress(sessionId: string) {
    const progressBySessionId = await this.getProgressBySessionIds([sessionId]);

    return progressBySessionId.get(sessionId) ?? this.emptyProgress();
  }

  private async getProgressBySessionIds(sessionIds: string[]) {
    const progressBySessionId = new Map<string, OperationalSessionProgress>();

    for (const sessionId of sessionIds) {
      progressBySessionId.set(sessionId, this.emptyProgress());
    }

    if (sessionIds.length === 0) {
      return progressBySessionId;
    }

    const activeAssignments = await this.prisma.operationalSessionAsset.findMany({
      where: {
        operationalSessionId: {
          in: sessionIds,
        },
        removedAt: null,
      },
      select: {
        operationalSessionId: true,
        assetId: true,
      },
    });
    const assignedAssetIdsBySessionId = new Map<string, Set<string>>();

    for (const assignment of activeAssignments) {
      const assetIds =
        assignedAssetIdsBySessionId.get(assignment.operationalSessionId) ??
        new Set<string>();

      assetIds.add(assignment.assetId);
      assignedAssetIdsBySessionId.set(
        assignment.operationalSessionId,
        assetIds,
      );
    }

    const linkedInspections = await this.prisma.inspection.findMany({
      where: {
        operationalSessionId: {
          in: sessionIds,
        },
        OR: [
          {
            completionStatus: {
              in: [...SESSION_COMPLETED_INSPECTION_STATUSES],
            },
          },
          {
            submittedAt: {
              not: null,
            },
          },
        ],
      },
      select: {
        operationalSessionId: true,
        assetId: true,
      },
    });
    const inspectedAssetIdsBySessionId = new Map<string, Set<string>>();

    for (const inspection of linkedInspections) {
      if (!inspection.operationalSessionId) {
        continue;
      }

      const assignedAssetIds = assignedAssetIdsBySessionId.get(
        inspection.operationalSessionId,
      );

      if (!assignedAssetIds?.has(inspection.assetId)) {
        continue;
      }

      const inspectedAssetIds =
        inspectedAssetIdsBySessionId.get(inspection.operationalSessionId) ??
        new Set<string>();

      inspectedAssetIds.add(inspection.assetId);
      inspectedAssetIdsBySessionId.set(
        inspection.operationalSessionId,
        inspectedAssetIds,
      );
    }

    for (const sessionId of sessionIds) {
      const totalAssets = assignedAssetIdsBySessionId.get(sessionId)?.size ?? 0;
      const inspectedAssets =
        inspectedAssetIdsBySessionId.get(sessionId)?.size ?? 0;

      progressBySessionId.set(sessionId, {
        totalAssets,
        inspectedAssets,
        completedAssets: inspectedAssets,
        completionPercentage:
          totalAssets === 0
            ? 0
            : Math.round((inspectedAssets / totalAssets) * 100),
      });
    }

    return progressBySessionId;
  }

  private async getInspectionContextByAssetId(
    operationalSessionId: string,
    assetIds: string[],
  ) {
    const contextByAssetId = new Map<string, SessionAssetInspectionContext>();
    const uniqueAssetIds = Array.from(new Set(assetIds));

    for (const assetId of uniqueAssetIds) {
      contextByAssetId.set(assetId, {
        latestInspectionId: null,
        latestInspectionStatus: null,
        inspected: false,
      });
    }

    if (uniqueAssetIds.length === 0) {
      return contextByAssetId;
    }

    const inspections = await this.prisma.inspection.findMany({
      where: {
        operationalSessionId,
        assetId: {
          in: uniqueAssetIds,
        },
      },
      select: {
        id: true,
        assetId: true,
        completionStatus: true,
        submittedAt: true,
        createdAt: true,
      },
      orderBy: [
        {
          createdAt: 'desc',
        },
      ],
    });

    for (const inspection of inspections) {
      const context = contextByAssetId.get(inspection.assetId);

      if (!context) {
        continue;
      }

      if (!context.latestInspectionId) {
        context.latestInspectionId = inspection.id;
        context.latestInspectionStatus = inspection.completionStatus;
      }

      if (this.isCompletedSessionInspection(inspection)) {
        context.inspected = true;
      }
    }

    return contextByAssetId;
  }

  private isCompletedSessionInspection(inspection: {
    completionStatus: InspectionCompletionStatus;
    submittedAt: Date | null;
  }) {
    return (
      SESSION_COMPLETED_INSPECTION_STATUS_SET.has(inspection.completionStatus) ||
      Boolean(inspection.submittedAt)
    );
  }

  private serializeSessionAsset(
    assignment: OperationalSessionAssetRecord,
    inspectionContext?: SessionAssetInspectionContext,
  ) {
    return {
      id: assignment.asset.id,
      assetCode: assignment.asset.assetCode,
      name: assignment.asset.name,
      assetType: assignment.asset.assetType,
      latitude: assignment.asset.latitude,
      longitude: assignment.asset.longitude,
      status: assignment.asset.status,
      latestInspectionId: inspectionContext?.latestInspectionId ?? null,
      latestInspectionStatus: inspectionContext?.latestInspectionStatus ?? null,
      inspected: inspectionContext?.inspected ?? false,
      assignment: {
        id: assignment.id,
        operationalSessionId: assignment.operationalSessionId,
        assetId: assignment.assetId,
        assignedAt: assignment.assignedAt,
        assignedByUserId: assignment.assignedByUserId,
        assignedBy: assignment.assignedBy,
        removedAt: assignment.removedAt,
        removedByUserId: assignment.removedByUserId,
        removedBy: assignment.removedBy,
        notes: assignment.notes,
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt,
      },
    };
  }

  private emptyProgress(): OperationalSessionProgress {
    return {
      totalAssets: 0,
      inspectedAssets: 0,
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
    return this.isUniqueConstraintConflict(error);
  }

  private isUniqueConstraintConflict(error: unknown) {
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
