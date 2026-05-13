import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DefectSeverity,
  DefectStatus,
  DefectTimelineEventType,
  UserRole,
} from '@prisma/client';
import { buildInspectionImagePath } from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDefectCommentDto } from './dto/create-defect-comment.dto';
import { UpdateDefectAssignmentDto } from './dto/update-defect-assignment.dto';
import { UpdateDefectDueDateDto } from './dto/update-defect-due-date.dto';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';

const ACTIVE_SLA_STATUSES = new Set<DefectStatus>([
  DefectStatus.OPEN,
  DefectStatus.IN_PROGRESS,
  DefectStatus.MONITORING,
]);

type DefectSlaState = 'OVERDUE' | 'ON_TRACK' | 'NO_DUE_DATE' | 'STOPPED';

@Injectable()
export class DefectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    await this.ensureDefectsForAccessibleItems(user);

    const defects = await this.prisma.defect.findMany({
      where: {
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        assignedTeam: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        inspectionItemResult: {
          select: {
            id: true,
            inspectionId: true,
            label: true,
            remark: true,
            createdAt: true,
            inspection: {
              select: {
                id: true,
                assetId: true,
                inspectionCycle: true,
                submittedAt: true,
                asset: {
                  select: {
                    id: true,
                    assetCode: true,
                    substation: {
                      select: {
                        code: true,
                        name: true,
                        location: true,
                      },
                    },
                    assetType: {
                      select: {
                        code: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return defects
      .sort((left, right) => {
        const leftSubmittedAt =
          left.inspectionItemResult.inspection.submittedAt?.getTime() ?? 0;
        const rightSubmittedAt =
          right.inspectionItemResult.inspection.submittedAt?.getTime() ?? 0;

        if (leftSubmittedAt !== rightSubmittedAt) {
          return rightSubmittedAt - leftSubmittedAt;
        }

        return (
          right.inspectionItemResult.createdAt.getTime() -
          left.inspectionItemResult.createdAt.getTime()
        );
      })
      .map((defect) => this.serializeDefectListItem(defect));
  }

  async getDetail(user: RequestUser, defectId: string) {
    const defect = await this.findOrCreateAccessibleDefect(user, defectId);

    return this.serializeDefectDetail(defect);
  }

  async updateStatus(user: RequestUser, defectId: string, dto: UpdateDefectStatusDto) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const actionRemark =
      dto.actionRemark === undefined
        ? undefined
        : this.normalizeOptionalString(dto.actionRemark);
    const now = new Date();
    const data: {
      status: DefectStatus;
      closedAt: Date | null;
      resolvedAt: Date | null;
      actionRemark?: string | null;
    } = {
      status: dto.status,
      closedAt:
        dto.status === DefectStatus.CLOSED
          ? defect.closedAt ?? now
          : null,
      resolvedAt:
        dto.status === DefectStatus.RESOLVED || dto.status === DefectStatus.CLOSED
          ? defect.resolvedAt ?? now
          : null,
    };

    if (actionRemark !== undefined) {
      data.actionRemark = actionRemark;
    }

    const shouldCreateTimelineEntry =
      defect.status !== dto.status || Boolean(actionRemark);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data,
      });

      if (!shouldCreateTimelineEntry) {
        return;
      }

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type:
            defect.status === dto.status
              ? DefectTimelineEventType.COMMENT
              : DefectTimelineEventType.STATUS_CHANGED,
          fromStatus: defect.status === dto.status ? null : defect.status,
          toStatus: defect.status === dto.status ? null : dto.status,
          comment: actionRemark ?? null,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async updateAssignment(
    user: RequestUser,
    defectId: string,
    dto: UpdateDefectAssignmentDto,
  ) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const hasAssignedUserId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedUserId',
    );
    const hasAssignedTeamId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedTeamId',
    );

    if (!hasAssignedUserId && !hasAssignedTeamId) {
      throw new BadRequestException(
        'At least one assignment field must be provided.',
      );
    }

    const nextAssignedUserId = hasAssignedUserId
      ? dto.assignedUserId ?? null
      : defect.assignedUserId;
    const nextAssignedTeamId = hasAssignedTeamId
      ? dto.assignedTeamId ?? null
      : defect.assignedTeamId;

    const [updatedAssignedUser, updatedAssignedTeam] = await Promise.all([
      hasAssignedUserId && nextAssignedUserId
        ? this.findAssignableUser(user.tenantId, nextAssignedUserId)
        : Promise.resolve(null),
      hasAssignedTeamId && nextAssignedTeamId
        ? this.findAssignableTeam(user.tenantId, nextAssignedTeamId)
        : Promise.resolve(null),
    ]);
    const nextAssignedUser = hasAssignedUserId
      ? updatedAssignedUser
      : defect.assignedUser;
    const nextAssignedTeam = hasAssignedTeamId
      ? updatedAssignedTeam
      : defect.assignedTeam;

    const userChanged = defect.assignedUserId !== nextAssignedUserId;
    const teamChanged = defect.assignedTeamId !== nextAssignedTeamId;

    if (!userChanged && !teamChanged) {
      return this.getDetail(user, defect.id);
    }

    const now = new Date();
    const previousAssignee = this.formatAssignmentLabel(
      defect.assignedUser,
      defect.assignedTeam,
    );
    const nextAssignee = this.formatAssignmentLabel(
      nextAssignedUserId ? nextAssignedUser : null,
      nextAssignedTeamId ? nextAssignedTeam : null,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          ...(hasAssignedUserId ? { assignedUserId: nextAssignedUserId } : {}),
          ...(hasAssignedTeamId ? { assignedTeamId: nextAssignedTeamId } : {}),
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
          comment: `Assignment changed from ${previousAssignee} to ${nextAssignee}.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async updateDueDate(
    user: RequestUser,
    defectId: string,
    dto: UpdateDefectDueDateDto,
  ) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const hasDueDate = Object.prototype.hasOwnProperty.call(dto, 'dueDate');

    if (!hasDueDate) {
      throw new BadRequestException('A due date field must be provided.');
    }

    const nextDueDate = this.parseDueDate(dto.dueDate);
    const previousDueDateTime = defect.dueDate?.getTime() ?? null;
    const nextDueDateTime = nextDueDate?.getTime() ?? null;

    if (previousDueDateTime === nextDueDateTime) {
      return this.getDetail(user, defect.id);
    }

    const now = new Date();
    const previousDueDate = this.formatDueDate(defect.dueDate);
    const nextDueDateLabel = this.formatDueDate(nextDueDate);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          dueDate: nextDueDate,
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.DUE_DATE_CHANGED,
          comment: `Due date changed from ${previousDueDate} to ${nextDueDateLabel}.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async addComment(user: RequestUser, defectId: string, dto: CreateDefectCommentDto) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const comment = this.normalizeOptionalString(dto.comment);

    if (!comment) {
      throw new BadRequestException('Comment is required.');
    }

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.COMMENT,
          comment,
          createdByUserId: user.id,
          createdAt: now,
        },
      }),
      this.prisma.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          updatedAt: now,
        },
      }),
    ]);

    return this.getDetail(user, defect.id);
  }

  private async ensureDefectsForAccessibleItems(user: RequestUser) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user),
        },
      },
      select: {
        id: true,
        severity: true,
      },
    });

    if (itemResults.length === 0) {
      return;
    }

    const now = new Date();

    await this.prisma.defect.createMany({
      data: itemResults.map((item) => ({
        id: randomUUID(),
        inspectionItemResultId: item.id,
        status: DefectStatus.OPEN,
        severity: item.severity ?? DefectSeverity.MEDIUM,
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  private async findOrCreateAccessibleDefect(user: RequestUser, defectId: string) {
    const existingDefect = await this.findAccessibleDefectById(user, defectId);

    if (existingDefect) {
      return existingDefect;
    }

    const itemResult = await this.prisma.inspectionItemResult.findFirst({
      where: {
        id: defectId,
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user),
        },
      },
      select: {
        id: true,
        severity: true,
      },
    });

    if (!itemResult) {
      throw new NotFoundException('Defect not found.');
    }

    await this.prisma.defect.upsert({
      where: {
        inspectionItemResultId: itemResult.id,
      },
      create: {
        id: randomUUID(),
        inspectionItemResultId: itemResult.id,
        status: DefectStatus.OPEN,
        severity: itemResult.severity ?? DefectSeverity.MEDIUM,
      },
      update: {},
    });

    const defect = await this.findAccessibleDefectByItemResultId(user, itemResult.id);

    if (!defect) {
      throw new NotFoundException('Defect not found.');
    }

    return defect;
  }

  private findAccessibleDefectById(user: RequestUser, defectId: string) {
    return this.prisma.defect.findFirst({
      where: {
        id: defectId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      include: this.defectDetailInclude(),
    });
  }

  private findAccessibleDefectByItemResultId(user: RequestUser, inspectionItemResultId: string) {
    return this.prisma.defect.findFirst({
      where: {
        inspectionItemResultId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user),
          },
        },
      },
      include: this.defectDetailInclude(),
    });
  }

  private defectDetailInclude() {
    return {
      assignedUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      assignedTeam: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      timelineEntries: {
        orderBy: {
          createdAt: 'asc' as const,
        },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          comment: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
      },
      inspectionItemResult: {
        include: {
          inspection: {
            select: {
              id: true,
              assetId: true,
              templateId: true,
              inspectionCycle: true,
              completionStatus: true,
              submittedAt: true,
              createdAt: true,
              updatedAt: true,
              template: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  name: true,
                  role: true,
                },
              },
              siteVisit: {
                select: {
                  id: true,
                  status: true,
                  startedAt: true,
                  endedAt: true,
                  team: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                    },
                  },
                  substation: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                      location: true,
                    },
                  },
                },
              },
              asset: {
                select: {
                  id: true,
                  assetCode: true,
                  name: true,
                  latitude: true,
                  longitude: true,
                  substation: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                      location: true,
                    },
                  },
                  assetType: {
                    select: {
                      id: true,
                      code: true,
                      name: true,
                    },
                  },
                },
              },
              inspectionImages: {
                orderBy: {
                  createdAt: 'asc' as const,
                },
                select: {
                  id: true,
                  inspectionId: true,
                  url: true,
                  filename: true,
                  mimeType: true,
                  sizeBytes: true,
                  latitude: true,
                  longitude: true,
                  timestamp: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      },
    };
  }

  private serializeDefectListItem(defect: {
    id: string;
    assignedUserId: string | null;
    assignedTeamId: string | null;
    status: DefectStatus;
    severity: DefectSeverity;
    actionRemark: string | null;
    dueDate: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    assignedUser: {
      id: string;
      email: string;
      name: string;
      role: string;
    } | null;
    assignedTeam: {
      id: string;
      code: string;
      name: string;
    } | null;
    inspectionItemResult: {
      id: string;
      inspectionId: string;
      label: string;
      remark: string | null;
      createdAt: Date;
      inspection: {
        assetId: string;
        inspectionCycle: number;
        submittedAt: Date | null;
        asset: {
          assetCode: string;
          substation: {
            code: string;
            name: string;
            location: string | null;
          };
          assetType: {
            code: string;
            name: string;
          };
        };
      };
    };
  }) {
    const item = defect.inspectionItemResult;
    const inspection = item.inspection;
    const slaState = this.calculateSlaState(defect.status, defect.dueDate);

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      assignedUserId: defect.assignedUserId,
      assignedTeamId: defect.assignedTeamId,
      assignedUser: defect.assignedUser,
      assignedTeam: defect.assignedTeam,
      assignedTo: this.formatAssignmentLabel(defect.assignedUser, defect.assignedTeam),
      inspectionId: item.inspectionId,
      assetId: inspection.assetId,
      assetCode: inspection.asset.assetCode,
      assetType: inspection.asset.assetType.name || inspection.asset.assetType.code,
      location:
        inspection.asset.substation.location ||
        inspection.asset.substation.name ||
        inspection.asset.substation.code,
      substation: {
        code: inspection.asset.substation.code,
        name: inspection.asset.substation.name,
        location: inspection.asset.substation.location,
      },
      cycleNumber: inspection.inspectionCycle,
      label: item.label,
      result: 'FAIL' as const,
      remark: item.remark,
      status: defect.status,
      severity: defect.severity,
      actionRemark: defect.actionRemark,
      dueDate: defect.dueDate?.toISOString() ?? null,
      resolvedAt: defect.resolvedAt?.toISOString() ?? null,
      closedAt: defect.closedAt?.toISOString() ?? null,
      isOverdue: slaState === 'OVERDUE',
      slaState,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private serializeDefectDetail(defect: Awaited<ReturnType<DefectsService['findAccessibleDefectById']>>) {
    if (!defect) {
      throw new NotFoundException('Defect not found.');
    }

    const item = defect.inspectionItemResult;
    const inspection = item.inspection;
    const slaState = this.calculateSlaState(defect.status, defect.dueDate);

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      checklistItemId: item.checklistItemId,
      status: defect.status,
      severity: defect.severity,
      assignedUserId: defect.assignedUserId,
      assignedTeamId: defect.assignedTeamId,
      assignedUser: defect.assignedUser,
      assignedTeam: defect.assignedTeam,
      assignedTo: this.formatAssignmentLabel(defect.assignedUser, defect.assignedTeam),
      actionRemark: defect.actionRemark,
      dueDate: defect.dueDate?.toISOString() ?? null,
      resolvedAt: defect.resolvedAt?.toISOString() ?? null,
      closedAt: defect.closedAt?.toISOString() ?? null,
      isOverdue: slaState === 'OVERDUE',
      slaState,
      label: item.label,
      result: item.result,
      checklistRemark: item.remark,
      inspectionId: inspection.id,
      assetId: inspection.assetId,
      assetCode: inspection.asset.assetCode,
      assetType: inspection.asset.assetType.name || inspection.asset.assetType.code,
      location:
        inspection.asset.substation.location ||
        inspection.asset.substation.name ||
        inspection.asset.substation.code,
      substation: {
        code: inspection.asset.substation.code,
        name: inspection.asset.substation.name,
        location: inspection.asset.substation.location,
      },
      asset: {
        id: inspection.asset.id,
        assetCode: inspection.asset.assetCode,
        name: inspection.asset.name,
        latitude: inspection.asset.latitude,
        longitude: inspection.asset.longitude,
        assetType: {
          id: inspection.asset.assetType.id,
          code: inspection.asset.assetType.code,
          name: inspection.asset.assetType.name,
        },
        substation: {
          id: inspection.asset.substation.id,
          code: inspection.asset.substation.code,
          name: inspection.asset.substation.name,
          location: inspection.asset.substation.location,
        },
      },
      cycleNumber: inspection.inspectionCycle,
      inspection: {
        id: inspection.id,
        templateId: inspection.templateId,
        cycleNumber: inspection.inspectionCycle,
        completionStatus: inspection.completionStatus,
        submittedAt: inspection.submittedAt?.toISOString() ?? null,
        createdAt: inspection.createdAt.toISOString(),
        updatedAt: inspection.updatedAt.toISOString(),
        createdBy: inspection.createdBy,
        template: inspection.template,
        siteVisit: {
          id: inspection.siteVisit.id,
          status: inspection.siteVisit.status,
          startedAt: inspection.siteVisit.startedAt.toISOString(),
          endedAt: inspection.siteVisit.endedAt?.toISOString() ?? null,
          team: inspection.siteVisit.team,
          substation: inspection.siteVisit.substation,
        },
      },
      submittedBy: inspection.createdBy,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: defect.createdAt.toISOString(),
      updatedAt: defect.updatedAt.toISOString(),
      images: inspection.inspectionImages.map((image) => ({
        id: image.id,
        inspectionId: image.inspectionId,
        url: image.url,
        path: buildInspectionImagePath(image.inspectionId, image.filename),
        filename: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      })),
      timeline: this.serializeDefectTimeline(defect),
    };
  }

  private serializeDefectTimeline(
    defect: NonNullable<Awaited<ReturnType<DefectsService['findAccessibleDefectById']>>>,
  ) {
    const entries = defect.timelineEntries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      comment: entry.comment,
      createdAt: entry.createdAt.toISOString(),
      createdBy: entry.createdBy,
    }));

    if (!entries.some((entry) => entry.type === DefectTimelineEventType.CREATED)) {
      entries.unshift({
        id: `${defect.id}-created`,
        type: DefectTimelineEventType.CREATED,
        fromStatus: null,
        toStatus: defect.status,
        comment: 'Defect opened from failed inspection item.',
        createdAt: defect.createdAt.toISOString(),
        createdBy: null,
      });
    }

    return entries.sort((left, right) => {
      const leftDate = new Date(left.createdAt).getTime();
      const rightDate = new Date(right.createdAt).getTime();

      return leftDate - rightDate;
    });
  }

  private async findAssignableUser(tenantId: string, userId: string) {
    const assignedUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    if (!assignedUser) {
      throw new NotFoundException('Assigned user not found.');
    }

    return assignedUser;
  }

  private async findAssignableTeam(tenantId: string, teamId: string) {
    const assignedTeam = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!assignedTeam) {
      throw new NotFoundException('Assigned team not found.');
    }

    return assignedTeam;
  }

  private parseDueDate(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return null;
    }

    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)
      ? new Date(`${trimmedValue}T23:59:59.999Z`)
      : new Date(trimmedValue);

    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Due date must be a valid date.');
    }

    return dueDate;
  }

  private calculateSlaState(
    status: DefectStatus,
    dueDate: Date | null,
    now = new Date(),
  ): DefectSlaState {
    if (status === DefectStatus.CLOSED || status === DefectStatus.RESOLVED) {
      return 'STOPPED';
    }

    if (!dueDate) {
      return 'NO_DUE_DATE';
    }

    if (ACTIVE_SLA_STATUSES.has(status) && dueDate.getTime() < now.getTime()) {
      return 'OVERDUE';
    }

    return 'ON_TRACK';
  }

  private formatAssignmentLabel(
    assignedUser: { name: string | null; email?: string | null } | null,
    assignedTeam: { name: string | null; code?: string | null } | null,
  ) {
    const labels = [
      assignedUser?.name?.trim() || assignedUser?.email?.trim() || null,
      assignedTeam?.name?.trim() || assignedTeam?.code?.trim() || null,
    ].filter((label): label is string => Boolean(label));

    return labels.length > 0 ? labels.join(' / ') : 'Unassigned';
  }

  private formatDueDate(dueDate: Date | null) {
    return dueDate ? dueDate.toISOString().slice(0, 10) : 'No due date';
  }

  private inspectionAccessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      siteVisit: {
        team: {
          members: {
            some: {
              userId: user.id,
              isActive: true,
            },
          },
        },
      },
    };
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for defect actions.');
    }
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }
}
