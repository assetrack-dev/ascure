import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InspectionCompletionStatus, Prisma, UserRole } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import {
  assetAccessWhere,
  siteVisitAccessWhere,
} from '../common/authorization/site-visit-scope';
import { buildScopeContext } from '../common/authorization/scope-context';
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

const substationCountInclude = {
  _count: {
    select: {
      assets: true,
      siteVisits: true,
      feeders: true,
      fromRouteSiteVisits: true,
      toRouteSiteVisits: true,
    },
  },
} satisfies Prisma.SubstationInclude;

type SubstationRecord = Prisma.SubstationGetPayload<{
  include: typeof substationCountInclude;
}>;

@Injectable()
export class MasterDataService {
  constructor(private readonly prisma: PrismaService) {}

  async listSubstations(
    user: RequestUser,
    options: { includeInactive?: boolean } = {},
  ) {
    const substations = await this.prisma.substation.findMany({
      where: {
        tenantId: user.tenantId,
        // Mobile/check-in pickers pass nothing → active only (unchanged). The
        // admin Pencawang page passes includeInactive to also list deactivated
        // ones so they can be reactivated.
        ...(options.includeInactive ? {} : { isActive: true }),
      },
      include: substationCountInclude,
      orderBy: {
        name: 'asc',
      },
    });

    return substations.map((substation) => this.serializeSubstation(substation));
  }

  async updateSubstationStatus(user: RequestUser, id: string, isActive: boolean) {
    await this.findSubstationOrThrow(user.tenantId, id);

    const substation = await this.prisma.substation.update({
      where: { id },
      data: { isActive },
      include: substationCountInclude,
    });

    return this.serializeSubstation(substation);
  }

  async deleteSubstation(user: RequestUser, id: string) {
    const substation = await this.findSubstationOrThrow(user.tenantId, id);
    // Hard delete is only safe for an empty Pencawang — anything still pointing
    // at it (poles, site visits, feeders, or a route's From/To link) must be
    // cleared first. Otherwise the user deactivates it instead.
    const references =
      substation._count.assets +
      substation._count.siteVisits +
      substation._count.feeders +
      substation._count.fromRouteSiteVisits +
      substation._count.toRouteSiteVisits;

    if (references > 0) {
      throw new ConflictException(
        'This Pencawang still has poles, site visits, or feeders linked to it. Deactivate it instead, or remove those first.',
      );
    }

    await this.prisma.substation.delete({ where: { id } });

    return { id, deleted: true };
  }

  /**
   * Preview a full Pencawang cascade-delete: how many site visits, poles, and
   * feeders go. `blocked` is a human reason the delete can't proceed (another
   * company's surveys, a route endpoint, or shared SAVT poles) — null when clear.
   */
  async previewDeletePencawang(user: RequestUser, id: string) {
    const substation = await this.findSubstationOrThrow(user.tenantId, id);
    const blocked = await this.resolvePencawangDeleteBlock(user, id);
    return {
      pencawangId: substation.id,
      pencawang: substation.name?.trim() || substation.code,
      siteVisits: substation._count.siteVisits,
      routeReferences:
        substation._count.fromRouteSiteVisits + substation._count.toRouteSiteVisits,
      assets: substation._count.assets,
      feeders: substation._count.feeders,
      blocked,
    };
  }

  /**
   * Hard-delete a whole Pencawang and everything under it — its direct site
   * visits (+ inspections/results/defects/images/lifecycle/reports), its poles
   * (+ feeder memberships / NOP tie edges), and its feeders. One transaction =
   * all-or-nothing. ADMIN unrestricted; a MANAGER only for a Pencawang wholly
   * owned by their own company (see resolvePencawangDeleteBlock). Empty Pencawang
   * is fine (it just deletes the record + logs).
   */
  async deletePencawangCascade(user: RequestUser, id: string) {
    this.assertCanDeletePencawang(user);
    const substation = await this.findSubstationOrThrow(user.tenantId, id);

    const blocked = await this.resolvePencawangDeleteBlock(user, id);
    if (blocked) {
      throw new ConflictException(blocked);
    }

    const tenantId = user.tenantId;
    const [visits, assets, feeders] = await Promise.all([
      this.prisma.siteVisit.findMany({
        where: { tenantId, substationId: id },
        select: { id: true },
      }),
      this.prisma.asset.findMany({
        where: { tenantId, substationId: id },
        select: { id: true },
      }),
      this.prisma.feeder.findMany({
        where: { tenantId, substationId: id },
        select: { id: true },
      }),
    ]);
    const visitIds = visits.map((visit) => visit.id);
    const assetIds = assets.map((asset) => asset.id);

    await this.prisma.$transaction(async (tx) => {
      // 1. Inspections of these visits AND of these poles (Restrict on both).
      const inspectionOr: Prisma.InspectionWhereInput[] = [];
      if (visitIds.length) inspectionOr.push({ siteVisitId: { in: visitIds } });
      if (assetIds.length) inspectionOr.push({ assetId: { in: assetIds } });
      if (inspectionOr.length) {
        await tx.inspection.deleteMany({ where: { tenantId, OR: inspectionOr } });
      }

      // 2. Asset<->visit / asset<->session links (Restrict on asset).
      const linkOr: Prisma.SiteVisitAssetWhereInput[] = [];
      if (visitIds.length) linkOr.push({ siteVisitId: { in: visitIds } });
      if (assetIds.length) linkOr.push({ assetId: { in: assetIds } });
      if (linkOr.length) {
        await tx.siteVisitAsset.deleteMany({ where: { OR: linkOr } });
      }
      if (assetIds.length) {
        await tx.operationalSessionAsset.deleteMany({
          where: { assetId: { in: assetIds } },
        });
      }

      // 3. Poles (cascade: feeder memberships, NOP tie edges; images SetNull).
      if (assetIds.length) {
        await tx.asset.deleteMany({ where: { tenantId, id: { in: assetIds } } });
      }

      // 4. Feeders (cascade any remaining memberships).
      await tx.feeder.deleteMany({ where: { tenantId, substationId: id } });

      // 5. The visits themselves (cascade their remaining children).
      if (visitIds.length) {
        await tx.siteVisit.deleteMany({ where: { tenantId, id: { in: visitIds } } });
      }

      // 6. Finally the (now-empty) Pencawang.
      await tx.substation.delete({ where: { id } });

      // 7. Audit the irreversible delete (atomic with it).
      await tx.deletionLog.create({
        data: {
          tenantId,
          actorUserId: user.id,
          actorEmail: user.email,
          actorName: user.name,
          entityType: 'PENCAWANG',
          entityId: id,
          label: substation.name?.trim() || substation.code,
          summary: {
            deletedSiteVisits: visitIds.length,
            deletedAssets: assetIds.length,
            deletedFeeders: feeders.length,
          },
        },
      });
    });

    return {
      deleted: true,
      pencawangId: id,
      deletedSiteVisits: visitIds.length,
      deletedAssets: assetIds.length,
      deletedFeeders: feeders.length,
    };
  }

