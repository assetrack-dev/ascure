import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, resolve } from 'path';
import {
  DefectLifecycleStatus,
  DefectSeverity,
  DefectStatus,
  DefectTimelineEventType,
  Prisma,
  ResolutionOutcome as DefectResolutionOutcome,
  UserRole,
} from '@prisma/client';
import { isQaActor } from '../common/authorization/qa-actor';
import { inspectorOwnsDefects } from '../common/authorization/defect-governance';
import { APPSHEET_IMPORT_REPORTING_GROUP_PREFIX } from '../common/import.constants';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import { normalizeOperationalText } from '../common/operational-text';
import {
  buildDefectEvidenceImagePath,
  buildDefectEvidenceImagesDirectory,
  buildDefectEvidenceImageUrl,
  buildInspectionImagePath,
} from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteDefectMaintenanceDto } from './dto/complete-defect-maintenance.dto';
import { CreateDefectCommentDto } from './dto/create-defect-comment.dto';
import { ListDefectOperationsBoardQueryDto } from './dto/list-defect-operations-board-query.dto';
import { UploadDefectEvidenceImageDto } from './dto/upload-defect-evidence-image.dto';
import { UpdateDefectAssignmentDto } from './dto/update-defect-assignment.dto';
import { UpdateDefectDueDateDto } from './dto/update-defect-due-date.dto';
import { UpdateDefectStatusDto } from './dto/update-defect-status.dto';
import { UpdateDefectVerificationDto } from './dto/update-defect-verification.dto';
import { VerifyDefectClosureDto } from './dto/verify-defect-closure.dto';

const ACTIVE_SLA_STATUSES = new Set<DefectStatus>([
  DefectStatus.OPEN,
  DefectStatus.IN_PROGRESS,
  DefectStatus.MONITORING,
]);

type DefectSlaState = 'OVERDUE' | 'ON_TRACK' | 'NO_DUE_DATE' | 'STOPPED';

type UploadedDefectEvidenceImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const GOVERNED_LIFECYCLE_TRANSITIONS: Record<
  DefectLifecycleStatus,
  DefectLifecycleStatus[]
> = {
  [DefectLifecycleStatus.DETECTED]: [DefectLifecycleStatus.UNDER_REVIEW],
  [DefectLifecycleStatus.UNDER_REVIEW]: [
    DefectLifecycleStatus.VERIFIED,
    DefectLifecycleStatus.REJECTED,
  ],
  [DefectLifecycleStatus.VERIFIED]: [DefectLifecycleStatus.ASSIGNED],
  [DefectLifecycleStatus.REJECTED]: [],
  [DefectLifecycleStatus.ASSIGNED]: [DefectLifecycleStatus.IN_PROGRESS],
  [DefectLifecycleStatus.IN_PROGRESS]: [DefectLifecycleStatus.COMPLETED],
  [DefectLifecycleStatus.COMPLETED]: [
    DefectLifecycleStatus.VERIFICATION_PENDING,
  ],
  [DefectLifecycleStatus.VERIFICATION_PENDING]: [DefectLifecycleStatus.CLOSED],
  [DefectLifecycleStatus.CLOSED]: [],
};

/**
 * The lifecycle status a freshly-materialized defect opens in. Under the
 * north-star "inspector owns the call" policy a detected defect is immediately
 * maintenance-ready (VERIFIED) — no QA review gate. Legacy QA_GATED mode opens
 * at DETECTED. See common/authorization/defect-governance.ts.
 */
function initialDefectLifecycleStatus(): DefectLifecycleStatus {
  return inspectorOwnsDefects()
    ? DefectLifecycleStatus.VERIFIED
    : DefectLifecycleStatus.DETECTED;
}

const DEFECT_ACTOR_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
} as const;

const DEFECT_TEAM_SELECT = {
  id: true,
  code: true,
  name: true,
} as const;

const DEFECT_MAINHEAD_SELECT = {
  id: true,
  code: true,
  name: true,
} as const;

const OPERATIONS_BOARD_INCLUDE = {
  assignedUser: {
    select: DEFECT_ACTOR_SELECT,
  },
  assignedTeam: {
    select: DEFECT_TEAM_SELECT,
  },
  assignedToUser: {
    select: DEFECT_ACTOR_SELECT,
  },
  assignedToTeam: {
    select: DEFECT_TEAM_SELECT,
  },
  verifiedByUser: {
    select: DEFECT_ACTOR_SELECT,
  },
  maintainedByUser: {
    select: DEFECT_ACTOR_SELECT,
  },
  closureVerifiedByUser: {
    select: DEFECT_ACTOR_SELECT,
  },
  timelineEntries: {
    orderBy: {
      createdAt: 'desc',
    },
    take: 1,
    select: {
      id: true,
      type: true,
      fromStatus: true,
      toStatus: true,
      fromLifecycleStatus: true,
      toLifecycleStatus: true,
      fromResolutionOutcome: true,
      toResolutionOutcome: true,
      comment: true,
      createdAt: true,
      createdBy: {
        select: DEFECT_ACTOR_SELECT,
      },
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
          siteVisitId: true,
          assetId: true,
          inspectionCycle: true,
          submittedAt: true,
          createdAt: true,
          siteVisit: {
            select: {
              id: true,
              status: true,
              mainheadId: true,
              mainhead: true,
              startedAt: true,
              endedAt: true,
              mainheadRecord: {
                select: DEFECT_MAINHEAD_SELECT,
              },
              project: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  mainheadId: true,
                  mainhead: {
                    select: DEFECT_MAINHEAD_SELECT,
                  },
                },
              },
              workPackage: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  mainheadId: true,
                  mainhead: true,
                  mainheadRecord: {
                    select: DEFECT_MAINHEAD_SELECT,
                  },
                },
              },
              team: {
                select: DEFECT_TEAM_SELECT,
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
              assetType: {
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
        },
      },
    },
  },
} satisfies Prisma.DefectInclude;

type OperationsBoardDefect = Prisma.DefectGetPayload<{
  include: typeof OPERATIONS_BOARD_INCLUDE;
}>;

type OperationsBoardActor = {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
} | null;

type OperationsBoardTeam = {
  id: string;
  code: string;
  name: string;
} | null;

type OperationsBoardMainhead = {
  id: string | null;
  code: string | null;
  name: string | null;
  label: string;
};

type OperationsBoardLatestEvent = {
  id: string;
  type: DefectTimelineEventType;
  fromStatus: DefectStatus | null;
  toStatus: DefectStatus | null;
  fromLifecycleStatus: DefectLifecycleStatus | null;
  toLifecycleStatus: DefectLifecycleStatus | null;
  fromResolutionOutcome: DefectResolutionOutcome | null;
  toResolutionOutcome: DefectResolutionOutcome | null;
  comment: string | null;
  createdAt: string;
  createdBy: OperationsBoardActor;
};

type OperationsBoardItem = {
  id: string;
  inspectionItemResultId: string;
  title: string;
  summary: string | null;
  status: DefectLifecycleStatus;
  lifecycleStatus: DefectLifecycleStatus;
  workflowStatus: DefectStatus;
  severity: DefectSeverity;
  resolutionOutcome: DefectResolutionOutcome | null;
  mainhead: OperationsBoardMainhead;
  mainheadLabel: string;
  project: {
    id: string;
    code: string | null;
    name: string;
  } | null;
  workPackage: {
    id: string;
    code: string | null;
    name: string;
  } | null;
  siteVisit: {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    team: NonNullable<OperationsBoardTeam>;
    substation: {
      id: string;
      code: string;
      name: string;
      location: string | null;
    };
  };
  asset: {
    id: string;
    code: string;
    name: string | null;
    assetType: {
      id: string;
      code: string;
      name: string;
    };
  };
  assetCode: string;
  assetName: string | null;
  assignedToUserId: string | null;
  assignedToTeamId: string | null;
  assignedToUser: OperationsBoardActor;
  assignedToTeam: OperationsBoardTeam;
  assignedTo: string;
  verifiedByUser: OperationsBoardActor;
  maintainedByUser: OperationsBoardActor;
  closureVerifiedByUser: OperationsBoardActor;
  detectedAt: string;
  createdAt: string;
  verifiedAt: string | null;
  assignedAt: string | null;
  maintainedAt: string | null;
  closureVerifiedAt: string | null;
  dueDate: string | null;
  slaState: DefectSlaState;
  isOverdue: boolean;
  latestTimelineEvent: OperationsBoardLatestEvent | null;
};

type OperationsBoardQueue = {
  key: OperationsBoardQueueKey;
  title: string;
  description: string;
  statuses: DefectLifecycleStatus[];
  count: number;
  items: OperationsBoardItem[];
};

type OperationsBoardQueueKey =
  | 'awaitingQaQc'
  | 'maintenanceReady'
  | 'inMaintenance'
  | 'awaitingClosureVerification'
  | 'closedResolved'
  | 'exceptions';

