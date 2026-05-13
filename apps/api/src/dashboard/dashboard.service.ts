import { Injectable } from '@nestjs/common';
import { DefectSeverity, DefectStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: RequestUser) {
    await this.ensureDefectsForAccessibleItems(user);

    const defectWhere = this.accessibleDefectWhere(user);

    const [totalAssets, totalInspections, defectStatusCounts, defectSeverityCounts, recentDefectItems] =
      await Promise.all([
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
      defectsBySeverity,
      recentDefects: recentDefectItems.flatMap((item) => {
        if (!item.defect) {
          return [];
        }

        return {
          id: item.defect.id,
          assetCode: item.inspection.asset.assetCode,
          label: item.label,
          status: item.defect.status,
          severity: item.defect.severity,
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
