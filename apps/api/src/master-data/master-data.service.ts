import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAssetTypeDto,
  ListAssetTypesQueryDto,
  UpdateAssetTypeDto,
  UpdateAssetTypeStatusDto,
} from './dto/manage-asset-type.dto';

const assetTypeInclude = {
  capability: {
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isActive: true,
    },
  },
  _count: {
    select: {
      assets: true,
      inspectionTemplates: true,
    },
  },
} satisfies Prisma.AssetTypeInclude;

type AssetTypeRecord = Prisma.AssetTypeGetPayload<{
  include: typeof assetTypeInclude;
}>;

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

  async listAssetTypes(user: RequestUser, query: ListAssetTypesQueryDto = {}) {
    const includeInactive = query.includeInactive === 'true';
    const assetTypes = await this.prisma.assetType.findMany({
      where: {
        tenantId: user.tenantId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: assetTypeInclude,
      orderBy: [{ name: 'asc' }],
    });

    return assetTypes
      .sort((left, right) => {
        const sortOrderComparison =
          (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.sortOrder ?? Number.MAX_SAFE_INTEGER);

        if (sortOrderComparison !== 0) {
          return sortOrderComparison;
        }

        return left.name.localeCompare(right.name);
      })
      .map((assetType) => this.serializeAssetType(assetType));
  }

  listTeams(user: RequestUser) {
    return this.prisma.team.findMany({
      where: {
        tenantId: user.tenantId,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        tenantId: true,
        departmentId: true,
        code: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
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

  async getAssetType(user: RequestUser, id: string) {
    const assetType = await this.findAssetTypeOrThrow(user.tenantId, id);

    return this.serializeAssetType(assetType);
  }

  async createAssetType(user: RequestUser, dto: CreateAssetTypeDto) {
    const capabilityId = await this.normalizeCapabilityId(dto.capabilityId);

    try {
      const assetType = await this.prisma.assetType.create({
        data: {
          tenantId: user.tenantId,
          name: this.normalizeRequiredText(dto.name, 'Asset type name'),
          code: this.normalizeCode(dto.code),
          capabilityId,
          description: this.normalizeOptionalText(dto.description),
          isActive: dto.isActive ?? true,
          sortOrder: dto.sortOrder ?? null,
        },
        include: assetTypeInclude,
      });

      return this.serializeAssetType(assetType);
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'An asset type with this code already exists for the tenant.',
      );
      throw error;
    }
  }

  async updateAssetType(user: RequestUser, id: string, dto: UpdateAssetTypeDto) {
    await this.findAssetTypeOrThrow(user.tenantId, id);

    const data: Prisma.AssetTypeUncheckedUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = this.normalizeRequiredText(dto.name, 'Asset type name');
    }

    if (dto.code !== undefined) {
      data.code = this.normalizeCode(dto.code);
    }

    if (dto.capabilityId !== undefined) {
      data.capabilityId = await this.normalizeCapabilityId(dto.capabilityId);
    }

    if (dto.description !== undefined) {
      data.description = this.normalizeOptionalText(dto.description);
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one asset type field must be provided.');
    }

    try {
      const assetType = await this.prisma.assetType.update({
        where: {
          id,
        },
        data,
        include: assetTypeInclude,
      });

      return this.serializeAssetType(assetType);
    } catch (error) {
      this.rethrowKnownPrismaError(
        error,
        'An asset type with this code already exists for the tenant.',
      );
      throw error;
    }
  }

  async updateAssetTypeStatus(
    user: RequestUser,
    id: string,
    dto: UpdateAssetTypeStatusDto,
  ) {
    await this.findAssetTypeOrThrow(user.tenantId, id);

    const assetType = await this.prisma.assetType.update({
      where: {
        id,
      },
      data: {
        isActive: dto.isActive,
      },
      include: assetTypeInclude,
    });

    return this.serializeAssetType(assetType);
  }

  private async findAssetTypeOrThrow(tenantId: string, id: string) {
    const assetType = await this.prisma.assetType.findFirst({
      where: {
        id,
        tenantId,
      },
      include: assetTypeInclude,
    });

    if (!assetType) {
      throw new NotFoundException('Asset type not found.');
    }

    return assetType;
  }

  private serializeAssetType(assetType: AssetTypeRecord) {
    return {
      id: assetType.id,
      tenantId: assetType.tenantId,
      name: assetType.name,
      code: assetType.code,
      capabilityId: assetType.capabilityId,
      capability: assetType.capability,
      description: assetType.description,
      isActive: assetType.isActive,
      sortOrder: assetType.sortOrder,
      assetCount: assetType._count.assets,
      templateCount: assetType._count.inspectionTemplates,
      createdAt: assetType.createdAt,
      updatedAt: assetType.updatedAt,
    };
  }

  private async normalizeCapabilityId(capabilityId: string | null | undefined) {
    if (!capabilityId) {
      return null;
    }

    const capability = await this.prisma.capability.findFirst({
      where: {
        id: capabilityId,
      },
      select: {
        id: true,
      },
    });

    if (!capability) {
      throw new NotFoundException('Capability not found.');
    }

    return capability.id;
  }

  private normalizeRequiredText(value: string, fieldName: string) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} cannot be empty.`);
    }

    return normalizedValue;
  }

  private normalizeCode(value: string) {
    return this.normalizeRequiredText(value, 'Asset type code')
      .toUpperCase()
      .replace(/\s+/g, '_');
  }

  private normalizeOptionalText(value?: string | null) {
    if (!value) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue ? normalizedValue : null;
  }

  private rethrowKnownPrismaError(error: unknown, message: string): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException(message);
    }
  }
}
