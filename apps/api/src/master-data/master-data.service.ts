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

  listAssets(user: RequestUser, substationId: string) {
    return this.prisma.asset.findMany({
      where: {
        tenantId: user.tenantId,
        substationId,
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
          },
        },
      },
      orderBy: {
        assetCode: 'asc',
      },
    });
  }
}
