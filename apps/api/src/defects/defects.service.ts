import { Injectable } from '@nestjs/common';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DefectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: RequestUser) {
    const defects = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        inspection: {
          tenantId: user.tenantId,
          ...this.inspectionAccessScope(user),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
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
    });

    return defects
      .sort((left, right) => {
        const leftSubmittedAt = left.inspection.submittedAt?.getTime() ?? 0;
        const rightSubmittedAt = right.inspection.submittedAt?.getTime() ?? 0;

        if (leftSubmittedAt !== rightSubmittedAt) {
          return rightSubmittedAt - leftSubmittedAt;
        }

        return right.createdAt.getTime() - left.createdAt.getTime();
      })
      .map((defect) => ({
        id: defect.id,
        inspectionId: defect.inspectionId,
        assetId: defect.inspection.assetId,
        assetCode: defect.inspection.asset.assetCode,
        assetType: defect.inspection.asset.assetType.name || defect.inspection.asset.assetType.code,
        cycleNumber: defect.inspection.inspectionCycle,
        label: defect.label,
        result: 'FAIL' as const,
        remark: defect.remark,
        status: 'OPEN' as const,
        submittedAt: defect.inspection.submittedAt?.toISOString() ?? null,
        createdAt: defect.createdAt.toISOString(),
      }));
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
}