const OPERATIONS_BOARD_QUEUES: Array<{
  key: OperationsBoardQueueKey;
  title: string;
  description: string;
  statuses: DefectLifecycleStatus[];
}> = [
  {
    key: 'awaitingQaQc',
    title: 'Awaiting QA/QC',
    description: 'Detected defects waiting for QA/QC review.',
    statuses: [
      DefectLifecycleStatus.DETECTED,
      DefectLifecycleStatus.UNDER_REVIEW,
    ],
  },
  {
    key: 'maintenanceReady',
    title: 'Maintenance Ready',
    description: 'Verified defects ready for maintenance planning.',
    statuses: [DefectLifecycleStatus.VERIFIED],
  },
  {
    key: 'inMaintenance',
    title: 'In Maintenance',
    description: 'Assigned defects currently owned by maintenance.',
    statuses: [
      DefectLifecycleStatus.ASSIGNED,
      DefectLifecycleStatus.IN_PROGRESS,
    ],
  },
  {
    key: 'awaitingClosureVerification',
    title: 'Awaiting Closure Verification',
    description: 'Completed maintenance waiting for closure checks.',
    statuses: [
      DefectLifecycleStatus.COMPLETED,
      DefectLifecycleStatus.VERIFICATION_PENDING,
    ],
  },
  {
    key: 'closedResolved',
    title: 'Closed / Resolved',
    description: 'Closed defects retained for operational traceability.',
    statuses: [DefectLifecycleStatus.CLOSED],
  },
  {
    key: 'exceptions',
    title: 'Exceptions',
    description:
      'Rejected, external constraint, deferred, temporary fix, monitoring required, false positive, or duplicate outcomes.',
    statuses: [DefectLifecycleStatus.REJECTED],
  },
];

const EXCEPTION_RESOLUTION_OUTCOMES = new Set<DefectResolutionOutcome>([
  DefectResolutionOutcome.EXTERNAL_CONSTRAINT,
  DefectResolutionOutcome.DEFERRED,
  DefectResolutionOutcome.TEMPORARY_FIX,
  DefectResolutionOutcome.MONITORING_REQUIRED,
  DefectResolutionOutcome.FALSE_POSITIVE,
  DefectResolutionOutcome.DUPLICATE,
]);

const MAINTENANCE_COMPLETION_RESOLUTION_OUTCOMES = new Set<DefectResolutionOutcome>([
  DefectResolutionOutcome.RESOLVED,
  DefectResolutionOutcome.TEMPORARY_FIX,
  DefectResolutionOutcome.MONITORING_REQUIRED,
  DefectResolutionOutcome.EXTERNAL_CONSTRAINT,
  DefectResolutionOutcome.DEFERRED,
]);

const LEGACY_MAINTENANCE_RESOLUTION_OUTCOME_MAP: Partial<
  Record<DefectResolutionOutcome, DefectResolutionOutcome>
> = {
  [DefectResolutionOutcome.REPAIRED]: DefectResolutionOutcome.RESOLVED,
  [DefectResolutionOutcome.PARTIAL]: DefectResolutionOutcome.TEMPORARY_FIX,
  [DefectResolutionOutcome.MONITOR_ONLY]:
    DefectResolutionOutcome.MONITORING_REQUIRED,
  [DefectResolutionOutcome.ESCALATED]:
    DefectResolutionOutcome.EXTERNAL_CONSTRAINT,
};

