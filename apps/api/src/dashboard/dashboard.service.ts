import { Injectable } from '@nestjs/common';
import { DefectSeverity, DefectStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

const ACTIVE_SLA_STATUSES = [
  DefectStatus.OPEN,
  DefectStatus.IN_PROGRESS,
  DefectStatus.MONITORING,
] as const;

type DefectSlaState = 'OVERDUE' | 'ON_TRACK' | 'NO_DUE_DATE' | 'STOPPED';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: RequestUser) {
    await this.ensureDefectsForAccessibleItems(user);

    const defectWhere = this.accessibleDefectWhere(user);
    const now = new Date();
    const overdueDefectWhere: Prisma.DefectWhereInput = {
      ...defectWhere,
      status: {
        in: [...ACTIVE_SLA_STATUSES],
      },
      dueDate: {
        lt: now,
      },
    };
    const criticalOverdueDefectWhere: Prisma.DefectWhereInput = {
      ...overdueDefectWhere,
      severity: DefectSeverity.CRITICAL,
    };

    const [
      totalAssets,
      totalInspections,
      defectStatusCounts,
      defectSeverityCounts,
      recentDefectItems,
      overdueDefectCount,
      criticalOverdueDefectCount,
      defectAssigneeCounts,
      defectTeamCounts,
      defectsForSlaState,
      criticalOverdueItems,
    ] = await Promise.all([
      this.prisma.asset.count({
        where: this.accessibleAssetWhere(user),
      }),
      this.prisma.inspection.count({
        where: this.accessibleInspectionWhere(user),
      }),
      this.prisma.defect.groupBy({
        by: ['status'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.groupBy({
        by: ['severity'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.inspectionItemResult.findMany({
        where: {
          isDefect: true,
          defect: {
            isNot: null,
          },
          inspection: this.accessibleInspectionWhere(user),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        select: {
          label: true,
          createdAt: true,
          defect: {
            select: {
              id: true,
              status: true,
              severity: true,
              dueDate: true,
              assignedUser: {
                select: {
                  name: true,
                  email: true,
                },
              },
              assignedTeam: {
                select: {
                  name: true,
                  code: true,
                },
              },
            },
          },
          inspection: {
            select: {
              asset: {
                select: {
                  assetCode: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.defect.count({
        where: overdueDefectWhere,
      }),
      this.prisma.defect.count({
        where: criticalOverdueDefectWhere,
      }),
      this.prisma.defect.groupBy({
        by: ['assignedUserId'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.groupBy({
        by: ['assignedTeamId'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.findMany({
        where: defectWhere,
        select: {
          status: true,
          dueDate: true,
        },
      }),
      this.prisma.defect.findMany({
        where: criticalOverdueDefectWhere,
        orderBy: [
          {
            dueDate: 'asc',
          },
          {
            createdAt: 'asc',
          },
        ],
        take: 5,
        select: {
          id: true,
          status: true,
          severity: true,
          dueDate: true,
          assignedUser: {
            select: {
              name: true,
              email: true,
            },
          },
          assignedTeam: {
            select: {
              name: true,
              code: true,
            },
          },
          inspectionItemResult: {
            select: {
              label: true,
              inspection: {
                select: {
                  asset: {
                    select: {
                      assetCode: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const [assignedUsers, assignedTeams] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          id: {
            in: defectAssigneeCounts
              .map((entry) => entry.assignedUserId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      }),
      this.prisma.team.findMany({
        where: {
          tenantId: user.tenantId,
          id: {
            in: defectTeamCounts
              .map((entry) => entry.assignedTeamId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
    ]);

    const countsByStatus = new Map(
      defectStatusCounts.map((entry) => [entry.status, entry._count._all]),
    );
    const openDefects = countsByStatus.get(DefectStatus.OPEN) ?? 0;
    const inProgressDefects = countsByStatus.get(DefectStatus.IN_PROGRESS) ?? 0;
    const monitoringDefects = countsByStatus.get(DefectStatus.MONITORING) ?? 0;
    const resolvedDefects = countsByStatus.get(DefectStatus.RESOLVED) ?? 0;
    const closedDefects = countsByStatus.get(DefectStatus.CLOSED) ?? 0;
    const totalDefects = defectStatusCounts.reduce(
      (total, entry) => total + entry._count._all,
      0,
    );
    const countsBySeverity = new Map(
      defectSeverityCounts.map((entry) => [entry.severity, entry._count._all]),
    );
    const defectsBySeverity = [
      DefectSeverity.CRITICAL,
      DefectSeverity.HIGH,
      DefectSeverity.MEDIUM,
      DefectSeverity.LOW,
    ].map((severity) => ({
      label: severity,
      value: countsBySeverity.get(severity) ?? 0,
    }));
    const usersById = new Map(
      assignedUsers.map((assignedUser) => [
        assignedUser.id,
        assignedUser.name || assignedUser.email,
      ]),
    );
    const teamsById = new Map(
      assignedTeams.map((assignedTeam) => [
        assignedTeam.id,
        assignedTeam.name || assignedTeam.code,
      ]),
    );
    const defectsByAssignee = defectAssigneeCounts
      .map((entry) => ({
        label: entry.assignedUserId
          ? usersById.get(entry.assignedUserId) ?? 'Unknown user'
          : 'Unassigned',
        value: entry._count._all,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    const defectsByTeam = defectTeamCounts
      .map((entry) => ({
        label: entry.assignedTeamId
          ? teamsById.get(entry.assignedTeamId) ?? 'Unknown team'
          : 'Unassigned',
        value: entry._count._all,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    const slaCounts = defectsForSlaState.reduce(
      (counts, defect) => {
        const slaState = this.calculateSlaState(defect.status, defect.dueDate, now);

        counts.set(slaState, (counts.get(slaState) ?? 0) + 1);

        return counts;
      },
      new Map<DefectSlaState, number>(),
    );
    const defectsBySlaState = (
      ['OVERDUE', 'ON_TRACK', 'NO_DUE_DATE', 'STOPPED'] as DefectSlaState[]
    ).map((slaState) => ({
      label: this.formatSlaState(slaState),
      value: slaCounts.get(slaState) ?? 0,
    }));

    return {
      totalAssets,
      totalInspections,
      totalDefects,
      openDefects,
      inProgressDefects,
      monitoringDefects,
      resolvedDefects,
      closedDefects,
      criticalDefects: countsBySeverity.get(DefectSeverity.CRITICAL) ?? 0,
      overdueDefects: overdueDefectCount,
      criticalOverdueDefects: criticalOverdueDefectCount,
      defectsBySeverity,
      defectsByAssignee,
      defectsByTeam,
      defectsBySlaState,
      criticalOverdueAlerts: criticalOverdueItems.map((defect) => ({
        id: defect.id,
        assetCode: defect.inspectionItemResult.inspection.asset.assetCode,
        label: defect.inspectionItemResult.label,
        status: defect.status,
        severity: defect.severity,
        dueDate: defect.dueDate?.toISOString() ?? null,
        assignedTo: this.formatAssignmentLabel(
          defect.assignedUser,
          defect.assignedTeam,
        ),
      })),
      recentDefects: recentDefectItems.flatMap((item) => {
        if (!item.defect) {
          return [];
        }

        const slaState = this.calculateSlaState(
          item.defect.status,
          item.defect.dueDate,
          now,
        );

        return {
          id: item.defect.id,
          assetCode: item.inspection.asset.assetCode,
          label: item.label,
          status: item.defect.status,
          severity: item.defect.severity,
          dueDate: item.defect.dueDate?.toISOString() ?? null,
          isOverdue: slaState === 'OVERDUE',
          slaState,
          assignedTo: this.formatAssignmentLabel(
            item.defect.assignedUser,
            item.defect.assignedTeam,
          ),
          createdAt: item.createdAt.toISOString(),
        };
      }),
    };
  }

  private async ensureDefectsForAccessibleItems(user: RequestUser) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        defect: {
          is: null,
        },
        inspection: this.accessibleInspectionWhere(user),
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

    if (ACTIVE_SLA_STATUSES.includes(status as (typeof ACTIVE_SLA_STATUSES)[number]) && dueDate.getTime() < now.getTime()) {
      return 'OVERDUE';
    }

    return 'ON_TRACK';
  }

  private formatSlaState(slaState: DefectSlaState) {
    return slaState
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
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

  private accessibleAssetWhere(user: RequestUser): Prisma.AssetWhereInput {
    return {
      tenantId: user.tenantId,
    };
  }

  private accessibleDefectWhere(user: RequestUser): Prisma.DefectWhereInput {
    return {
      inspectionItemResult: {
        isDefect: true,
        inspection: this.accessibleInspectionWhere(user),
      },
    };
  }

  private accessibleInspectionWhere(user: RequestUser): Prisma.InspectionWhereInput {
    return {
      tenantId: user.tenantId,
      ...this.inspectionAccessScope(user),
    };
  }

  private inspectionAccessScope(user: RequestUser): Prisma.InspectionWhereInput {
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
}