  private assertCanDeletePencawang(user: RequestUser) {
    if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
      return;
    }
    throw new ForbiddenException(
      'Only a manager or administrator can delete a Pencawang.',
    );
  }

  /**
   * Returns a human reason a Pencawang cascade-delete must be refused, or null.
   * Data-integrity guards (route endpoint, shared SAVT poles) apply to everyone;
   * the own-company guard applies only to a non-ADMIN.
   */
  private async resolvePencawangDeleteBlock(
    user: RequestUser,
    substationId: string,
  ): Promise<string | null> {
    // Used as a route (SAVT) From/To endpoint by a survey → deleting it would
    // silently null their endpoint. Deferred (SAVT redundancy is its own pass).
    const routeRefs = await this.prisma.siteVisit.count({
      where: {
        tenantId: user.tenantId,
        OR: [{ fromPencawangId: substationId }, { toPencawangId: substationId }],
      },
    });
    if (routeRefs > 0) {
      return `This Pencawang is a route (From/To) endpoint of ${routeRefs} survey(s). Delete those route surveys first.`;
    }

    // Shares poles with surveys of OTHER Pencawang/routes (SAVT redundancy) →
    // cascading could corrupt them. Deferred.
    const [crossInspect, crossLink] = await Promise.all([
      this.prisma.inspection.count({
        where: {
          tenantId: user.tenantId,
          asset: { substationId },
          siteVisit: { substationId: { not: substationId } },
        },
      }),
      this.prisma.siteVisitAsset.count({
        where: {
          asset: { substationId },
          siteVisit: { substationId: { not: substationId } },
        },
      }),
    ]);
    if (crossInspect + crossLink > 0) {
      return 'This Pencawang shares poles with surveys of other Pencawang/routes. Deleting it could corrupt them — not yet supported.';
    }

    // MANAGER: every direct survey here must belong to their own company.
    if (user.role !== UserRole.ADMIN) {
      const [total, visible] = await Promise.all([
        this.prisma.siteVisit.count({
          where: { tenantId: user.tenantId, substationId },
        }),
        this.prisma.siteVisit.count({
          where: {
            tenantId: user.tenantId,
            substationId,
            ...siteVisitAccessWhere(user),
          },
        }),
      ]);
      if (total !== visible) {
        return 'This Pencawang holds surveys from another team or company. Only an administrator can delete it.';
      }
    }

    return null;
  }

  private async findSubstationOrThrow(tenantId: string, id: string) {
    const substation = await this.prisma.substation.findFirst({
      where: { id, tenantId },
      include: substationCountInclude,
    });

    if (!substation) {
      throw new NotFoundException('Pencawang not found.');
    }

    return substation;
  }

  private serializeSubstation(substation: SubstationRecord) {
    return {
      id: substation.id,
      tenantId: substation.tenantId,
      code: substation.code,
      name: substation.name,
      location: substation.location,
      isActive: substation.isActive,
      createdAt: substation.createdAt,
      updatedAt: substation.updatedAt,
      assetCount: substation._count.assets,
      visitCount:
        substation._count.siteVisits +
        substation._count.fromRouteSiteVisits +
        substation._count.toRouteSiteVisits,
    };
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
    // The bare list (no substation filter) is the admin-web Assets table — scope
    // it to the caller's own company for non-admins (ADMIN → tenant-wide). The
    // substation-filtered path is shared with the mobile inspection flow + the
    // cross-team map, so it stays tenant-wide (mobile always passes substation_id).
    const companyScope = substationId
      ? {}
      : assetAccessWhere(user, await buildScopeContext(this.prisma, user));
    const assets = await this.prisma.asset.findMany({
      where: {
        tenantId: user.tenantId,
        ...(substationId ? { substationId } : {}),
        ...companyScope,
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
          // latestInspection drives the map "inspected" marker colour, so it
          // must reflect the latest SUBMITTED inspection. Without this filter an
          // amended-to-DRAFT (submittedAt nulled) or a newer-cycle draft sorts
          // ahead under Postgres DESC NULLS FIRST and masks a real submission,
          // leaving a genuinely-inspected pole red.
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
          operationalScope: dto.operationalScope,
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

    if (dto.operationalScope !== undefined) {
      data.operationalScope = dto.operationalScope;
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
      operationalScope: assetType.operationalScope,
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
