import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveTemplate(user: RequestUser, assetTypeId: string) {
    const template = await this.prisma.inspectionTemplate.findFirst({
      where: {
        tenantId: user.tenantId,
        assetTypeId,
        isActive: true,
        status: 'ACTIVE',
      },
      include: {
        assetType: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        sections: {
          include: {
            items: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Active inspection template not found for the selected asset type.');
    }

    return template;
  }
}

