import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetStatus,
  InspectionCompletionStatus,
  Prisma,
  SiteVisitStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { normalizeOperationalText } from '../common/operational-text';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: RequestUser, dto: CreateAssetDto) {
    this.assertCanMutate(user);

    const assetCode = this.normalizeOperationalString(dto.assetCode);

    if (!assetCode) {
      throw new BadRequestException('Asset code is required.');
    }

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

    let linkedSiteVisit: { id: string } | null = null;

    if (dto.createdDuringVisitId) {
      const siteVisit = await this.prisma.siteVisit.findFirst({
        where: {
          id: dto.createdDuringVisitId,
          tenantId: user.tenantId,
          substationId: dto.substationId,
          status: {
            in: this.activeSiteVisitStatuses(),
          },
          ...this.siteVisitAccessScope(user),
        },
        select: {
          id: true,
        },
      });

      if (!siteVisit) {
        throw new NotFoundException('Active site visit not found for asset creation.');
      }

      linkedSiteVisit = siteVisit;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const asset = await tx.asset.create({
          data: {
            tenantId: user.tenantId,
            substationId: dto.substationId,
            assetTypeId: dto.assetTypeId,
            assetCode,
            name: this.normalizeOperationalString(dto.name),
            latitude: dto.latitude,
            longitude: dto.longitude,
            metadata:
              dto.metadata === undefined
                ? undefined
                : (dto.metadata as Prisma.InputJsonValue),
            status: dto.status ?? AssetStatus.ACTIVE,
            createdDuringVisitId: dto.createdDuringVisitId,
            createdByUserId: user.id,
          },
          include: this.assetInclude(),
        });

        if (linkedSiteVisit) {
          await tx.siteVisitAsset.upsert({
            where: {
              siteVisitId_assetId: {
                siteVisitId: linkedSiteVisit.id,
                assetId: asset.id,
              },
            },
            create: {
              siteVisitId: linkedSiteVisit.id,
              assetId: asset.id,
              addedByUserId: user.id,
              source: 'CREATED_DURING_VISIT',
            },
            update: {},
          });
        }

        return asset;
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

  async getById(user: RequestUser, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
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
          where: {
            completionStatus: InspectionCompletionStatus.SUBMITTED,
          },
          take: 1,
          orderBy: [
            {
              submittedAt: 'desc',
            },
            {
              createdAt: 'desc',
            },
          ],
          include: {
            inspectionImages: {
              orderBy: {
                createdAt: 'asc',
              },
              select: {
                url: true,
              },
            },
            results: {
              select: {
                valueText: true,
                templateItem: {
                  select: {
                    key: true,
                    label: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    const latestInspection = asset.inspections[0];

    return {
      id: asset.id,
      assetCode: asset.assetCode,
      name: asset.name,
      assetType: asset.assetType.name,
      status: asset.status,
      latitude: asset.latitude,
      longitude: asset.longitude,
      metadata: asset.metadata,
      location: asset.substation.location,
      pencawangName: asset.substation.name,
      substation: asset.substation,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      latestInspection: latestInspection
        ? {
            id: latestInspection.id,
            cycleNumber: latestInspection.inspectionCycle,
            status: latestInspection.completionStatus,
            submittedAt: latestInspection.submittedAt?.toISOString() ?? '',
            remarks: this.extractRemarks(latestInspection.results),
            images: latestInspection.inspectionImages.map((image) => ({
              url: image.url,
            })),
          }
        : null,
    };
  }

  async getInspections(user: RequestUser, id: string) {
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

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        assetId: id,
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        ...this.inspectionAccessScope(user),
      },
      orderBy: [
        {
          submittedAt: 'desc',
        },
        {
          createdAt: 'desc',
        },
      ],
      include: {
        inspectionImages: {
          orderBy: {
            createdAt: 'asc',
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
        results: {
          select: {
            valueText: true,
            templateItem: {
              select: {
                key: true,
                label: true,
              },
            },
          },
        },
      },
    });

    return inspections.map((inspection) => ({
      id: inspection.id,
      assetId: inspection.assetId,
      cycleNumber: inspection.inspectionCycle,
      status: inspection.completionStatus,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
      remarks: this.extractRemarks(inspection.results) || null,
      imageCount: inspection.inspectionImages.length,
      images: inspection.inspectionImages.map((image) => ({
        id: image.id,
        inspectionId: image.inspectionId,
        url: image.url,
        filename: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      })),
    }));
  }

  async updateStatus(
    user: RequestUser,
    id: string,
    dto: UpdateAssetStatusDto,
  ) {
    this.assertCanMutate(user);

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
    this.assertCanMutate(user);

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
      const assetCode = this.normalizeOperationalString(dto.assetCode);

      if (!assetCode) {
        throw new BadRequestException('Asset code is required.');
      }

      data.assetCode = assetCode;
    }

    if (dto.name !== undefined) {
      data.name = this.normalizeOperationalString(dto.name);
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

  private extractRemarks(
    results: Array<{
      valueText: string | null;
      templateItem: {
        key: string;
        label: string;
      };
    }>,
  ) {
    const remarkResult = results.find((result) => {
      const key = result.templateItem.key.toLowerCase();
      const label = result.templateItem.label.toLowerCase();

      return (
        key.includes('remark') ||
        label.includes('remark') ||
        key.includes('catatan') ||
        label.includes('catatan')
      );
    });

    return remarkResult?.valueText?.trim() ?? '';
  }

  private assertCanMutate(user: RequestUser) {
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for asset actions.');
    }
  }

  private activeSiteVisitStatuses() {
    return [
      SiteVisitStatus.ACTIVE,
      SiteVisitStatus.OPEN,
      SiteVisitStatus.IN_PROGRESS,
    ];
  }

  private normalizeOptionalString(value?: string) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private normalizeOperationalString(value?: string) {
    const normalizedValue = this.normalizeOptionalString(value);

    return normalizedValue ? normalizeOperationalText(normalizedValue) : null;
  }
}