@Injectable()
export class DefectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defects = await this.prisma.defect.findMany({
      where: {
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user, ctx),
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
        assignedToUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        assignedToTeam: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        verifiedByUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        maintainedByUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
        closureVerifiedByUser: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
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

  async getOperationsBoard(
    user: RequestUser,
    query: ListDefectOperationsBoardQueryDto,
  ) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defects = await this.prisma.defect.findMany({
      where: this.buildOperationsBoardWhere(user, query, ctx),
      orderBy: [
        {
          dueDate: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
      include: OPERATIONS_BOARD_INCLUDE,
    });
    const items = defects
      .map((defect) => this.serializeOperationsBoardItem(defect))
      .sort((left, right) => this.compareOperationsBoardItems(left, right));
    const queues = this.createOperationsBoardQueues();
    const mainheadQueueMap = new Map<
      string,
      {
        mainhead: OperationsBoardMainhead;
        queues: Map<OperationsBoardQueueKey, OperationsBoardQueue>;
      }
    >();

    for (const item of items) {
      const queueKey = this.getOperationsBoardQueueKey(item);
      queues.get(queueKey)?.items.push(item);

      const mainheadKey =
        item.mainhead.id ?? item.mainhead.code ?? item.mainhead.label;

      if (!mainheadQueueMap.has(mainheadKey)) {
        mainheadQueueMap.set(mainheadKey, {
          mainhead: item.mainhead,
          queues: this.createOperationsBoardQueues(),
        });
      }

      mainheadQueueMap.get(mainheadKey)?.queues.get(queueKey)?.items.push(item);
    }

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        mainhead: query.mainhead ?? null,
        projectId: query.projectId ?? null,
        workPackageId: query.workPackageId ?? null,
        siteVisitId: query.siteVisitId ?? null,
        severity: query.severity ?? null,
        status: query.status ?? null,
        resolutionOutcome: query.resolutionOutcome ?? null,
        assignedToUserId: query.assignedToUserId ?? null,
        overdueOnly: query.overdueOnly ?? false,
        q: query.q ?? null,
      },
      totalCount: items.length,
      queues: this.serializeOperationsBoardQueues(queues),
      mainheads: Array.from(mainheadQueueMap.values())
        .map((group) => {
          const serializedQueues = this.serializeOperationsBoardQueues(group.queues);

          return {
            mainhead: group.mainhead,
            count: serializedQueues.reduce((total, queue) => total + queue.count, 0),
            queues: serializedQueues,
          };
        })
        .sort((left, right) =>
          left.mainhead.label.localeCompare(right.mainhead.label, 'en', {
            numeric: true,
            sensitivity: 'base',
          }),
        ),
    };
  }

  async getDetail(user: RequestUser, defectId: string) {
    const defect = await this.findOrCreateAccessibleDefect(user, defectId);

    return this.serializeDefectDetail(defect);
  }

  async uploadEvidenceImage(
    user: RequestUser,
    defectId: string,
    dto: UploadDefectEvidenceImageDto,
    file: UploadedDefectEvidenceImageFile | undefined,
  ) {
    this.assertCanMutate(user);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required.');
    }

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const uploadDirectory = buildDefectEvidenceImagesDirectory(defect.id);

    await mkdir(uploadDirectory, { recursive: true });

    const fileExtension = this.getSafeFileExtension(file.originalname);
    const fileName = `${Date.now()}-${randomUUID()}${fileExtension}`;
    const storageKey = buildDefectEvidenceImagePath(defect.id, fileName);
    const filePath = resolve(uploadDirectory, fileName);
    const evidenceType =
      this.normalizeOptionalString(dto.evidenceType)?.toUpperCase() ??
      'MAINTENANCE_PROOF';
    const timestamp = dto.timestamp
      ? this.parseEvidenceTimestamp(dto.timestamp)
      : null;
    const note = this.normalizeOperationalString(dto.note);

    await writeFile(filePath, file.buffer);

    const image = await this.prisma.$transaction(async (tx) => {
      const createdImage = await tx.defectEvidenceImage.create({
        data: {
          defectId: defect.id,
          createdByUserId: user.id,
          evidenceType,
          fileName,
          storageKey,
          contentType: file.mimetype || null,
          sizeBytes: file.size,
          url: buildDefectEvidenceImageUrl(defect.id, fileName),
          note,
          latitude: dto.latitude,
          longitude: dto.longitude,
          timestamp,
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.COMMENT,
          comment: note
            ? `Maintenance proof image uploaded. ${note}`
            : 'Maintenance proof image uploaded.',
          createdByUserId: user.id,
        },
      });

      return createdImage;
    });

    return this.serializeDefectEvidenceImage(image);
  }

  async updateStatus(user: RequestUser, defectId: string, dto: UpdateDefectStatusDto) {
    this.assertCanMutate(user);
    this.assertNotGovernedStatusBypass(dto.status);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const actionRemark =
      dto.actionRemark === undefined
        ? undefined
        : this.normalizeOperationalString(dto.actionRemark);
    const now = new Date();
    const data: {
      status: DefectStatus;
      closedAt: Date | null;
      resolvedAt: Date | null;
      lifecycleStatus?: DefectLifecycleStatus;
      resolutionOutcome?: DefectResolutionOutcome;
      actionRemark?: string | null;
      maintainedByUserId?: string;
      maintainedAt?: Date;
      maintenanceNotes?: string | null;
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

    const statusResolutionOutcome =
      dto.status === DefectStatus.RESOLVED || dto.status === DefectStatus.CLOSED
        ? defect.resolutionOutcome ?? DefectResolutionOutcome.RESOLVED
        : null;

    if (
      statusResolutionOutcome &&
      defect.resolutionOutcome !== statusResolutionOutcome
    ) {
      data.resolutionOutcome = statusResolutionOutcome;
    }

    if (dto.status === DefectStatus.RESOLVED && defect.status !== dto.status) {
      data.maintainedByUserId = user.id;
      data.maintainedAt = now;

      if (actionRemark !== undefined) {
        data.maintenanceNotes = actionRemark;
      }
    }

    const statusDrivenLifecycleStatus = this.getLifecycleStatusForLegacyStatus(
      defect.lifecycleStatus,
      dto.status,
    );

    if (statusDrivenLifecycleStatus) {
      data.lifecycleStatus = statusDrivenLifecycleStatus;
    }

    const previousLifecycleStatus = this.getEffectiveLifecycleStatus(
      defect.lifecycleStatus,
    );
    const nextLifecycleStatus =
      statusDrivenLifecycleStatus ?? previousLifecycleStatus;
    const resolutionOutcomeChanged =
      Boolean(statusResolutionOutcome) &&
      defect.resolutionOutcome !== statusResolutionOutcome;
    const shouldCreateTimelineEntry =
      defect.status !== dto.status ||
      Boolean(actionRemark) ||
      resolutionOutcomeChanged;
    const timelineEventType =
      dto.status === DefectStatus.IN_PROGRESS && defect.status !== dto.status
        ? DefectTimelineEventType.MAINTENANCE_STARTED
        : dto.status === DefectStatus.RESOLVED && defect.status !== dto.status
          ? DefectTimelineEventType.MAINTENANCE_COMPLETED
          : resolutionOutcomeChanged && defect.status === dto.status
            ? DefectTimelineEventType.RESOLUTION_OUTCOME_UPDATED
          : defect.status === dto.status
            ? DefectTimelineEventType.COMMENT
            : DefectTimelineEventType.STATUS_CHANGED;

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
          type: timelineEventType,
          fromStatus: defect.status === dto.status ? null : defect.status,
          toStatus: defect.status === dto.status ? null : dto.status,
          fromLifecycleStatus: previousLifecycleStatus,
          toLifecycleStatus: nextLifecycleStatus,
          fromResolutionOutcome: resolutionOutcomeChanged
            ? defect.resolutionOutcome
            : null,
          toResolutionOutcome: statusResolutionOutcome,
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
    this.assertCanAssignDefect(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const hasLegacyAssignedUserId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedUserId',
    );
    const hasLegacyAssignedTeamId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedTeamId',
    );
    const hasAssignedToUserId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedToUserId',
    );
    const hasAssignedToTeamId = Object.prototype.hasOwnProperty.call(
      dto,
      'assignedToTeamId',
    );
    const hasAssignedUserId = hasLegacyAssignedUserId || hasAssignedToUserId;
    const hasAssignedTeamId = hasLegacyAssignedTeamId || hasAssignedToTeamId;

    if (!hasAssignedUserId && !hasAssignedTeamId) {
      throw new BadRequestException(
        'At least one assignment field must be provided.',
      );
    }

    const effectiveAssignedUserId =
      defect.assignedToUserId ?? defect.assignedUserId;
    const effectiveAssignedTeamId =
      defect.assignedToTeamId ?? defect.assignedTeamId;
    const nextAssignedUserId = hasAssignedUserId
      ? (hasAssignedToUserId ? dto.assignedToUserId : dto.assignedUserId) ?? null
      : effectiveAssignedUserId;
    const nextAssignedTeamId = hasAssignedTeamId
      ? (hasAssignedToTeamId ? dto.assignedToTeamId : dto.assignedTeamId) ?? null
      : effectiveAssignedTeamId;

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
      : defect.assignedToUser ?? defect.assignedUser;
    const nextAssignedTeam = hasAssignedTeamId
      ? updatedAssignedTeam
      : defect.assignedToTeam ?? defect.assignedTeam;
    const currentLifecycleStatus = this.getEffectiveLifecycleStatus(
      defect.lifecycleStatus,
    );

    const userChanged =
      defect.assignedUserId !== nextAssignedUserId ||
      defect.assignedToUserId !== nextAssignedUserId;
    const teamChanged =
      defect.assignedTeamId !== nextAssignedTeamId ||
      defect.assignedToTeamId !== nextAssignedTeamId;

    if (!userChanged && !teamChanged) {
      return this.getDetail(user, defect.id);
    }

    const now = new Date();
    const previousAssignee = this.formatAssignmentLabel(
      defect.assignedToUser ?? defect.assignedUser,
      defect.assignedToTeam ?? defect.assignedTeam,
    );
    const nextAssignee = this.formatAssignmentLabel(
      nextAssignedUserId ? nextAssignedUser : null,
      nextAssignedTeamId ? nextAssignedTeam : null,
    );
    const assignmentLifecycleStatus = this.getLifecycleStatusForAssignment(
      defect.lifecycleStatus,
      nextAssignedUserId,
      nextAssignedTeamId,
    );
    const isAssigning = Boolean(nextAssignedUserId || nextAssignedTeamId);
    const assignableLifecycleStatuses: DefectLifecycleStatus[] = [
      DefectLifecycleStatus.VERIFIED,
      DefectLifecycleStatus.ASSIGNED,
      DefectLifecycleStatus.IN_PROGRESS,
      DefectLifecycleStatus.COMPLETED,
      DefectLifecycleStatus.VERIFICATION_PENDING,
    ];

    if (
      isAssigning &&
      !assignableLifecycleStatuses.includes(currentLifecycleStatus)
    ) {
      throw new BadRequestException(
        'Defect must be verified before assignment.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          ...(hasAssignedUserId
            ? {
                assignedUserId: nextAssignedUserId,
                assignedToUserId: nextAssignedUserId,
              }
            : {}),
          ...(hasAssignedTeamId
            ? {
                assignedTeamId: nextAssignedTeamId,
                assignedToTeamId: nextAssignedTeamId,
              }
            : {}),
          assignedAt:
            nextAssignedUserId || nextAssignedTeamId
              ? now
              : null,
          ...(assignmentLifecycleStatus
            ? { lifecycleStatus: assignmentLifecycleStatus }
            : {}),
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.DEFECT_ASSIGNED,
          fromLifecycleStatus: this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
          toLifecycleStatus:
            assignmentLifecycleStatus ??
            this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
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

  async verifyDefect(
    user: RequestUser,
    defectId: string,
    dto: UpdateDefectVerificationDto,
  ) {
    this.assertCanMutate(user);
    await this.assertCanGovernQa(user, 'Defect verification');

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const now = new Date();
    const hasLegacyRemarks = Object.prototype.hasOwnProperty.call(
      dto,
      'verificationRemarks',
    );
    const hasVerificationNotes = Object.prototype.hasOwnProperty.call(
      dto,
      'verificationNotes',
    );
    const hasRemarks = hasLegacyRemarks || hasVerificationNotes;
    const verificationNotes = hasRemarks
      ? this.normalizeOperationalString(
          hasVerificationNotes ? dto.verificationNotes : dto.verificationRemarks,
        )
      : defect.verificationNotes ?? defect.verificationRemarks;

    this.assertLifecyclePath(this.getEffectiveLifecycleStatus(defect.lifecycleStatus), [
      DefectLifecycleStatus.UNDER_REVIEW,
      DefectLifecycleStatus.VERIFIED,
    ]);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          lifecycleStatus: DefectLifecycleStatus.VERIFIED,
          verifiedByUserId: user.id,
          verifiedAt: now,
          ...(hasRemarks
            ? {
                verificationNotes,
                verificationRemarks: verificationNotes,
              }
            : {}),
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.DEFECT_VERIFIED,
          fromLifecycleStatus: this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
          toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
          comment: this.buildGovernanceComment(
            'QA/QC verified defect',
            verificationNotes,
          ),
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async rejectDefect(
    user: RequestUser,
    defectId: string,
    dto: UpdateDefectVerificationDto,
  ) {
    this.assertCanMutate(user);
    await this.assertCanGovernQa(user, 'Defect rejection');

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const now = new Date();
    const hasLegacyRemarks = Object.prototype.hasOwnProperty.call(
      dto,
      'verificationRemarks',
    );
    const hasVerificationNotes = Object.prototype.hasOwnProperty.call(
      dto,
      'verificationNotes',
    );
    const hasRemarks = hasLegacyRemarks || hasVerificationNotes;
    const verificationNotes = hasRemarks
      ? this.normalizeOperationalString(
          hasVerificationNotes ? dto.verificationNotes : dto.verificationRemarks,
        )
      : defect.verificationNotes ?? defect.verificationRemarks;

    this.assertLifecyclePath(this.getEffectiveLifecycleStatus(defect.lifecycleStatus), [
      DefectLifecycleStatus.UNDER_REVIEW,
      DefectLifecycleStatus.REJECTED,
    ]);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          lifecycleStatus: DefectLifecycleStatus.REJECTED,
          verifiedByUserId: user.id,
          verifiedAt: now,
          ...(hasRemarks
            ? {
                verificationNotes,
                verificationRemarks: verificationNotes,
              }
            : {}),
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.COMMENT,
          fromLifecycleStatus: this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
          toLifecycleStatus: DefectLifecycleStatus.REJECTED,
          comment: this.buildGovernanceComment(
            'QA/QC rejected defect',
            verificationNotes,
          ),
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async completeMaintenance(
    user: RequestUser,
    defectId: string,
    dto: CompleteDefectMaintenanceDto,
  ) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    await this.assertCanCompleteMaintenance(user, defect);
    const now = new Date();
    const hasLegacyCompletionRemarks = Object.prototype.hasOwnProperty.call(
      dto,
      'completionRemarks',
    );
    const hasMaintenanceNotes = Object.prototype.hasOwnProperty.call(
      dto,
      'maintenanceNotes',
    );
    const hasLegacyRemarks = Object.prototype.hasOwnProperty.call(dto, 'remarks');
    const hasCompletionRemarks =
      hasLegacyCompletionRemarks || hasMaintenanceNotes || hasLegacyRemarks;
    const maintenanceNotes = hasCompletionRemarks
      ? this.normalizeOperationalString(
          hasMaintenanceNotes
            ? dto.maintenanceNotes
            : hasLegacyCompletionRemarks
              ? dto.completionRemarks
              : dto.remarks,
        )
      : defect.maintenanceNotes ?? defect.actionRemark;
    const resolutionOutcome = this.resolveMaintenanceResolutionOutcome(
      dto.resolutionOutcome ??
        dto.outcome ??
        defect.resolutionOutcome ??
        DefectResolutionOutcome.RESOLVED,
    );
    const resolutionOutcomeChanged =
      defect.resolutionOutcome !== resolutionOutcome;
    const currentLifecycleStatus = this.getEffectiveLifecycleStatus(
      defect.lifecycleStatus,
    );
    const completionLifecyclePath =
      this.getMaintenanceCompletionLifecyclePath(currentLifecycleStatus);
    const startsMaintenance = completionLifecyclePath.includes(
      DefectLifecycleStatus.IN_PROGRESS,
    );

    this.assertLifecyclePath(currentLifecycleStatus, completionLifecyclePath);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          lifecycleStatus: DefectLifecycleStatus.COMPLETED,
          resolutionOutcome,
          status: DefectStatus.RESOLVED,
          resolvedAt: defect.resolvedAt ?? now,
          maintainedByUserId: user.id,
          maintainedAt: now,
          ...(hasCompletionRemarks
            ? {
                actionRemark: maintenanceNotes,
                maintenanceNotes,
              }
            : {}),
        },
      });

      if (startsMaintenance) {
        await tx.defectTimelineEntry.create({
          data: {
            id: randomUUID(),
            defectId: defect.id,
            type: DefectTimelineEventType.MAINTENANCE_STARTED,
            fromLifecycleStatus: currentLifecycleStatus,
            toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
            comment: 'Maintenance started.',
            createdByUserId: user.id,
            createdAt: now,
          },
        });
      }

      const completionEventType =
        completionLifecyclePath.length === 0 &&
        resolutionOutcomeChanged &&
        defect.status === DefectStatus.RESOLVED
          ? DefectTimelineEventType.RESOLUTION_OUTCOME_UPDATED
          : DefectTimelineEventType.MAINTENANCE_COMPLETED;

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: completionEventType,
          fromStatus: defect.status === DefectStatus.RESOLVED ? null : defect.status,
          toStatus:
            defect.status === DefectStatus.RESOLVED ? null : DefectStatus.RESOLVED,
          fromLifecycleStatus: startsMaintenance
            ? DefectLifecycleStatus.IN_PROGRESS
            : currentLifecycleStatus,
          toLifecycleStatus: DefectLifecycleStatus.COMPLETED,
          fromResolutionOutcome: resolutionOutcomeChanged
            ? defect.resolutionOutcome
            : null,
          toResolutionOutcome: resolutionOutcome,
          comment: this.buildMaintenanceCompletionComment(
            resolutionOutcome,
            maintenanceNotes,
            currentLifecycleStatus,
            completionLifecyclePath,
          ),
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });

    return this.getDetail(user, defect.id);
  }

  async verifyClosure(
    user: RequestUser,
    defectId: string,
    dto: VerifyDefectClosureDto,
  ) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    await this.assertCanCloseDefect(user, defect);
    const now = new Date();
    const hasLegacyRemarks = Object.prototype.hasOwnProperty.call(
      dto,
      'closureRemarks',
    );
    const hasClosureVerificationNotes = Object.prototype.hasOwnProperty.call(
      dto,
      'closureVerificationNotes',
    );
    const hasRemarks = hasLegacyRemarks || hasClosureVerificationNotes;
    const closureVerificationNotes = hasRemarks
      ? this.normalizeOperationalString(
          hasClosureVerificationNotes
            ? dto.closureVerificationNotes
            : dto.closureRemarks,
        )
      : defect.closureVerificationNotes ?? defect.closureRemarks;
    const finalResolutionOutcome =
      defect.resolutionOutcome ?? DefectResolutionOutcome.RESOLVED;
    const resolutionOutcomeChanged =
      defect.resolutionOutcome !== finalResolutionOutcome;

    this.assertLifecyclePath(this.getEffectiveLifecycleStatus(defect.lifecycleStatus), [
      DefectLifecycleStatus.VERIFICATION_PENDING,
      DefectLifecycleStatus.CLOSED,
    ]);

    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: {
          id: defect.id,
        },
        data: {
          lifecycleStatus: DefectLifecycleStatus.CLOSED,
          status: DefectStatus.CLOSED,
          resolutionOutcome: finalResolutionOutcome,
          resolvedAt: defect.resolvedAt ?? now,
          closedAt: defect.closedAt ?? now,
          closureVerifiedByUserId: user.id,
          closureVerifiedAt: now,
          ...(hasRemarks
            ? {
                closureVerificationNotes,
                closureRemarks: closureVerificationNotes,
              }
            : {}),
        },
      });

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.CLOSURE_VERIFIED,
          fromStatus: defect.status === DefectStatus.CLOSED ? null : defect.status,
          toStatus:
            defect.status === DefectStatus.CLOSED ? null : DefectStatus.CLOSED,
          fromLifecycleStatus: this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
          toLifecycleStatus: DefectLifecycleStatus.CLOSED,
          fromResolutionOutcome: resolutionOutcomeChanged
            ? defect.resolutionOutcome
            : null,
          toResolutionOutcome: finalResolutionOutcome,
          comment: this.buildClosureVerificationComment(
            finalResolutionOutcome,
            closureVerificationNotes,
          ),
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
    const comment = this.normalizeOperationalString(dto.comment);

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

  private async ensureDefectsForAccessibleItems(
    user: RequestUser,
    ctx?: ScopeContext,
  ) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user, ctx),
          // Foundation/baseline imports are historical observations, not live
          // work — never materialize live Defects from them (null-safe: normal
          // inspections have a null reportingGroup).
          OR: [
            { reportingGroup: null },
            {
              reportingGroup: {
                not: { startsWith: APPSHEET_IMPORT_REPORTING_GROUP_PREFIX },
              },
            },
          ],
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
        lifecycleStatus: initialDefectLifecycleStatus(),
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  private async findOrCreateAccessibleDefect(user: RequestUser, defectId: string) {
    const ctx = await buildScopeContext(this.prisma, user);
    const existingDefect = await this.findAccessibleDefectById(user, defectId, ctx);

    if (existingDefect) {
      return existingDefect;
    }

    const itemResult = await this.prisma.inspectionItemResult.findFirst({
      where: {
        id: defectId,
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user, ctx),
          // Foundation/baseline imports never become live Defects (see list()).
          OR: [
            { reportingGroup: null },
            {
              reportingGroup: {
                not: { startsWith: APPSHEET_IMPORT_REPORTING_GROUP_PREFIX },
              },
            },
          ],
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
        lifecycleStatus: initialDefectLifecycleStatus(),
      },
      update: {},
    });

    const defect = await this.findAccessibleDefectByItemResultId(user, itemResult.id, ctx);

    if (!defect) {
      throw new NotFoundException('Defect not found.');
    }

    return defect;
  }

  private async findAccessibleDefectById(
    user: RequestUser,
    defectId: string,
    ctx?: ScopeContext,
  ) {
    const scope = ctx ?? (await buildScopeContext(this.prisma, user));
    return this.prisma.defect.findFirst({
      where: {
        id: defectId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user, scope),
          },
        },
      },
      include: this.defectDetailInclude(),
    });
  }

  private async findAccessibleDefectByItemResultId(
    user: RequestUser,
    inspectionItemResultId: string,
    ctx?: ScopeContext,
  ) {
    const scope = ctx ?? (await buildScopeContext(this.prisma, user));
    return this.prisma.defect.findFirst({
      where: {
        inspectionItemResultId,
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user, scope),
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
      assignedToUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      assignedToTeam: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      verifiedByUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      maintainedByUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      closureVerifiedByUser: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
      evidenceImages: {
        orderBy: {
          createdAt: 'asc' as const,
        },
        select: {
          id: true,
          defectId: true,
          createdByUserId: true,
          evidenceType: true,
          fileName: true,
          storageKey: true,
          contentType: true,
          sizeBytes: true,
          url: true,
          note: true,
          latitude: true,
          longitude: true,
          timestamp: true,
          createdAt: true,
          updatedAt: true,
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
          fromLifecycleStatus: true,
          toLifecycleStatus: true,
          fromResolutionOutcome: true,
          toResolutionOutcome: true,
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

  private buildOperationsBoardWhere(
    user: RequestUser,
    query: ListDefectOperationsBoardQueryDto,
    ctx?: ScopeContext,
  ): Prisma.DefectWhereInput {
    const filters: Prisma.DefectWhereInput[] = [
      {
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            tenantId: user.tenantId,
            ...this.inspectionAccessScope(user, ctx),
          },
        },
      },
      this.operationsBoardMainheadFilter(query.mainhead),
      this.operationsBoardProjectFilter(query.projectId),
      this.operationsBoardWorkPackageFilter(query.workPackageId),
      this.operationsBoardSiteVisitFilter(query.siteVisitId),
      this.operationsBoardSeverityFilter(query.severity),
      this.operationsBoardStatusFilter(query.status),
      this.operationsBoardResolutionOutcomeFilter(query.resolutionOutcome),
      this.operationsBoardAssignedToUserFilter(query.assignedToUserId),
      this.operationsBoardOverdueFilter(query.overdueOnly),
      this.operationsBoardSearchFilter(query.q),
    ].filter((filter) => Object.keys(filter).length > 0);

    return {
      AND: filters,
    };
  }

  private operationsBoardProjectFilter(
    projectId?: string,
  ): Prisma.DefectWhereInput {
    if (!projectId) {
      return {};
    }

    return {
      inspectionItemResult: {
        inspection: {
          siteVisit: {
            projectId,
          },
        },
      },
    };
  }

  private operationsBoardWorkPackageFilter(
    workPackageId?: string,
  ): Prisma.DefectWhereInput {
    if (!workPackageId) {
      return {};
    }

    return {
      inspectionItemResult: {
        inspection: {
          siteVisit: {
            workPackageId,
          },
        },
      },
    };
  }

  private operationsBoardSiteVisitFilter(
    siteVisitId?: string,
  ): Prisma.DefectWhereInput {
    if (!siteVisitId) {
      return {};
    }

    return {
      inspectionItemResult: {
        inspection: {
          siteVisitId,
        },
      },
    };
  }

  private operationsBoardSeverityFilter(
    severity?: DefectSeverity,
  ): Prisma.DefectWhereInput {
    return severity ? { severity } : {};
  }

  private operationsBoardStatusFilter(
    status?: DefectLifecycleStatus,
  ): Prisma.DefectWhereInput {
    if (!status) {
      return {};
    }

    if (status === DefectLifecycleStatus.DETECTED) {
      return {
        OR: [
          {
            lifecycleStatus: DefectLifecycleStatus.DETECTED,
          },
          {
            lifecycleStatus: null,
          },
        ],
      };
    }

    return {
      lifecycleStatus: status,
    };
  }

  private operationsBoardResolutionOutcomeFilter(
    resolutionOutcome?: DefectResolutionOutcome,
  ): Prisma.DefectWhereInput {
    return resolutionOutcome ? { resolutionOutcome } : {};
  }

  private operationsBoardAssignedToUserFilter(
    assignedToUserId?: string,
  ): Prisma.DefectWhereInput {
    if (!assignedToUserId) {
      return {};
    }

    return {
      OR: [
        {
          assignedToUserId,
        },
        {
          assignedUserId: assignedToUserId,
        },
      ],
    };
  }

  private operationsBoardOverdueFilter(
    overdueOnly?: boolean,
  ): Prisma.DefectWhereInput {
    if (!overdueOnly) {
      return {};
    }

    return {
      status: {
        in: [...ACTIVE_SLA_STATUSES],
      },
      dueDate: {
        lt: new Date(),
      },
    };
  }

  private operationsBoardMainheadFilter(
    mainhead?: string,
  ): Prisma.DefectWhereInput {
    const normalizedMainhead = mainhead?.trim();

    if (!normalizedMainhead) {
      return {};
    }

    const mainheadTextFilter = this.insensitiveContains(normalizedMainhead);
    const mainheadIdentityFilter = this.isUuid(normalizedMainhead)
      ? [
          {
            mainheadId: normalizedMainhead,
          },
          {
            mainheadRecord: {
              is: {
                id: normalizedMainhead,
              },
            },
          },
          {
            project: {
              is: {
                mainheadId: normalizedMainhead,
              },
            },
          },
          {
            workPackage: {
              is: {
                mainheadId: normalizedMainhead,
              },
            },
          },
        ]
      : [];

    return {
      inspectionItemResult: {
        inspection: {
          siteVisit: {
            OR: [
              ...mainheadIdentityFilter,
              {
                mainhead: mainheadTextFilter,
              },
              {
                mainheadRecord: {
                  is: {
                    OR: [
                      {
                        code: mainheadTextFilter,
                      },
                      {
                        name: mainheadTextFilter,
                      },
                    ],
                  },
                },
              },
              {
                project: {
                  is: {
                    mainhead: {
                      is: {
                        OR: [
                          {
                            code: mainheadTextFilter,
                          },
                          {
                            name: mainheadTextFilter,
                          },
                        ],
                      },
                    },
                  },
                },
              },
              {
                workPackage: {
                  is: {
                    OR: [
                      {
                        mainhead: mainheadTextFilter,
                      },
                      {
                        mainheadRecord: {
                          is: {
                            OR: [
                              {
                                code: mainheadTextFilter,
                              },
                              {
                                name: mainheadTextFilter,
                              },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    };
  }

  private operationsBoardSearchFilter(search?: string): Prisma.DefectWhereInput {
    const normalizedSearch = search?.trim();

    if (!normalizedSearch) {
      return {};
    }

    const textFilter = this.insensitiveContains(normalizedSearch);
    const relationActorFilter = {
      is: {
        OR: [
          {
            name: textFilter,
          },
          {
            email: textFilter,
          },
        ],
      },
    };
    const relationTeamFilter = {
      is: {
        OR: [
          {
            name: textFilter,
          },
          {
            code: textFilter,
          },
        ],
      },
    };
    const searchFilters: Prisma.DefectWhereInput[] = [
      {
        inspectionItemResult: {
          label: textFilter,
        },
      },
      {
        inspectionItemResult: {
          remark: textFilter,
        },
      },
      {
        actionRemark: textFilter,
      },
      {
        verificationNotes: textFilter,
      },
      {
        maintenanceNotes: textFilter,
      },
      {
        closureVerificationNotes: textFilter,
      },
      {
        assignedToUser: relationActorFilter,
      },
      {
        assignedUser: relationActorFilter,
      },
      {
        assignedToTeam: relationTeamFilter,
      },
      {
        assignedTeam: relationTeamFilter,
      },
      {
        inspectionItemResult: {
          inspection: {
            asset: {
              OR: [
                {
                  assetCode: textFilter,
                },
                {
                  name: textFilter,
                },
                {
                  assetType: {
                    OR: [
                      {
                        code: textFilter,
                      },
                      {
                        name: textFilter,
                      },
                    ],
                  },
                },
                {
                  substation: {
                    OR: [
                      {
                        code: textFilter,
                      },
                      {
                        name: textFilter,
                      },
                      {
                        location: textFilter,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      {
        inspectionItemResult: {
          inspection: {
            siteVisit: {
              OR: [
                {
                  mainhead: textFilter,
                },
                {
                  substation: {
                    OR: [
                      {
                        code: textFilter,
                      },
                      {
                        name: textFilter,
                      },
                      {
                        location: textFilter,
                      },
                    ],
                  },
                },
                {
                  mainheadRecord: {
                    is: {
                      OR: [
                        {
                          code: textFilter,
                        },
                        {
                          name: textFilter,
                        },
                      ],
                    },
                  },
                },
                {
                  project: {
                    is: {
                      OR: [
                        {
                          code: textFilter,
                        },
                        {
                          name: textFilter,
                        },
                        {
                          mainhead: {
                            is: {
                              OR: [
                                {
                                  code: textFilter,
                                },
                                {
                                  name: textFilter,
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  workPackage: {
                    is: {
                      OR: [
                        {
                          code: textFilter,
                        },
                        {
                          name: textFilter,
                        },
                        {
                          mainhead: textFilter,
                        },
                        {
                          mainheadRecord: {
                            is: {
                              OR: [
                                {
                                  code: textFilter,
                                },
                                {
                                  name: textFilter,
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    ];

    if (this.isUuid(normalizedSearch)) {
      searchFilters.push(
        {
          id: normalizedSearch,
        },
        {
          inspectionItemResultId: normalizedSearch,
        },
      );
    }

    return {
      OR: searchFilters,
    };
  }

  private serializeOperationsBoardItem(
    defect: OperationsBoardDefect,
  ): OperationsBoardItem {
    const item = defect.inspectionItemResult;
    const inspection = item.inspection;
    const siteVisit = inspection.siteVisit;
    const asset = inspection.asset;
    const lifecycleStatus = this.getEffectiveLifecycleStatus(defect.lifecycleStatus);
    const slaState = this.calculateSlaState(defect.status, defect.dueDate);
    const assignedUser = defect.assignedToUser ?? defect.assignedUser;
    const assignedTeam = defect.assignedToTeam ?? defect.assignedTeam;
    const assignedUserId = defect.assignedToUserId ?? defect.assignedUserId;
    const assignedTeamId = defect.assignedToTeamId ?? defect.assignedTeamId;
    const mainhead = this.deriveOperationsMainhead(defect);
    const latestTimelineEntry = defect.timelineEntries[0] ?? null;
    const latestTimelineEvent: OperationsBoardLatestEvent = latestTimelineEntry
      ? {
          id: latestTimelineEntry.id,
          type: latestTimelineEntry.type,
          fromStatus: latestTimelineEntry.fromStatus,
          toStatus: latestTimelineEntry.toStatus,
          fromLifecycleStatus: latestTimelineEntry.fromLifecycleStatus,
          toLifecycleStatus: latestTimelineEntry.toLifecycleStatus,
          fromResolutionOutcome: latestTimelineEntry.fromResolutionOutcome,
          toResolutionOutcome: latestTimelineEntry.toResolutionOutcome,
          comment: latestTimelineEntry.comment,
          createdAt: latestTimelineEntry.createdAt.toISOString(),
          createdBy: latestTimelineEntry.createdBy,
        }
      : {
          id: `${defect.id}-created`,
          type: DefectTimelineEventType.CREATED,
          fromStatus: null,
          toStatus: defect.status,
          fromLifecycleStatus: null,
          toLifecycleStatus: lifecycleStatus,
          fromResolutionOutcome: null,
          toResolutionOutcome: defect.resolutionOutcome,
          comment: 'Defect opened from failed inspection item.',
          createdAt: defect.createdAt.toISOString(),
          createdBy: null,
        };

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      title: item.label,
      summary: item.remark,
      status: lifecycleStatus,
      lifecycleStatus,
      workflowStatus: defect.status,
      severity: defect.severity,
      resolutionOutcome: defect.resolutionOutcome,
      mainhead,
      mainheadLabel: mainhead.label,
      project: siteVisit.project
        ? {
            id: siteVisit.project.id,
            code: siteVisit.project.code,
            name: siteVisit.project.name,
          }
        : null,
      workPackage: siteVisit.workPackage
        ? {
            id: siteVisit.workPackage.id,
            code: siteVisit.workPackage.code,
            name: siteVisit.workPackage.name,
          }
        : null,
      siteVisit: {
        id: siteVisit.id,
        status: siteVisit.status,
        startedAt: siteVisit.startedAt.toISOString(),
        endedAt: siteVisit.endedAt?.toISOString() ?? null,
        team: siteVisit.team,
        substation: siteVisit.substation,
      },
      asset: {
        id: asset.id,
        code: asset.assetCode,
        name: asset.name,
        assetType: asset.assetType,
      },
      assetCode: asset.assetCode,
      assetName: asset.name,
      assignedToUserId: assignedUserId,
      assignedToTeamId: assignedTeamId,
      assignedToUser: assignedUser,
      assignedToTeam: assignedTeam,
      assignedTo: this.formatAssignmentLabel(assignedUser, assignedTeam),
      verifiedByUser: defect.verifiedByUser,
      maintainedByUser: defect.maintainedByUser,
      closureVerifiedByUser: defect.closureVerifiedByUser,
      detectedAt: item.createdAt.toISOString(),
      createdAt: defect.createdAt.toISOString(),
      verifiedAt: defect.verifiedAt?.toISOString() ?? null,
      assignedAt: defect.assignedAt?.toISOString() ?? null,
      maintainedAt: defect.maintainedAt?.toISOString() ?? null,
      closureVerifiedAt: defect.closureVerifiedAt?.toISOString() ?? null,
      dueDate: defect.dueDate?.toISOString() ?? null,
      slaState,
      isOverdue: slaState === 'OVERDUE',
      latestTimelineEvent,
    };
  }

  private deriveOperationsMainhead(
    defect: OperationsBoardDefect,
  ): OperationsBoardMainhead {
    const siteVisit = defect.inspectionItemResult.inspection.siteVisit;
    const record =
      siteVisit.mainheadRecord ??
      siteVisit.workPackage?.mainheadRecord ??
      siteVisit.project?.mainhead ??
      null;
    const fallbackLabel =
      siteVisit.mainhead?.trim() || siteVisit.workPackage?.mainhead?.trim() || null;
    const label =
      record?.name?.trim() ||
      record?.code?.trim() ||
      fallbackLabel ||
      'Unassigned MAINHEAD';

    return {
      id:
        record?.id ??
        siteVisit.mainheadId ??
        siteVisit.workPackage?.mainheadId ??
        siteVisit.project?.mainheadId ??
        null,
      code: record?.code ?? null,
      name: record?.name ?? fallbackLabel,
      label,
    };
  }

  private createOperationsBoardQueues() {
    return new Map<OperationsBoardQueueKey, OperationsBoardQueue>(
      OPERATIONS_BOARD_QUEUES.map((queue) => [
        queue.key,
        {
          ...queue,
          count: 0,
          items: [],
        },
      ]),
    );
  }

  private serializeOperationsBoardQueues(
    queueMap: Map<OperationsBoardQueueKey, OperationsBoardQueue>,
  ) {
    return OPERATIONS_BOARD_QUEUES.map((queueDefinition) => {
      const queue = queueMap.get(queueDefinition.key);
      const items = queue?.items ?? [];

      return {
        ...queueDefinition,
        count: items.length,
        items,
      };
    });
  }

  private getOperationsBoardQueueKey(
    item: OperationsBoardItem,
  ): OperationsBoardQueueKey {
    if (
      item.status === DefectLifecycleStatus.REJECTED ||
      (item.resolutionOutcome &&
        EXCEPTION_RESOLUTION_OUTCOMES.has(item.resolutionOutcome))
    ) {
      return 'exceptions';
    }

    for (const queue of OPERATIONS_BOARD_QUEUES) {
      if (queue.key !== 'exceptions' && queue.statuses.includes(item.status)) {
        return queue.key;
      }
    }

    return 'awaitingQaQc';
  }

  private compareOperationsBoardItems(
    left: OperationsBoardItem,
    right: OperationsBoardItem,
  ) {
    const severityRank: Record<DefectSeverity, number> = {
      [DefectSeverity.CRITICAL]: 0,
      [DefectSeverity.HIGH]: 1,
      [DefectSeverity.MEDIUM]: 2,
      [DefectSeverity.LOW]: 3,
    };
    const leftOverdueRank = left.isOverdue ? 0 : 1;
    const rightOverdueRank = right.isOverdue ? 0 : 1;

    if (leftOverdueRank !== rightOverdueRank) {
      return leftOverdueRank - rightOverdueRank;
    }

    if (severityRank[left.severity] !== severityRank[right.severity]) {
      return severityRank[left.severity] - severityRank[right.severity];
    }

    const leftDueTime = left.dueDate
      ? new Date(left.dueDate).getTime()
      : Number.POSITIVE_INFINITY;
    const rightDueTime = right.dueDate
      ? new Date(right.dueDate).getTime()
      : Number.POSITIVE_INFINITY;

    if (leftDueTime !== rightDueTime) {
      return leftDueTime - rightDueTime;
    }

    return (
      new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime()
    );
  }

  private serializeDefectListItem(defect: {
    id: string;
    assignedUserId: string | null;
    assignedTeamId: string | null;
    assignedToUserId: string | null;
    assignedToTeamId: string | null;
    verifiedByUserId: string | null;
    maintainedByUserId: string | null;
    closureVerifiedByUserId: string | null;
    status: DefectStatus;
    severity: DefectSeverity;
    lifecycleStatus: DefectLifecycleStatus | null;
    resolutionOutcome: DefectResolutionOutcome | null;
    actionRemark: string | null;
    dueDate: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    assignedAt: Date | null;
    verifiedAt: Date | null;
    maintainedAt: Date | null;
    verificationRemarks: string | null;
    verificationNotes: string | null;
    maintenanceNotes: string | null;
    closureVerifiedAt: Date | null;
    closureRemarks: string | null;
    closureVerificationNotes: string | null;
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
    assignedToUser: {
      id: string;
      email: string;
      name: string;
      role: string;
    } | null;
    assignedToTeam: {
      id: string;
      code: string;
      name: string;
    } | null;
    verifiedByUser: {
      id: string;
      email: string;
      name: string;
      role: string;
    } | null;
    maintainedByUser: {
      id: string;
      email: string;
      name: string;
      role: string;
    } | null;
    closureVerifiedByUser: {
      id: string;
      email: string;
      name: string;
      role: string;
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
    const assignedUser = defect.assignedToUser ?? defect.assignedUser;
    const assignedTeam = defect.assignedToTeam ?? defect.assignedTeam;
    const assignedUserId = defect.assignedToUserId ?? defect.assignedUserId;
    const assignedTeamId = defect.assignedToTeamId ?? defect.assignedTeamId;
    const verificationNotes =
      defect.verificationNotes ?? defect.verificationRemarks;
    const closureVerificationNotes =
      defect.closureVerificationNotes ?? defect.closureRemarks;

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      assignedUserId,
      assignedTeamId,
      assignedToUserId: assignedUserId,
      assignedToTeamId: assignedTeamId,
      verifiedByUserId: defect.verifiedByUserId,
      maintainedByUserId: defect.maintainedByUserId,
      closureVerifiedByUserId: defect.closureVerifiedByUserId,
      assignedUser,
      assignedTeam,
      assignedToUser: assignedUser,
      assignedToTeam: assignedTeam,
      verifiedByUser: defect.verifiedByUser,
      maintainedByUser: defect.maintainedByUser,
      closureVerifiedByUser: defect.closureVerifiedByUser,
      assignedTo: this.formatAssignmentLabel(assignedUser, assignedTeam),
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
      lifecycleStatus: defect.lifecycleStatus,
      resolutionOutcome: defect.resolutionOutcome,
      actionRemark: defect.actionRemark,
      dueDate: defect.dueDate?.toISOString() ?? null,
      resolvedAt: defect.resolvedAt?.toISOString() ?? null,
      closedAt: defect.closedAt?.toISOString() ?? null,
      assignedAt: defect.assignedAt?.toISOString() ?? null,
      verifiedAt: defect.verifiedAt?.toISOString() ?? null,
      maintainedAt: defect.maintainedAt?.toISOString() ?? null,
      verificationNotes,
      verificationRemarks: verificationNotes,
      maintenanceNotes: defect.maintenanceNotes,
      closureVerifiedAt: defect.closureVerifiedAt?.toISOString() ?? null,
      closureVerificationNotes,
      closureRemarks: closureVerificationNotes,
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
    const assignedUser = defect.assignedToUser ?? defect.assignedUser;
    const assignedTeam = defect.assignedToTeam ?? defect.assignedTeam;
    const assignedUserId = defect.assignedToUserId ?? defect.assignedUserId;
    const assignedTeamId = defect.assignedToTeamId ?? defect.assignedTeamId;
    const verificationNotes =
      defect.verificationNotes ?? defect.verificationRemarks;
    const closureVerificationNotes =
      defect.closureVerificationNotes ?? defect.closureRemarks;

    return {
      id: defect.id,
      inspectionItemResultId: item.id,
      checklistItemId: item.checklistItemId,
      status: defect.status,
      severity: defect.severity,
      lifecycleStatus: defect.lifecycleStatus,
      resolutionOutcome: defect.resolutionOutcome,
      assignedUserId,
      assignedTeamId,
      assignedToUserId: assignedUserId,
      assignedToTeamId: assignedTeamId,
      verifiedByUserId: defect.verifiedByUserId,
      maintainedByUserId: defect.maintainedByUserId,
      closureVerifiedByUserId: defect.closureVerifiedByUserId,
      assignedUser,
      assignedTeam,
      assignedToUser: assignedUser,
      assignedToTeam: assignedTeam,
      verifiedByUser: defect.verifiedByUser,
      maintainedByUser: defect.maintainedByUser,
      closureVerifiedByUser: defect.closureVerifiedByUser,
      assignedTo: this.formatAssignmentLabel(assignedUser, assignedTeam),
      actionRemark: defect.actionRemark,
      dueDate: defect.dueDate?.toISOString() ?? null,
      resolvedAt: defect.resolvedAt?.toISOString() ?? null,
      closedAt: defect.closedAt?.toISOString() ?? null,
      assignedAt: defect.assignedAt?.toISOString() ?? null,
      verifiedAt: defect.verifiedAt?.toISOString() ?? null,
      maintainedAt: defect.maintainedAt?.toISOString() ?? null,
      verificationNotes,
      verificationRemarks: verificationNotes,
      maintenanceNotes: defect.maintenanceNotes,
      closureVerifiedAt: defect.closureVerifiedAt?.toISOString() ?? null,
      closureVerificationNotes,
      closureRemarks: closureVerificationNotes,
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
      evidenceImages: defect.evidenceImages.map((image) =>
        this.serializeDefectEvidenceImage(image),
      ),
      maintenanceProofImages: defect.evidenceImages
        .filter((image) => image.evidenceType === 'MAINTENANCE_PROOF')
        .map((image) => this.serializeDefectEvidenceImage(image)),
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
      fromLifecycleStatus: entry.fromLifecycleStatus,
      toLifecycleStatus: entry.toLifecycleStatus,
      fromResolutionOutcome: entry.fromResolutionOutcome,
      toResolutionOutcome: entry.toResolutionOutcome,
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
        fromLifecycleStatus: null,
        toLifecycleStatus: this.getEffectiveLifecycleStatus(defect.lifecycleStatus),
        fromResolutionOutcome: null,
        toResolutionOutcome: defect.resolutionOutcome,
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

  private getEffectiveLifecycleStatus(
    lifecycleStatus: DefectLifecycleStatus | null,
  ) {
    return lifecycleStatus ?? DefectLifecycleStatus.DETECTED;
  }

  private assertLifecyclePath(
    currentStatus: DefectLifecycleStatus,
    path: DefectLifecycleStatus[],
  ) {
    if (path.length === 0 || currentStatus === path[path.length - 1]) {
      return;
    }

    let cursor = currentStatus;

    for (const nextStatus of path) {
      if (cursor === nextStatus) {
        continue;
      }

      const allowedNextStatuses = GOVERNED_LIFECYCLE_TRANSITIONS[cursor];

      if (!allowedNextStatuses.includes(nextStatus)) {
        throw new BadRequestException(
          `Defect lifecycle cannot move from ${this.formatEnumLabel(cursor)} to ${this.formatEnumLabel(nextStatus)}.`,
        );
      }

      cursor = nextStatus;
    }
  }

  private getLifecycleStatusForAssignment(
    lifecycleStatus: DefectLifecycleStatus | null,
    assignedUserId: string | null,
    assignedTeamId: string | null,
  ) {
    if (!assignedUserId && !assignedTeamId) {
      return null;
    }

    const currentStatus = this.getEffectiveLifecycleStatus(lifecycleStatus);

    if (currentStatus !== DefectLifecycleStatus.VERIFIED) {
      return null;
    }

    this.assertLifecyclePath(currentStatus, [DefectLifecycleStatus.ASSIGNED]);

    return DefectLifecycleStatus.ASSIGNED;
  }

  private getLifecycleStatusForLegacyStatus(
    lifecycleStatus: DefectLifecycleStatus | null,
    defectStatus: DefectStatus,
  ) {
    const currentStatus = this.getEffectiveLifecycleStatus(lifecycleStatus);
    const targetStatus =
      defectStatus === DefectStatus.IN_PROGRESS
        ? DefectLifecycleStatus.IN_PROGRESS
        : defectStatus === DefectStatus.RESOLVED
          ? DefectLifecycleStatus.COMPLETED
          : defectStatus === DefectStatus.CLOSED
            ? DefectLifecycleStatus.CLOSED
            : null;

    if (!targetStatus || currentStatus === targetStatus) {
      return null;
    }

    const path =
      targetStatus === DefectLifecycleStatus.CLOSED &&
      currentStatus === DefectLifecycleStatus.COMPLETED
        ? [DefectLifecycleStatus.VERIFICATION_PENDING, DefectLifecycleStatus.CLOSED]
        : [targetStatus];

    try {
      this.assertLifecyclePath(currentStatus, path);
      return targetStatus;
    } catch {
      return null;
    }
  }

  private getMaintenanceCompletionLifecyclePath(
    currentStatus: DefectLifecycleStatus,
  ) {
    if (currentStatus === DefectLifecycleStatus.COMPLETED) {
      return [];
    }

    if (currentStatus === DefectLifecycleStatus.IN_PROGRESS) {
      return [DefectLifecycleStatus.COMPLETED];
    }

    if (currentStatus === DefectLifecycleStatus.ASSIGNED) {
      return [
        DefectLifecycleStatus.IN_PROGRESS,
        DefectLifecycleStatus.COMPLETED,
      ];
    }

    return [DefectLifecycleStatus.COMPLETED];
  }

  private buildGovernanceComment(title: string, remarks: string | null) {
    return remarks ? `${title}. ${remarks}` : `${title}.`;
  }

  private resolveMaintenanceResolutionOutcome(
    requestedOutcome: DefectResolutionOutcome,
  ) {
    const resolutionOutcome =
      LEGACY_MAINTENANCE_RESOLUTION_OUTCOME_MAP[requestedOutcome] ??
      requestedOutcome;

    if (!MAINTENANCE_COMPLETION_RESOLUTION_OUTCOMES.has(resolutionOutcome)) {
      throw new BadRequestException(
        `Maintenance completion outcome ${this.formatEnumLabel(requestedOutcome)} is not allowed.`,
      );
    }

    return resolutionOutcome;
  }

  private buildMaintenanceCompletionComment(
    resolutionOutcome: DefectResolutionOutcome,
    completionRemarks: string | null,
    fromLifecycleStatus: DefectLifecycleStatus,
    lifecyclePath: DefectLifecycleStatus[],
  ) {
    const parts = [
      `Maintenance completed with outcome ${this.formatEnumLabel(resolutionOutcome)}.`,
    ];

    if (lifecyclePath.length > 0) {
      const lifecycleLabels = [fromLifecycleStatus, ...lifecyclePath].map((status) =>
        this.formatEnumLabel(status),
      );

      parts.push(`Lifecycle advanced ${lifecycleLabels.join(' -> ')}.`);
    }

    if (completionRemarks) {
      parts.push(completionRemarks);
    }

    return parts.join(' ');
  }

  private buildClosureVerificationComment(
    resolutionOutcome: DefectResolutionOutcome,
    closureVerificationNotes: string | null,
  ) {
    return this.buildGovernanceComment(
      `Closure verified by Mainhead/TNB. Final resolution outcome ${this.formatEnumLabel(resolutionOutcome)}`,
      closureVerificationNotes,
    );
  }

  private formatEnumLabel(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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

  private insensitiveContains(value: string): Prisma.StringFilter {
    return {
      contains: value,
      mode: Prisma.QueryMode.insensitive,
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
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

  private serializeDefectEvidenceImage(image: {
    id: string;
    defectId: string;
    createdByUserId: string | null;
    evidenceType: string;
    fileName: string;
    storageKey: string;
    contentType: string | null;
    sizeBytes: number | null;
    url: string | null;
    note: string | null;
    latitude: number | null;
    longitude: number | null;
    timestamp: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: image.id,
      defectId: image.defectId,
      createdByUserId: image.createdByUserId,
      evidenceType: image.evidenceType,
      uploadedByUserId: image.createdByUserId,
      url: image.url,
      path: image.storageKey,
      storageKey: image.storageKey,
      filename: image.fileName,
      fileName: image.fileName,
      mimeType: image.contentType,
      contentType: image.contentType,
      sizeBytes: image.sizeBytes,
      note: image.note,
      latitude: image.latitude,
      longitude: image.longitude,
      timestamp: image.timestamp?.toISOString() ?? null,
      uploadedAt: image.createdAt.toISOString(),
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  private parseEvidenceTimestamp(value: string) {
    const timestamp = new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      throw new BadRequestException('Evidence timestamp must be a valid date.');
    }

    return timestamp;
  }

  private getSafeFileExtension(originalName: string | undefined) {
    const extension = extname(originalName || '').toLowerCase();

    if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
      return extension;
    }

    return '.jpg';
  }

  /**
   * Inspection read scope for defects.
   *
   * - ADMIN      : empty filter.
   * - QA actor   : inspection's site visit must belong to a QA-accessible MAINHEAD.
   * - MANAGER    : every team in their own company (+ their own teams).
   * - SUPERVISOR : the teams they are assigned via TeamSupervisor (+ their own).
   * - Other      : team membership only.
   *
   * The MANAGER/SUPERVISOR branches mirror site-visits.service accessScope
   * (ADR 0002 §3) so a manager monitors their whole company's defects, not only
   * the teams they personally sit on.
   */
  private inspectionAccessScope(user: RequestUser, ctx?: ScopeContext) {
    if (user.role === 'ADMIN' || ctx?.isAdmin) {
      return {};
    }

    if (ctx?.isQa) {
      return {
        siteVisit: {
          mainheadId: { in: ctx.qaMainheadIds },
        },
      };
    }

    const ownTeamMembership = {
      members: {
        some: {
          userId: user.id,
          isActive: true,
        },
      },
    };

    if (user.role === UserRole.MANAGER && user.organizationId) {
      return {
        siteVisit: {
          team: {
            OR: [{ organizationId: user.organizationId }, ownTeamMembership],
          },
        },
      };
    }

    if (user.role === UserRole.SUPERVISOR) {
      return {
        siteVisit: {
          team: {
            OR: [
              {
                supervisors: {
                  some: { supervisorUserId: user.id, isActive: true },
                },
              },
              ownTeamMembership,
            ],
          },
        },
      };
    }

    return {
      siteVisit: {
        team: ownTeamMembership,
      },
    };
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for defect actions.');
    }
  }

  private async assertCanGovernQa(user: RequestUser, action: string) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    if (await isQaActor(this.prisma, user)) {
      return;
    }

    throw new ForbiddenException(
      `${action} requires ASCURA QA authority (ADMIN or QA validator).`,
    );
  }

  /**
   * Authority to close a defect. Under the inspector-owns policy the assigned
   * maintainer — or a DC / admin — may close: the maintainer's repair IS the
   * authoritative call, so no separate QA actor is required (north-star §5/§6).
   * Legacy QA_GATED mode keeps the QA-authority requirement.
   */
  private async assertCanCloseDefect(
    user: RequestUser,
    defect: {
      assignedToUserId: string | null;
      assignedUserId: string | null;
      assignedToTeamId: string | null;
      assignedTeamId: string | null;
    },
  ) {
    if (!inspectorOwnsDefects()) {
      await this.assertCanGovernQa(user, 'Closure verification');
      return;
    }

    if (user.role === UserRole.ADMIN) {
      return;
    }
    if (await isQaActor(this.prisma, user)) {
      return;
    }
    try {
      await this.assertCanCompleteMaintenance(user, defect);
    } catch {
      throw new ForbiddenException(
        'Closing a defect requires the assigned maintainer, a DC, or an admin.',
      );
    }
  }

  private assertCanAssignDefect(user: RequestUser) {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }

    throw new ForbiddenException(
      'Defect assignment requires ADMIN or MANAGER authority.',
    );
  }

  private async assertCanCompleteMaintenance(
    user: RequestUser,
    defect: {
      assignedToUserId: string | null;
      assignedUserId: string | null;
      assignedToTeamId: string | null;
      assignedTeamId: string | null;
    },
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }

    const assignedUserId =
      defect.assignedToUserId ?? defect.assignedUserId ?? null;

    if (assignedUserId && assignedUserId === user.id) {
      return;
    }

    const assignedTeamId =
      defect.assignedToTeamId ?? defect.assignedTeamId ?? null;

    if (assignedTeamId) {
      const membership = await this.prisma.teamMember.findFirst({
        where: {
          teamId: assignedTeamId,
          userId: user.id,
          isActive: true,
        },
        select: { id: true },
      });

      if (membership) {
        return;
      }
    }

    throw new ForbiddenException(
      'Maintenance completion is restricted to the assigned user or active members of the assigned team.',
    );
  }

  private assertNotGovernedStatusBypass(status: DefectStatus) {
    if (status === DefectStatus.CLOSED) {
      throw new ForbiddenException(
        'Use PATCH /defects/:id/closure-verification to close a defect.',
      );
    }

    if (status === DefectStatus.RESOLVED) {
      throw new ForbiddenException(
        'Use PATCH /defects/:id/maintenance-completion to mark maintenance complete.',
      );
    }
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private normalizeOperationalString(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value);

    return normalizedValue ? normalizeOperationalText(normalizedValue) : null;
  }
}
