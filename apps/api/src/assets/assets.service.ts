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
import { renderNoTiangRondaan, type StoredMembership } from '../common/rondaan';
import {
  buildNormalizedKey,
  formatBranchSuffix,
  getExpectedParentKey,
  parsePoleCode,
} from '@ascure/shared-utils';

const ASSET_CODE_SCOPE_CONFLICT_MESSAGE =
  'An asset with this code already exists in this Pencawang.';

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
      const created = await this.prisma.$transaction(async (tx) => {
        const existingAsset = await tx.asset.findFirst({
          where: {
            tenantId: user.tenantId,
            substationId: dto.substationId,
            assetCode,
          },
          select: {
            id: true,
          },
        });

        if (existingAsset) {
          throw new ConflictException(ASSET_CODE_SCOPE_CONFLICT_MESSAGE);
        }

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

        await this.syncPoleGraph(tx, {
          tenantId: user.tenantId,
          substationId: dto.substationId,
          assetId: asset.id,
          assetCode,
        });

        return tx.asset.findUniqueOrThrow({
          where: { id: asset.id },
          include: this.assetInclude(),
        });
      });

      return this.attachRondaan(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ASSET_CODE_SCOPE_CONFLICT_MESSAGE);
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
            capabilityId: true,
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
        feederMemberships: {
          select: {
            sequenceIndex: true,
            branchSuffix: true,
            feeder: { select: { code: true } },
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
            itemResults: {
              orderBy: {
                createdAt: 'asc',
              },
              select: {
                id: true,
                label: true,
                result: true,
                remark: true,
                isDefect: true,
                severity: true,
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
      noTiangRondaan: renderNoTiangRondaan(asset.feederMemberships),
      noTiangLama: asset.noTiangLama,
      name: asset.name,
      assetType: asset.assetType.name,
      assetTypeId: asset.assetType.id,
      assetTypeCode: asset.assetType.code,
      assetTypeName: asset.assetType.name,
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
            createdAt: latestInspection.createdAt.toISOString(),
            remarks: this.extractRemarks(latestInspection.results),
            totalDefects: latestInspection.itemResults.filter((item) => item.isDefect).length,
            items: latestInspection.itemResults.map((item) => ({
              id: item.id,
              label: item.label,
              result: item.result,
              remark: item.remark,
              isDefect: item.isDefect,
              severity: item.severity,
            })),
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

    return this.attachRondaan(
      await this.prisma.asset.update({
        where: {
          id,
        },
        data: {
          status: dto.status,
        },
        include: this.assetInclude(),
      }),
    );
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
        substationId: true,
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

    if (data.assetCode !== undefined) {
      const existingAsset = await this.prisma.asset.findFirst({
        where: {
          tenantId: user.tenantId,
          substationId: asset.substationId,
          assetCode: data.assetCode,
          id: {
            not: asset.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (existingAsset) {
        throw new ConflictException(ASSET_CODE_SCOPE_CONFLICT_MESSAGE);
      }
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
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.asset.update({ where: { id }, data });

        if (data.assetCode !== undefined) {
          await tx.poleFeederMembership.deleteMany({ where: { assetId: id } });
          await this.syncPoleGraph(tx, {
            tenantId: user.tenantId,
            substationId: asset.substationId,
            assetId: id,
            assetCode: data.assetCode,
          });
        }

        return tx.asset.findUniqueOrThrow({
          where: { id },
          include: this.assetInclude(),
        });
      });

      return this.attachRondaan(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ASSET_CODE_SCOPE_CONFLICT_MESSAGE);
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

  private attachRondaan<T extends { feederMemberships: StoredMembership[] }>(asset: T) {
    return { ...asset, noTiangRondaan: renderNoTiangRondaan(asset.feederMemberships) };
  }

  /**
   * Derive + persist the pole's graph structure from its assetCode (the RONDAAN
   * string) — north-star §3 "store the structure". Parses assetCode via the
   * shared grammar, upserts a Feeder per feeder token + a PoleFeederMembership
   * per segment, then best-effort pre-fills the fed-from edge from the primary
   * segment's parent (which must already exist). A non-pole / unparseable code
   * yields no memberships. Idempotent (upsert by assetId+feeder).
   */
  private async syncPoleGraph(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; substationId: string; assetId: string; assetCode: string },
  ): Promise<void> {
    const { tenantId, substationId, assetId, assetCode } = params;
    const memberships = parsePoleCode(assetCode).filter((parsed) => parsed.isValid);
    if (memberships.length === 0) {
      return;
    }

    const feederIdByCode = new Map<string, string>();
    for (const membership of memberships) {
      let feederId = feederIdByCode.get(membership.feeder);
      if (!feederId) {
        const feeder = await tx.feeder.upsert({
          where: { substationId_code: { substationId, code: membership.feeder } },
          create: { tenantId, substationId, code: membership.feeder },
          update: {},
        });
        feederId = feeder.id;
        feederIdByCode.set(membership.feeder, feederId);
      }
      const branchSuffix = formatBranchSuffix(membership.branchParts);
      await tx.poleFeederMembership.upsert({
        where: { assetId_feederId: { assetId, feederId } },
        create: { assetId, feederId, sequenceIndex: membership.baseNumber, branchSuffix },
        update: { sequenceIndex: membership.baseNumber, branchSuffix },
      });
    }

    // Pre-fill fed-from from the primary (lowest) segment's parent. Observed-by-
    // proxy and best-effort: the parent pole must already exist in this Pencawang.
    const primary = [...memberships].sort(
      (a, b) => a.feeder.localeCompare(b.feeder) || a.baseNumber - b.baseNumber,
    )[0];
    const parentKey =
      primary.branchParts.length > 0
        ? getExpectedParentKey(primary)
        : primary.baseNumber > 1
          ? buildNormalizedKey(primary.feeder, primary.baseNumber - 1)
          : undefined;
    if (!parentKey) {
      return;
    }
    const parentAssetId = await this.findAssetIdByMembershipKey(tx, substationId, parentKey);
    if (parentAssetId && parentAssetId !== assetId) {
      await tx.asset.update({ where: { id: assetId }, data: { fedFromAssetId: parentAssetId } });
    }
  }

  /** Resolve an asset by a normalized RONDAAN key (e.g. "A 2", "B 2/1") within a
   *  Pencawang, via its stored membership. */
  private async findAssetIdByMembershipKey(
    tx: Prisma.TransactionClient,
    substationId: string,
    normalizedKey: string,
  ): Promise<string | null> {
    const [parsed] = parsePoleCode(normalizedKey).filter((entry) => entry.isValid);
    if (!parsed) {
      return null;
    }
    const membership = await tx.poleFeederMembership.findFirst({
      where: {
        sequenceIndex: parsed.baseNumber,
        branchSuffix: formatBranchSuffix(parsed.branchParts),
        feeder: { substationId, code: parsed.feeder },
      },
      select: { assetId: true },
    });
    return membership?.assetId ?? null;
  }

  private assetInclude() {
    return {
      assetType: {
        select: {
          id: true,
          code: true,
          name: true,
          capabilityId: true,
        },
      },
      substation: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      feederMemberships: {
        select: {
          sequenceIndex: true,
          branchSuffix: true,
          feeder: { select: { code: true } },
        },
      },
    } satisfies Prisma.AssetInclude;
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
