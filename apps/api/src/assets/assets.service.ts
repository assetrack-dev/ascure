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
import { buildScopeContext } from '../common/authorization/scope-context';
import { siteVisitMapWhere } from '../common/authorization/site-visit-scope';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
import { renderNoTiangRondaan, type StoredMembership } from '../common/rondaan';
import { buildInspectionImagePath } from '../common/uploads.constants';
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

  /**
   * Role-scoped, lightweight asset feed for the admin web global map.
   *
   * Only assets with finite GPS coordinates are returned. Visibility mirrors the
   * SiteVisit access matrix (common/authorization/site-visit-scope): an asset is
   * visible if it has an inspection in a site visit the user may see, or it was
   * created during such a visit. ADMIN sees every located asset in the tenant.
   *
   * The Asset row carries no team/region/mainhead column, so scope is applied
   * transitively through `inspections.siteVisit` and `createdDuringVisit`.
   * Distinct from MasterDataService.listAssets (GET /assets), which is tenant-
   * scoped only and feeds the mobile inspection flow + the assets table.
   */
  async listMapAssets(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    // Map scope: a TECHNICIAN additionally sees (read-only) their company's other
    // teams working a MAINHEAD where their own team works, so same-area crews can
    // spot already-inspected poles. No-op for every other role (== oversight).
    const scopeWhere = siteVisitMapWhere(user, ctx);

    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      latitude: { not: null },
      longitude: { not: null },
      // ADMIN / QA-admin: every located asset in the tenant. Everyone else:
      // assets reachable through a site visit they may see.
      ...(ctx.isAdmin
        ? {}
        : {
            OR: [
              { inspections: { some: { siteVisit: scopeWhere } } },
              { createdDuringVisit: scopeWhere },
            ],
          }),
    };

    const assets = await this.prisma.asset.findMany({
      where,
      select: {
        id: true,
        assetCode: true,
        name: true,
        latitude: true,
        longitude: true,
        status: true,
        substation: {
          select: { id: true, code: true, name: true, location: true },
        },
        assetType: {
          select: { id: true, code: true, name: true },
        },
        // team + mainhead aren't columns on the Asset; derive them from the
        // asset's creation visit, falling back used below when there is no
        // submitted inspection to source them from.
        createdDuringVisit: {
          select: {
            team: { select: { id: true, name: true } },
            mainheadRecord: { select: { id: true, name: true } },
          },
        },
        inspections: {
          // Marker colour follows the latest SUBMITTED inspection — same filter
          // as MasterDataService.listAssets so web and mobile stay consistent.
          // Its site visit also supplies the asset's team + mainhead for filters.
          where: {
            completionStatus: InspectionCompletionStatus.SUBMITTED,
          },
          take: 1,
          orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            completionStatus: true,
            submittedAt: true,
            siteVisit: {
              select: {
                team: { select: { id: true, name: true } },
                mainheadRecord: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { assetCode: 'asc' },
    });

    return assets.map(({ inspections, createdDuringVisit, ...asset }) => {
      const latest = inspections[0] ?? null;
      // Prefer the latest submitted inspection's visit ("inspected by"), then
      // the asset's creation visit, for the team/mainhead association.
      const visit = latest?.siteVisit ?? createdDuringVisit ?? null;
      return {
        ...asset,
        latestInspection: latest
          ? {
              status: latest.completionStatus,
              submittedAt: latest.submittedAt?.toISOString() ?? null,
            }
          : null,
        team: visit?.team ? { id: visit.team.id, name: visit.team.name } : null,
        mainhead: visit?.mainheadRecord
          ? { id: visit.mainheadRecord.id, name: visit.mainheadRecord.name }
          : null,
      };
    });
  }

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
              id: image.id,
              inspectionId: image.inspectionId,
              url: image.url,
              path: buildInspectionImagePath(image.inspectionId, image.filename),
              filename: image.filename,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
              latitude: image.latitude,
              longitude: image.longitude,
              timestamp: image.timestamp?.toISOString() ?? null,
              createdAt: image.createdAt.toISOString(),
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
        assetCode: true,
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
      substationId?: string;
      fedFromAssetId?: string | null;
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

    if (dto.substationId !== undefined && dto.substationId !== asset.substationId) {
      const substation = await this.prisma.substation.findFirst({
        where: { id: dto.substationId, tenantId: user.tenantId },
        select: { id: true },
      });

      if (!substation) {
        throw new NotFoundException('Substation (Pencawang) not found.');
      }

      data.substationId = dto.substationId;
      // The old fed-from parent lives in the old substation; clear it so the
      // graph re-sync resolves a parent within the new substation.
      data.fedFromAssetId = null;
    }

    const effectiveSubstationId = data.substationId ?? asset.substationId;
    const effectiveAssetCode = data.assetCode ?? asset.assetCode;

    if (data.assetCode !== undefined || data.substationId !== undefined) {
      const existingAsset = await this.prisma.asset.findFirst({
        where: {
          tenantId: user.tenantId,
          substationId: effectiveSubstationId,
          assetCode: effectiveAssetCode,
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

        if (data.assetCode !== undefined || data.substationId !== undefined) {
          await tx.poleFeederMembership.deleteMany({ where: { assetId: id } });
          await this.syncPoleGraph(tx, {
            tenantId: user.tenantId,
            substationId: effectiveSubstationId,
            assetId: id,
            assetCode: effectiveAssetCode,
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

  async delete(user: RequestUser, id: string) {
    this.assertCanMutate(user);

    const asset = await this.prisma.asset.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    await this.hardDeleteAssets(user.tenantId, [asset.id]);

    return { deleted: 1, deletedIds: [asset.id], notFound: [] as string[] };
  }

  async deleteBulk(user: RequestUser, ids: string[]) {
    this.assertCanMutate(user);

    const uniqueIds = Array.from(
      new Set((ids ?? []).filter((value): value is string => Boolean(value))),
    );

    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one asset id is required.');
    }

    const assets = await this.prisma.asset.findMany({
      where: { id: { in: uniqueIds }, tenantId: user.tenantId },
      select: { id: true },
    });
    const foundIds = assets.map((asset) => asset.id);

    if (foundIds.length === 0) {
      throw new NotFoundException('No matching assets found.');
    }

    await this.hardDeleteAssets(user.tenantId, foundIds);

    return {
      deleted: foundIds.length,
      deletedIds: foundIds,
      notFound: uniqueIds.filter((requestedId) => !foundIds.includes(requestedId)),
    };
  }

  /**
   * ADMIN-only: hard-delete EVERY asset in a Pencawang (substation). Resolves the
   * IDs server-side (so the caller can't pass a stale set) and reuses the same
   * cascade transaction as the per-asset delete. Returns 0 deleted for an empty
   * Pencawang; 404 if the substation isn't in the caller's tenant.
   */
  async deleteBySubstation(user: RequestUser, substationId: string) {
    this.assertAdmin(user);

    const substation = await this.prisma.substation.findFirst({
      where: { id: substationId, tenantId: user.tenantId },
      select: { id: true },
    });

    if (!substation) {
      throw new NotFoundException('Substation not found.');
    }

    const assets = await this.prisma.asset.findMany({
      where: { substationId, tenantId: user.tenantId },
      select: { id: true },
    });
    const ids = assets.map((asset) => asset.id);

    if (ids.length > 0) {
      await this.hardDeleteAssets(user.tenantId, ids);
    }

    return { deleted: ids.length, deletedIds: ids, notFound: [] as string[] };
  }

  /**
   * ADMIN-only: hard-delete every asset associated with an Operational Session —
   * its current roster (OperationalSessionAsset, excluding soft-removed rows) plus
   * any asset inspected under the session. IDs are re-checked against the caller's
   * tenant before deletion. 404 if the session isn't in the caller's tenant.
   */
  async deleteBySession(user: RequestUser, sessionId: string) {
    this.assertAdmin(user);

    const session = await this.prisma.operationalSession.findFirst({
      where: { id: sessionId, workspaceId: user.tenantId },
      select: { id: true },
    });

    if (!session) {
      throw new NotFoundException('Operational session not found.');
    }

    const [roster, inspected] = await Promise.all([
      this.prisma.operationalSessionAsset.findMany({
        where: { operationalSessionId: sessionId, removedAt: null },
        select: { assetId: true },
      }),
      this.prisma.inspection.findMany({
        where: { operationalSessionId: sessionId, tenantId: user.tenantId },
        select: { assetId: true },
      }),
    ]);

    const candidateIds = Array.from(
      new Set([
        ...roster.map((row) => row.assetId),
        ...inspected.map((row) => row.assetId),
      ]),
    );

    if (candidateIds.length === 0) {
      return { deleted: 0, deletedIds: [] as string[], notFound: [] as string[] };
    }

    // Tenant-guard the resolved IDs before deleting.
    const owned = await this.prisma.asset.findMany({
      where: { id: { in: candidateIds }, tenantId: user.tenantId },
      select: { id: true },
    });
    const ids = owned.map((asset) => asset.id);

    if (ids.length > 0) {
      await this.hardDeleteAssets(user.tenantId, ids);
    }

    return { deleted: ids.length, deletedIds: ids, notFound: [] as string[] };
  }

  /**
   * Hard-delete poles and everything hanging off them. The Asset's inspection /
   * site-visit / operational-session links are onDelete Restrict, so they're
   * removed first (each cascades its own children at the DB level: an inspection
   * → its results / item-results / defects / inspection images); deleting the
   * asset then cascades its feeder memberships + NOP tie edges, and SetNulls
   * child fed-from pointers + images. One transaction.
   */
  private async hardDeleteAssets(tenantId: string, ids: string[]) {
    await this.prisma.$transaction([
      this.prisma.inspection.deleteMany({ where: { assetId: { in: ids }, tenantId } }),
      this.prisma.siteVisitAsset.deleteMany({ where: { assetId: { in: ids } } }),
      this.prisma.operationalSessionAsset.deleteMany({ where: { assetId: { in: ids } } }),
      this.prisma.asset.deleteMany({ where: { id: { in: ids }, tenantId } }),
    ]);
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
   * Derive + persist a pole's graph structure from its assetCode (north-star §3
   * "store the structure"): feeders + memberships, then the fed-from edge. Split
   * into two passes so a batch caller can create every membership before
   * resolving any fed-from (a parent must already carry its membership).
   */
  private async syncPoleGraph(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; substationId: string; assetId: string; assetCode: string },
  ): Promise<void> {
    await this.syncPoleMemberships(tx, params);
    await this.syncPoleFedFrom(tx, params);
  }

  /**
   * Batch graph sync for an import: upsert feeders + memberships for every pole
   * first, then resolve fed-from for every pole — so each parent's membership
   * exists before its children look it up. Runs inside the caller's transaction.
   */
  async syncImportedPolesGraph(
    tx: Prisma.TransactionClient,
    tenantId: string,
    substationId: string,
    poles: Array<{ assetId: string; assetCode: string }>,
  ): Promise<void> {
    for (const pole of poles) {
      await this.syncPoleMemberships(tx, {
        tenantId,
        substationId,
        assetId: pole.assetId,
        assetCode: pole.assetCode,
      });
    }
    for (const pole of poles) {
      await this.syncPoleFedFrom(tx, {
        substationId,
        assetId: pole.assetId,
        assetCode: pole.assetCode,
      });
    }
  }

  /** Upsert a Feeder per feeder token + a PoleFeederMembership per segment from
   *  the RONDAAN code. A non-pole / unparseable code yields no memberships.
   *  Idempotent (upsert by assetId+feeder). */
  private async syncPoleMemberships(
    tx: Prisma.TransactionClient,
    params: { tenantId: string; substationId: string; assetId: string; assetCode: string },
  ): Promise<void> {
    const { tenantId, substationId, assetId, assetCode } = params;
    const memberships = parsePoleCode(assetCode).filter((parsed) => parsed.isValid);
    if (memberships.length === 0) {
      return;
    }
    // Feeder-Pillar origin (FP<n>) has no column in the structured membership
    // graph yet, so skip these poles — persisting "FP1 A 1" as a bare A-1 Feeder
    // membership would conflate it with the direct A line and drop the prefix
    // from the rendered NO TIANG RONDAAN. They stay string-only: with no
    // memberships, renderNoTiangRondaan returns null and callers fall back to the
    // assetCode mirror (which holds "FP1 A 1"). Structured FP backfill is a later
    // migration (PoleFeederMembership.feederPillar).
    if (memberships.some((membership) => membership.feederPillar !== undefined)) {
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
      const fedFromAssetId = await this.resolveFeederParentAssetId(
        tx,
        substationId,
        membership,
        assetId,
      );
      await tx.poleFeederMembership.upsert({
        where: { assetId_feederId: { assetId, feederId } },
        create: {
          assetId,
          feederId,
          sequenceIndex: membership.baseNumber,
          branchSuffix,
          fedFromAssetId,
        },
        update: { sequenceIndex: membership.baseNumber, branchSuffix, fedFromAssetId },
      });
    }
  }

  /**
   * The parent pole ON THIS FEEDER for one membership. Tries the exact expected
   * parent (branch parent / previous trunk pole); if that pole doesn't exist yet,
   * falls back to the nearest existing lower-indexed trunk pole on the same feeder
   * — so a branch / next pole still attaches to the feeder line when an
   * intermediate bare trunk pole was skipped (mirrors the backfill fallback).
   */
  private async resolveFeederParentAssetId(
    tx: Prisma.TransactionClient,
    substationId: string,
    m: ReturnType<typeof parsePoleCode>[number],
    selfAssetId: string,
  ): Promise<string | null> {
    const exactKey =
      m.branchParts.length > 0
        ? getExpectedParentKey(m)
        : m.baseNumber > 1
          ? buildNormalizedKey(m.feeder, m.baseNumber - 1)
          : undefined;
    if (exactKey) {
      const id = await this.findAssetIdByMembershipKey(tx, substationId, exactKey);
      if (id && id !== selfAssetId) {
        return id;
      }
    }
    const startBase = m.branchParts.length > 0 ? m.baseNumber : m.baseNumber - 1;
    if (startBase >= 1) {
      const parent = await tx.poleFeederMembership.findFirst({
        where: {
          feeder: { substationId, code: m.feeder },
          branchSuffix: '',
          sequenceIndex: { lte: startBase },
          assetId: { not: selfAssetId },
        },
        orderBy: { sequenceIndex: 'desc' },
        select: { assetId: true },
      });
      if (parent) {
        return parent.assetId;
      }
    }
    return null;
  }

  /** Best-effort pre-fill the fed-from edge from the primary (lowest) segment's
   *  parent — observed-by-proxy; the parent pole must already exist in this
   *  Pencawang with its membership. */
  private async syncPoleFedFrom(
    tx: Prisma.TransactionClient,
    params: { substationId: string; assetId: string; assetCode: string },
  ): Promise<void> {
    const { substationId, assetId, assetCode } = params;
    const memberships = parsePoleCode(assetCode).filter((parsed) => parsed.isValid);
    if (memberships.length === 0) {
      return;
    }
    // Feeder-Pillar poles aren't in the structured graph (see syncPoleMemberships),
    // so there's no membership key to resolve a parent against — skip.
    if (memberships.some((membership) => membership.feederPillar !== undefined)) {
      return;
    }
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

  private assertAdmin(user: RequestUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an administrator can perform this action.');
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
