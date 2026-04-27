import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AssetStatus, Prisma } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: RequestUser, dto: CreateAssetDto) {
    const substation = await this.prisma.substation.findFirst({
      where: {
        id: dto.substationId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!substation) {
      throw new NotFoundException('Substation not found.');
    }

    const assetType = await this.prisma.assetType.findFirst({
      where: {
        id: dto.assetTypeId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!assetType) {
      throw new NotFoundException('Asset type not found.');
    }

    if (dto.createdDuringVisitId) {
      const siteVisit = await this.prisma.siteVisit.findFirst({
        where: {
          id: dto.createdDuringVisitId,
          tenantId: user.tenantId,
          substationId: dto.substationId,
          status: 'ACTIVE',
          ...this.siteVisitAccessScope(user),
        },
        select: {
          id: true,
        },
      });

      if (!siteVisit) {
        throw new NotFoundException('Active site visit not found for asset creation.');
      }
    }

    try {
      return await this.prisma.asset.create({
        data: {
          tenantId: user.tenantId,
          substationId: dto.substationId,
          assetTypeId: dto.assetTypeId,
          assetCode: dto.assetCode,
          name: this.normalizeOptionalString(dto.name),
          latitude: dto.latitude,
          longitude: dto.longitude,
          metadata:
            dto.metadata === undefined
              ? undefined
              : (dto.metadata as Prisma.InputJsonValue),
          status: dto.status ?? AssetStatus.ACTIVE,
          createdDuringVisitId: dto.createdDuringVisitId,
        },
        include: this.assetInclude(),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An asset with this asset code already exists.');
      }

      throw error;
    }
  }

  async updateStatus(
    user: RequestUser,
    id: string,
    dto: UpdateAssetStatusDto,
  ) {
    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return this.prisma.asset.update({
      where: {
        id,
      },
      data: {
        status: dto.status,
      },
      include: this.assetInclude(),
    });
  }

  async update(user: RequestUser, id: string, dto: UpdateAssetDto) {
    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
      },
      select: {
        id: true,
        assetTypeId: true,
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    if (dto.assetTypeId && dto.assetTypeId !== asset.assetTypeId) {
      const assetType = await this.prisma.assetType.findFirst({
        where: {
          id: dto.assetTypeId,
          tenantId: user.tenantId,
          isActive: true,
        },
        select: {
          id: true,
        },
      });

      if (!assetType) {
        throw new NotFoundException('Asset type not found.');
      }
    }

    const data: {
      assetTypeId?: string;
      assetCode?: string;
      name?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      metadata?:
        | Prisma.InputJsonValue
        | typeof Prisma.DbNull;
    } = {};

    if (dto.assetTypeId !== undefined) {
      data.assetTypeId = dto.assetTypeId;
    }

    if (dto.assetCode !== undefined) {
      data.assetCode = dto.assetCode;
    }

    if (dto.name !== undefined) {
      data.name = this.normalizeOptionalString(dto.name);
    }

    if (dto.latitude !== undefined) {
      data.latitude = dto.latitude;
    }

    if (dto.longitude !== undefined) {
      data.longitude = dto.longitude;
    }

    if (dto.metadata !== undefined) {
      data.metadata =
        dto.metadata === null
          ? Prisma.DbNull
          : (dto.metadata as Prisma.InputJsonValue);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one editable asset field must be provided.');
    }

    try {
      return await this.prisma.asset.update({
        where: {
          id,
        },
        data,
        include: this.assetInclude(),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An asset with this asset code already exists.');
      }

      throw error;
    }
  }

  private siteVisitAccessScope(user: RequestUser) {
    if (user.role === 'ADMIN') {
      return {};
    }

    return {
      team: {
        members: {
          some: {
            userId: user.id,
            isActive: true,
          },
        },
      },
    };
  }

  private assetInclude(): Prisma.AssetInclude {
    return {
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
    };
  }

  private normalizeOptionalString(value?: string) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }
}
