import { Injectable } from '@nestjs/common';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  listSubstations(user: RequestUser) {
    return this.prisma.substation.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  listAssetTypes(user: RequestUser) {
    return this.prisma.assetType.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async listAssets(user: RequestUser, substationId?: string) {
    const assets = await this.prisma.asset.findMany({
      where: {
        tenantId: user.tenantId,
        ...(substationId ? { substationId } : {}),
      },
      include: {
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
        inspections: {
          take: 1,
          orderBy: [
            {
              submittedAt: 'desc',
            },
            {
              createdAt: 'desc',
            },
          ],
          select: {
            id: true,
            inspectionCycle: true,
            completionStatus: true,
            submittedAt: true,
            createdAt: true,
            updatedAt: true,
            inspectionImages: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
      },
      orderBy: {
        assetCode: 'asc',
      },
    });

    return assets.map(({ inspections, ...asset }) => ({
      ...asset,
      latestInspection: inspections[0]
        ? {
            id: inspections[0].id,
            cycleNumber: inspections[0].inspectionCycle,
            status: inspections[0].completionStatus,
            submittedAt: inspections[0].submittedAt?.toISOString() ?? null,
            createdAt: inspections[0].createdAt.toISOString(),
            updatedAt: inspections[0].updatedAt.toISOString(),
          }
        : null,
      latestInspectionImages: inspections[0]?.inspectionImages ?? [],
    }));
  }
}
