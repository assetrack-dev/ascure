import {
  BadRequestException,
  ConflictException,
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
  InspectionCompletionStatus,
  MaintenanceCategory,
  OrganizationType,
  Prisma,
  ResolutionOutcome as DefectResolutionOutcome,
  UserRole,
} from '@prisma/client';
import {
  deriveDisplayStatus,
  DISPLAY_STATUS_LABEL,
  type DisplayStatus,
} from '@ascure/shared-utils';
import { isQaActor } from '../common/authorization/qa-actor';
import {
  inspectorOwnsDefects,
  releaseDefectsOnReport,
  resolveDefectGovernanceMode,
} from '../common/authorization/defect-governance';
import { buildInitialDefectData } from './defect-materialization.util';
import { APPSHEET_IMPORT_REPORTING_GROUP_PREFIX } from '../common/import.constants';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import { siteVisitAccessWhere } from '../common/authorization/site-visit-scope';
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
import { DelegateDefectDto } from './dto/delegate-defect.dto';
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

  async list(user: RequestUser, limit?: number) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defects = await this.prisma.defect.findMany({
      where: this.defectAccessScope(user, ctx),
      orderBy: {
        createdAt: 'desc',
      },
      // Newest-first cap (mobile); admin-web omits it and keeps the full list.
      ...(limit ? { take: limit } : {}),
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
      // Under INSPECTOR_OWNS, submitted defects open VERIFIED (no QA/QC gate),
      // so the admin board hides the "Awaiting QA/QC" column. Surfaced here so
      // the client can decide without re-reading the governance env.
      inspectorOwns: inspectorOwnsDefects(),
      // The active defect-governance mode (INSPECTOR_OWNS | QA_GATED |
      // RELEASE_ON_REPORT). Lets the board relabel/show the first column without
      // re-deriving it client-side. See defect-governance.ts.
      governanceMode: resolveDefectGovernanceMode(),
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
          const serializedQueues = this.serializeOperationsBoardQueues(
            group.queues,
            false,
          );

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

  /**
   * Lightweight feed of active (not-yet-closed) emergency defects in the
   * caller's scope. Polled by the mobile app to raise an immediate in-app
   * alert when an inspector flags a dangerous-to-public asset.
   */
  async listActiveEmergencies(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defects = await this.prisma.defect.findMany({
      where: {
        isEmergency: true,
        status: { not: DefectStatus.CLOSED },
        ...this.defectAccessScope(user, ctx),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        severity: true,
        createdAt: true,
        inspectionItemResult: {
          select: {
            label: true,
            inspection: {
              select: {
                asset: {
                  select: {
                    assetCode: true,
                    substation: {
                      select: { name: true, location: true, code: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    return {
      generatedAt: new Date().toISOString(),
      count: defects.length,
      emergencies: defects.map((defect) => {
        const asset = defect.inspectionItemResult.inspection.asset;

        return {
          id: defect.id,
          severity: defect.severity,
          label: defect.inspectionItemResult.label,
          assetCode: asset.assetCode,
          location:
            asset.substation.location ||
            asset.substation.name ||
            asset.substation.code,
          createdAt: defect.createdAt.toISOString(),
        };
      }),
    };
  }

  /**
   * Maintenance workspace — the routed pool packaged by Pencawang (substation)
   * for dispatch. Each package splits into the three work-type lanes (RENTIS /
   * CAT_TIANG / SELENGGARAAN) with an assignment summary. Emergencies are excluded
   * from the lanes (they live in the separate active-emergencies priority lane)
   * but counted per package for context. Scope is defectAccessScope, so a
   * maintenance company sees its routed pool, the inspecting org sees its own open
   * defects, and ADMIN sees the tenant — all grouped identically. Closed/resolved
   * defects (work done) are excluded.
   */
  async getMaintenanceWorkspace(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defects = await this.prisma.defect.findMany({
      where: {
        status: { notIn: [DefectStatus.CLOSED, DefectStatus.RESOLVED] },
        ...this.defectAccessScope(user, ctx),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        isEmergency: true,
        severity: true,
        maintenanceCategory: true,
        lifecycleStatus: true,
        createdAt: true,
        assignedTeam: { select: { id: true, name: true, code: true } },
        assignedToTeam: { select: { id: true, name: true, code: true } },
        inspectionItemResult: {
          select: {
            label: true,
            inspection: {
              select: {
                asset: {
                  select: {
                    assetCode: true,
                    substation: {
                      select: { id: true, code: true, name: true, location: true },
                    },
                  },
                },
                siteVisit: {
                  select: { mainheadRecord: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    type LaneAcc = {
      count: number;
      unassignedCount: number;
      inProgressCount: number;
      teams: Map<string, { id: string; name: string; count: number }>;
    };
    type PackageAcc = {
      substation: {
        id: string;
        code: string;
        name: string;
        location: string | null;
      };
      mainhead: { id: string; name: string } | null;
      emergencyCount: number;
      lanes: Map<MaintenanceCategory, LaneAcc>;
    };

    const packages = new Map<string, PackageAcc>();
    const emergencies: Array<{
      id: string;
      label: string;
      assetCode: string;
      severity: DefectSeverity;
      substationName: string;
      createdAt: string;
    }> = [];
    let totalRouted = 0;
    let emergencyCount = 0;

    for (const defect of defects) {
      const inspection = defect.inspectionItemResult.inspection;
      const substation = inspection.asset.substation;
      const mainhead = inspection.siteVisit?.mainheadRecord ?? null;

      let pkg = packages.get(substation.id);
      if (!pkg) {
        pkg = {
          substation,
          mainhead,
          emergencyCount: 0,
          lanes: new Map(),
        };
        packages.set(substation.id, pkg);
      } else if (!pkg.mainhead && mainhead) {
        pkg.mainhead = mainhead;
      }

      if (defect.isEmergency) {
        pkg.emergencyCount += 1;
        emergencyCount += 1;
        emergencies.push({
          id: defect.id,
          label: defect.inspectionItemResult.label,
          assetCode: inspection.asset.assetCode,
          severity: defect.severity,
          substationName: substation.name || substation.code,
          createdAt: defect.createdAt.toISOString(),
        });
        continue;
      }

      totalRouted += 1;
      const category =
        defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN;
      let lane = pkg.lanes.get(category);
      if (!lane) {
        lane = { count: 0, unassignedCount: 0, inProgressCount: 0, teams: new Map() };
        pkg.lanes.set(category, lane);
      }
      lane.count += 1;

      const team = defect.assignedToTeam ?? defect.assignedTeam;
      if (team) {
        const existing = lane.teams.get(team.id);
        if (existing) {
          existing.count += 1;
        } else {
          lane.teams.set(team.id, {
            id: team.id,
            name: team.name || team.code || 'Team',
            count: 1,
          });
        }
      } else {
        lane.unassignedCount += 1;
      }

      if (defect.lifecycleStatus === DefectLifecycleStatus.IN_PROGRESS) {
        lane.inProgressCount += 1;
      }
    }

    const categories: MaintenanceCategory[] = [
      MaintenanceCategory.RENTIS,
      MaintenanceCategory.CAT_TIANG,
      MaintenanceCategory.SELENGGARAAN,
    ];

    // The Pencawang's survey status (most recent visit) — the workspace groups its
    // packages by this, and only a COMPLETED survey may be assigned out.
    const displayStatusBySubstation = await this.resolveSubstationDisplayStatus(
      user.tenantId,
      Array.from(packages.keys()),
    );

    const serializedPackages = Array.from(packages.values())
      .map((pkg) => {
        const lanes = categories.map((category) => {
          const lane = pkg.lanes.get(category);
          return {
            category,
            count: lane?.count ?? 0,
            unassignedCount: lane?.unassignedCount ?? 0,
            inProgressCount: lane?.inProgressCount ?? 0,
            teams: lane
              ? Array.from(lane.teams.values()).sort(
                  (left, right) => right.count - left.count,
                )
              : [],
          };
        });
        const totalCount = lanes.reduce((sum, lane) => sum + lane.count, 0);

        const displayStatus =
          displayStatusBySubstation.get(pkg.substation.id) ?? null;

        return {
          substation: pkg.substation,
          mainhead: pkg.mainhead,
          totalCount,
          emergencyCount: pkg.emergencyCount,
          displayStatus,
          displayStatusLabel: displayStatus
            ? DISPLAY_STATUS_LABEL[displayStatus]
            : null,
          // Defects release to maintenance only once the report is compiled.
          // Advisory for the UI; enforced server-side in assignMaintenanceLane.
          assignable: displayStatus === 'COMPLETED',
          lanes,
        };
      })
      .filter((pkg) => pkg.totalCount > 0 || pkg.emergencyCount > 0)
      .sort(
        (left, right) =>
          right.totalCount - left.totalCount ||
          left.substation.name.localeCompare(right.substation.name),
      );

    // Dispatch roster for the assign picker — same org scope as assignment itself
    // (ADMIN: tenant-wide; MANAGER: own company; others can't assign).
    const canAssign =
      user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    const assignableTeams =
      canAssign && (user.role === UserRole.ADMIN || user.organizationId)
        ? await this.prisma.team.findMany({
            where: {
              tenantId: user.tenantId,
              isActive: true,
              ...(user.role === UserRole.ADMIN
                ? {}
                : { organizationId: user.organizationId ?? undefined }),
            },
            select: { id: true, name: true, code: true },
            orderBy: { name: 'asc' },
          })
        : [];

    return {
      generatedAt: new Date().toISOString(),
      governanceMode: resolveDefectGovernanceMode(),
      totalRouted,
      emergencyCount,
      emergencies,
      packages: serializedPackages,
      canAssign,
      assignableTeams: assignableTeams.map((team) => ({
        id: team.id,
        name: team.name || team.code || 'Team',
      })),
    };
  }

  /**
   * Bulk-assign (or clear) a team across a maintenance workspace lane — all open,
   * non-emergency defects at a Pencawang, optionally narrowed to one work-type.
   * Mirrors updateAssignment's authority: ADMIN any team; a MANAGER only their own
   * company's teams and only their own actionable defects (never a pole routed to
   * another company). Assignment promotes a VERIFIED defect to ASSIGNED.
   */
  async assignMaintenanceLane(
    user: RequestUser,
    dto: {
      substationId: string;
      category?: MaintenanceCategory;
      assignedToTeamId?: string | null;
    },
  ) {
    this.assertCanMutate(user);
    this.assertCanAssignDefect(user);

    const orgRestriction =
      user.role === UserRole.ADMIN ? undefined : user.organizationId ?? undefined;
    if (user.role !== UserRole.ADMIN && !orgRestriction) {
      throw new ForbiddenException(
        'Your account has no operational company, so it cannot dispatch maintenance work.',
      );
    }

    const teamId = dto.assignedToTeamId ?? null;
    const team = teamId
      ? await this.findAssignableTeam(user.tenantId, teamId, orgRestriction)
      : null;

    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    // Defects release to maintenance only once the survey's report is compiled
    // (displayStatus COMPLETED = LAPORAN SELESAI). The workspace hides the picker
    // for other statuses, but that is a UI affordance — enforce it here.
    //
    // UNASSIGNING (teamId null) stays allowed at any status: it is the escape hatch
    // for an assignment made before this gate existed, which would otherwise be
    // impossible to undo on a Pencawang whose survey is no longer Completed.
    if (teamId) {
      const assignStatus = (
        await this.resolveSubstationDisplayStatus(user.tenantId, [dto.substationId])
      ).get(dto.substationId);

      if (assignStatus !== 'COMPLETED') {
        throw new BadRequestException(
          'Defects can only be assigned once the Pencawang survey is Completed (report generated).',
        );
      }
    }

    const categoryWhere: Prisma.DefectWhereInput = !dto.category
      ? {}
      : dto.category === MaintenanceCategory.SELENGGARAAN
        ? {
            OR: [
              { maintenanceCategory: MaintenanceCategory.SELENGGARAAN },
              { maintenanceCategory: null },
            ],
          }
        : { maintenanceCategory: dto.category };

    // Non-admins may only act on their own pool (own-org routed or not-yet-routed),
    // never on work routed to another company that they merely oversee.
    const ownPoolWhere: Prisma.DefectWhereInput =
      user.role === UserRole.ADMIN
        ? {}
        : {
            OR: [
              { maintenanceOrganizationId: null },
              { maintenanceOrganizationId: user.organizationId },
            ],
          };

    const targets = await this.prisma.defect.findMany({
      where: {
        AND: [
          this.defectAccessScope(user, ctx),
          {
            isEmergency: false,
            lifecycleStatus: {
              in: [
                DefectLifecycleStatus.VERIFIED,
                DefectLifecycleStatus.ASSIGNED,
                DefectLifecycleStatus.IN_PROGRESS,
                DefectLifecycleStatus.COMPLETED,
                DefectLifecycleStatus.VERIFICATION_PENDING,
              ],
            },
            inspectionItemResult: {
              inspection: { asset: { substationId: dto.substationId } },
            },
          },
          categoryWhere,
          ownPoolWhere,
        ],
      },
      select: { id: true, lifecycleStatus: true },
    });

    if (targets.length === 0) {
      return { assigned: 0 };
    }

    const ids = targets.map((target) => target.id);
    const now = new Date();
    const verb = teamId ? `assigned to ${team?.name ?? 'a team'}` : 'unassigned';

    await this.prisma.$transaction([
      this.prisma.defect.updateMany({
        where: { id: { in: ids } },
        data: {
          assignedToTeamId: teamId,
          assignedTeamId: teamId,
          assignedAt: teamId ? now : null,
        },
      }),
      // Promote VERIFIED → ASSIGNED only when assigning (updateMany can't do this
      // per-row, so it's a second scoped pass).
      ...(teamId
        ? [
            this.prisma.defect.updateMany({
              where: {
                id: { in: ids },
                lifecycleStatus: DefectLifecycleStatus.VERIFIED,
              },
              data: { lifecycleStatus: DefectLifecycleStatus.ASSIGNED },
            }),
          ]
        : []),
      this.prisma.defectTimelineEntry.createMany({
        data: targets.map((target) => ({
          id: randomUUID(),
          defectId: target.id,
          type: DefectTimelineEventType.DEFECT_ASSIGNED,
          fromLifecycleStatus: target.lifecycleStatus,
          toLifecycleStatus:
            teamId && target.lifecycleStatus === DefectLifecycleStatus.VERIFIED
              ? DefectLifecycleStatus.ASSIGNED
              : target.lifecycleStatus,
          comment: `Bulk ${verb} via the maintenance workspace.`,
          createdByUserId: user.id,
          createdAt: now,
        })),
      }),
    ]);

    return { assigned: ids.length };
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
    // Maintenance self-management: a non-admin (MANAGER) may only dispatch within
    // their own company. They cannot re-assign work that's been routed/delegated
    // to ANOTHER company (which they may still SEE via subcontractor oversight),
    // and the assignee must belong to their org.
    const assigneeOrgRestriction = this.resolveAssignmentOrgRestriction(
      user,
      defect,
    );
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
        ? this.findAssignableUser(
            user.tenantId,
            nextAssignedUserId,
            assigneeOrgRestriction,
          )
        : Promise.resolve(null),
      hasAssignedTeamId && nextAssignedTeamId
        ? this.findAssignableTeam(
            user.tenantId,
            nextAssignedTeamId,
            assigneeOrgRestriction,
          )
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

  /**
   * Maintenance self-management — the dispatch options for a routed defect: the
   * teams + technicians of the responsible company a manager can assign to, and
   * the registered subcontractors they can delegate to. Role/defect-aware:
   *  - ADMIN on an un-routed defect: tenant-wide teams/users (legacy fallback).
   *  - otherwise scoped to the defect's maintenance company (a MANAGER's own org).
   */
  async getAssignmentOptions(user: RequestUser, defectId: string) {
    // Same authority gate as the assign/delegate actions this feeds — the roster
    // it returns (names + emails) is ADMIN/MANAGER-only, so a defect reader
    // (TECHNICIAN/SUPERVISOR/VIEWER/CLIENT) must not be able to pull it.
    this.assertCanMutate(user);
    this.assertCanAssignDefect(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const routedOrgId = defect.maintenanceOrganizationId;
    const responsibleOrgId =
      routedOrgId ??
      (user.role === UserRole.ADMIN ? null : user.organizationId ?? null);

    // A non-admin can dispatch only their OWN company's routed/own work — not a
    // defect delegated to another company (visible via oversight, not actionable)
    // — and never tenant-wide: a non-admin with NO resolved responsible org must
    // get nothing (mirrors resolveAssignmentOrgRestriction, which would reject).
    const isForeignRouted =
      user.role !== UserRole.ADMIN &&
      Boolean(routedOrgId) &&
      routedOrgId !== user.organizationId;
    const canAssign =
      !isForeignRouted &&
      (user.role === UserRole.ADMIN || Boolean(responsibleOrgId));

    const orgFilter = responsibleOrgId
      ? { organizationId: responsibleOrgId }
      : {};

    const [teams, users, subcontractors] = await Promise.all([
      canAssign
        ? this.prisma.team.findMany({
            where: { tenantId: user.tenantId, isActive: true, ...orgFilter },
            select: { id: true, code: true, name: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      canAssign
        ? this.prisma.user.findMany({
            where: { tenantId: user.tenantId, isActive: true, ...orgFilter },
            select: { id: true, name: true, email: true, role: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
      routedOrgId && canAssign
        ? this.prisma.organization.findMany({
            where: {
              parentOrganizationId: routedOrgId,
              isActive: true,
              type: {
                in: [
                  OrganizationType.SUBCONTRACTOR,
                  OrganizationType.MAIN_CONTRACTOR,
                ],
              },
            },
            select: { id: true, name: true, code: true, type: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    return {
      responsibleOrganizationId: responsibleOrgId,
      canAssign,
      canDelegate: subcontractors.length > 0,
      teams,
      users,
      subcontractors,
    };
  }

  /**
   * Maintenance self-management — delegate a routed defect to one of the routed
   * company's registered subcontractors. Re-stamps the routing org, clears any
   * internal assignment, and returns the defect to VERIFIED so the subcontractor
   * can claim/assign it. The delegating manager keeps oversight visibility via
   * the subcontractor-child scope branch (see buildScopeContext).
   */
  async delegateDefect(
    user: RequestUser,
    defectId: string,
    dto: DelegateDefectDto,
  ) {
    this.assertCanMutate(user);
    this.assertCanAssignDefect(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const currentOrgId = defect.maintenanceOrganizationId;

    if (!currentOrgId) {
      throw new BadRequestException(
        'Only a defect that has been released and routed to a maintenance company can be delegated.',
      );
    }

    if (user.role !== UserRole.ADMIN && currentOrgId !== user.organizationId) {
      throw new ForbiddenException(
        'You can only delegate defects routed to your company.',
      );
    }

    const lifecycleStatus = this.getEffectiveLifecycleStatus(
      defect.lifecycleStatus,
    );
    const delegableStatuses: DefectLifecycleStatus[] = [
      DefectLifecycleStatus.VERIFIED,
      DefectLifecycleStatus.ASSIGNED,
      DefectLifecycleStatus.IN_PROGRESS,
    ];
    if (!delegableStatuses.includes(lifecycleStatus)) {
      throw new BadRequestException(
        'This defect can no longer be delegated — maintenance is already complete, closed, or not yet released.',
      );
    }

    if (dto.organizationId === currentOrgId) {
      throw new BadRequestException(
        'This defect is already routed to that company.',
      );
    }

    const target = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        tenantId: true,
        parentOrganizationId: true,
      },
    });

    if (!target || !target.isActive) {
      throw new NotFoundException(
        'Subcontractor organisation not found or inactive.',
      );
    }

    // Defense-in-depth: never route a defect to an org in another tenant
    // (the parent-FK check below normally keeps it in-family, but the FK is not
    // tenant-constrained). Tolerant of legacy null-tenant orgs.
    if (target.tenantId && target.tenantId !== user.tenantId) {
      throw new BadRequestException('Cannot delegate to an organisation in another tenant.');
    }

    if (
      target.type !== OrganizationType.SUBCONTRACTOR &&
      target.type !== OrganizationType.MAIN_CONTRACTOR
    ) {
      throw new BadRequestException(
        'A defect can only be delegated to a contractor organisation.',
      );
    }

    // Delegation must go to a registered subcontractor OF the company the defect
    // is currently routed to — keeps the hand-off within the contractor family
    // (and the tenant). Applies to ADMIN too.
    if (target.parentOrganizationId !== currentOrgId) {
      throw new BadRequestException(
        'The target must be a registered subcontractor of the company the defect is routed to.',
      );
    }

    const now = new Date();

    const delegated = await this.prisma.$transaction(async (tx) => {
      // Atomic, single-winner re-route: the write only lands if the defect is
      // STILL routed to currentOrg and in a delegable state at write time — so a
      // concurrent claim/assign/delegate can't be silently clobbered (mirrors
      // claimDefect). A lost race surfaces as a 409, not a stale overwrite.
      const result = await tx.defect.updateMany({
        where: {
          id: defect.id,
          maintenanceOrganizationId: currentOrgId,
          lifecycleStatus: { in: delegableStatuses },
        },
        data: {
          maintenanceOrganizationId: target.id,
          assignedUserId: null,
          assignedToUserId: null,
          assignedTeamId: null,
          assignedToTeamId: null,
          assignedAt: null,
          lifecycleStatus: DefectLifecycleStatus.VERIFIED,
          // Hand off a clean slate — the prior company's in-flight work metadata
          // must not bleed into the subcontractor's fresh pool, and a stale
          // dueDate would keep driving SLA/overdue state under the new owner.
          status: DefectStatus.OPEN,
          dueDate: null,
          actionRemark: null,
          maintenanceNotes: null,
          resolutionOutcome: null,
          resolvedAt: null,
          maintainedByUserId: null,
          maintainedAt: null,
        },
      });

      if (result.count === 0) {
        return false;
      }

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
          fromLifecycleStatus: lifecycleStatus,
          toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
          comment: `Delegated to subcontractor ${target.name}; returned to their maintenance pool.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });

      return true;
    });

    if (!delegated) {
      throw new ConflictException(
        'This defect just changed state and could not be delegated — refresh and try again.',
      );
    }

    return this.getDetail(user, defect.id);
  }

  /**
   * Self-serve claim: a maintainer grabs a verified, unassigned defect and
   * becomes its assignee in one step (no MANAGER hand-off required). Reuses the
   * read-scope check in findOrCreateAccessibleDefect, so a maintainer can only
   * claim defects already inside their scope — claiming never widens access.
   */
  async claimDefect(user: RequestUser, defectId: string) {
    this.assertCanMutate(user);

    const defect = await this.findOrCreateAccessibleDefect(user, defectId);
    const currentLifecycleStatus = this.getEffectiveLifecycleStatus(
      defect.lifecycleStatus,
    );
    const currentAssignedUserId =
      defect.assignedToUserId ?? defect.assignedUserId ?? null;
    const currentAssignedTeamId =
      defect.assignedToTeamId ?? defect.assignedTeamId ?? null;

    // Idempotent: re-claiming a defect that is already mine is a no-op.
    if (currentAssignedUserId === user.id) {
      return this.getDetail(user, defect.id);
    }

    // Someone else already owns it — don't let a second maintainer grab it.
    if (currentAssignedUserId || currentAssignedTeamId) {
      throw new ConflictException(
        `This defect is already claimed by ${this.formatAssignmentLabel(
          defect.assignedToUser ?? defect.assignedUser,
          defect.assignedToTeam ?? defect.assignedTeam,
        )}.`,
      );
    }

    // Only a verified, maintenance-ready defect can be claimed.
    if (currentLifecycleStatus !== DefectLifecycleStatus.VERIFIED) {
      throw new BadRequestException(
        'Only a verified, unassigned defect can be claimed for maintenance.',
      );
    }

    const now = new Date();

    const claimed = await this.prisma.$transaction(async (tx) => {
      // Atomic single-winner claim: the write only lands if the row is STILL
      // verified and unassigned at write time. Two maintainers tapping "claim"
      // on the same hot emergency can't both win — the DB, not the earlier
      // read, decides. (The checks above stay for fast, friendly errors.)
      const result = await tx.defect.updateMany({
        where: {
          id: defect.id,
          assignedUserId: null,
          assignedToUserId: null,
          assignedTeamId: null,
          assignedToTeamId: null,
          lifecycleStatus: DefectLifecycleStatus.VERIFIED,
        },
        data: {
          assignedUserId: user.id,
          assignedToUserId: user.id,
          assignedTeamId: null,
          assignedToTeamId: null,
          assignedAt: now,
          lifecycleStatus: DefectLifecycleStatus.ASSIGNED,
        },
      });

      if (result.count === 0) {
        return false;
      }

      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.DEFECT_ASSIGNED,
          fromLifecycleStatus: currentLifecycleStatus,
          toLifecycleStatus: DefectLifecycleStatus.ASSIGNED,
          comment: `Self-claimed by ${this.formatAssignmentLabel(
            { name: user.name, email: user.email },
            null,
          )}.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });

      return true;
    });

    if (!claimed) {
      // Lost the race between our read and write — resolve from fresh state.
      const fresh = await this.findOrCreateAccessibleDefect(user, defect.id);
      const freshAssignedUserId =
        fresh.assignedToUserId ?? fresh.assignedUserId ?? null;

      if (freshAssignedUserId === user.id) {
        return this.getDetail(user, defect.id);
      }

      throw new ConflictException(
        'This defect is no longer available to claim — it was just claimed or changed state.',
      );
    }

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

  /**
   * A Pencawang's survey status = the unified `displayStatus` of its MOST RECENT
   * site visit. The maintenance workspace groups its packages by this, and only a
   * COMPLETED survey (report generated / LAPORAN SELESAI) may have its defects
   * assigned out to a maintenance team.
   */
  private async resolveSubstationDisplayStatus(
    tenantId: string,
    substationIds: string[],
  ): Promise<Map<string, DisplayStatus>> {
    if (substationIds.length === 0) {
      return new Map();
    }

    const visits = await this.prisma.siteVisit.findMany({
      where: { tenantId, substationId: { in: substationIds } },
      orderBy: { startedAt: 'desc' },
      select: { substationId: true, status: true, lifecycleStatus: true },
    });

    const bySubstation = new Map<string, DisplayStatus>();

    for (const visit of visits) {
      // First seen per Pencawang = the most recent visit (ordered desc).
      if (!bySubstation.has(visit.substationId)) {
        bySubstation.set(
          visit.substationId,
          deriveDisplayStatus(visit.status, visit.lifecycleStatus),
        );
      }
    }

    return bySubstation;
  }

  private async ensureDefectsForAccessibleItems(
    user: RequestUser,
    ctx?: ScopeContext,
  ) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        // Only items not yet materialized. Without this we re-select every flagged
        // item forever and hand them all to createMany on EVERY read path
        // (dashboard, defects list, operations board, maintenance workspace).
        // skipDuplicates keeps that correct but not cheap — Postgres still plans
        // and index-probes each row. With the guard, steady state selects zero
        // rows and the early-return below skips the write entirely.
        defect: { is: null },
        inspection: {
          tenantId: user.tenantId,
          // Live defects exist only for SUBMITTED inspections — never materialize
          // one from a draft / amended-not-yet-resubmitted inspection.
          completionStatus: InspectionCompletionStatus.SUBMITTED,
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
        isEmergency: true,
        maintenanceCategory: true,
      },
    });

    if (itemResults.length === 0) {
      return;
    }

    const now = new Date();

    await this.prisma.defect.createMany({
      data: itemResults.map((item) => buildInitialDefectData(item, now)),
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
          // Live defects exist only for SUBMITTED inspections (see list()).
          completionStatus: InspectionCompletionStatus.SUBMITTED,
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
        isEmergency: true,
        maintenanceCategory: true,
      },
    });

    if (!itemResult) {
      throw new NotFoundException('Defect not found.');
    }

    await this.prisma.defect.upsert({
      where: {
        inspectionItemResultId: itemResult.id,
      },
      create: buildInitialDefectData(itemResult, new Date()),
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
        ...this.defectAccessScope(user, scope),
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
        ...this.defectAccessScope(user, scope),
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
      this.defectAccessScope(user, ctx),
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
    // The per-mainhead rollup renders counts only, so it must NOT re-serialize
    // every defect a second time — JSON has no reference sharing, so doing so
    // doubled the board payload (and the client's normalization work) for rows
    // nothing ever reads.
    includeItems = true,
  ) {
    // Under RELEASE_ON_REPORT the first column holds DORMANT defects waiting for
    // the survey report, not QA review — relabel it for the inspection side.
    const releaseMode = releaseDefectsOnReport();

    return OPERATIONS_BOARD_QUEUES.map((queueDefinition) => {
      const queue = queueMap.get(queueDefinition.key);
      const items = queue?.items ?? [];
      const relabel =
        releaseMode && queueDefinition.key === 'awaitingQaQc'
          ? {
              title: 'Awaiting Report / Pending Release',
              description:
                'Dormant defects awaiting LAPORAN SELESAI to release and route to the maintenance company.',
            }
          : null;

      return {
        ...queueDefinition,
        ...(relabel ?? {}),
        count: items.length,
        items: includeItems ? items : [],
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

    // Default unmatched statuses to a VISIBLE queue. Under INSPECTOR_OWNS the
    // QA/QC column is hidden client-side, so falling back to it would make a
    // stray defect disappear from the board.
    return 'maintenanceReady';
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
    maintenanceCategory: MaintenanceCategory | null;
    isEmergency: boolean;
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
      maintenanceCategory: defect.maintenanceCategory,
      isEmergency: defect.isEmergency,
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
      isEmergency: defect.isEmergency,
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

  private async findAssignableUser(
    tenantId: string,
    userId: string,
    restrictToOrganizationId?: string,
  ) {
    const assignedUser = await this.prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
        ...(restrictToOrganizationId
          ? { organizationId: restrictToOrganizationId }
          : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    if (!assignedUser) {
      throw new NotFoundException(
        restrictToOrganizationId
          ? 'You can only assign to a technician in your own company.'
          : 'Assigned user not found.',
      );
    }

    return assignedUser;
  }

  private async findAssignableTeam(
    tenantId: string,
    teamId: string,
    restrictToOrganizationId?: string,
  ) {
    const assignedTeam = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        tenantId,
        isActive: true,
        ...(restrictToOrganizationId
          ? { organizationId: restrictToOrganizationId }
          : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!assignedTeam) {
      throw new NotFoundException(
        restrictToOrganizationId
          ? 'You can only assign to a team in your own company.'
          : 'Assigned team not found.',
      );
    }

    return assignedTeam;
  }

  /**
   * Maintenance self-management org-scope for assignment. ADMIN may assign to any
   * team/user in the tenant (returns undefined = no restriction). A non-admin
   * (MANAGER) may only dispatch within their own company, and may NOT assign a
   * defect that's been routed/delegated to a DIFFERENT company (which they may
   * still see via subcontractor oversight). Returns the org id the assignee must
   * belong to.
   */
  private resolveAssignmentOrgRestriction(
    user: RequestUser,
    defect: { maintenanceOrganizationId: string | null },
  ): string | undefined {
    if (user.role === UserRole.ADMIN) {
      return undefined;
    }

    if (!user.organizationId) {
      throw new ForbiddenException(
        'Your account has no operational company, so it cannot dispatch maintenance work.',
      );
    }

    if (
      defect.maintenanceOrganizationId &&
      defect.maintenanceOrganizationId !== user.organizationId
    ) {
      throw new ForbiddenException(
        'This defect is routed to another company; you can view it but not assign it.',
      );
    }

    return user.organizationId;
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
    // ADMIN gets an empty filter ({}), NOT { siteVisit: {} } — an Inspection
    // could in principle have no site visit, and we must not exclude it.
    if (user.role === 'ADMIN' || ctx?.isAdmin) {
      return {};
    }
    // For every other role the shared matrix returns a non-empty
    // SiteVisitWhereInput, so wrapping it under `siteVisit` reproduces the
    // previous hand-rolled behaviour exactly. Canonical matrix lives in
    // common/authorization/site-visit-scope so it cannot drift from site-visits.
    return { siteVisit: siteVisitAccessWhere(user, ctx) };
  }

  /**
   * Canonical "which defects may this user see" filter. Combines the inspection
   * (team / QA / admin) visibility with the maintenance handoff Phase 4 branch:
   * a maintenance-company user also sees every defect routed to THEIR org
   * (Defect.maintenanceOrganizationId), even when they are not on the inspecting
   * team. Self-limiting — only defects explicitly stamped with their org match
   * (and only RELEASE_ON_REPORT stamps them), so this is a no-op for inspection
   * companies. The org branch is still tenant-scoped via the inspection chain.
   */
  private defectAccessScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.DefectWhereInput {
    // A defect is "live" once its inspection is submitted — EXCEPT an emergency,
    // which is declared + routed instantly (per-pole emergency, Option 1) and must
    // surface before the inspection is submitted. So: inspection submitted OR the
    // defect is an emergency. (Emergency defects only exist on a draft inspection
    // via the explicit declare-emergency action, so this never leaks ordinary
    // mid-draft defects.)
    const liveDefectFilter: Prisma.DefectWhereInput = {
      OR: [
        {
          inspectionItemResult: {
            inspection: {
              completionStatus: InspectionCompletionStatus.SUBMITTED,
            },
          },
        },
        { isEmergency: true },
      ],
    };

    const inspectionScope: Prisma.DefectWhereInput = {
      inspectionItemResult: {
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user, ctx),
        },
      },
      ...liveDefectFilter,
    };

    // ADMIN already sees everything in-tenant through the inspection scope.
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return inspectionScope;
    }

    // The routed-pool org ids (own org; + subcontractor children for a MANAGER's
    // oversight of delegated work) come pre-computed on the scope context. Fall
    // back to the user's own org when called without a context.
    const maintenanceOrgIds =
      ctx?.maintenanceOrgIds ??
      (user.organizationId ? [user.organizationId] : []);
    if (maintenanceOrgIds.length === 0) {
      return inspectionScope;
    }

    return {
      OR: [
        inspectionScope,
        {
          maintenanceOrganizationId: { in: maintenanceOrgIds },
          inspectionItemResult: {
            isDefect: true,
            inspection: { tenantId: user.tenantId },
          },
          ...liveDefectFilter,
        },
      ],
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
