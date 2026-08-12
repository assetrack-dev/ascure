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
  assetOversightWhere,
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
import { UpdateSubstationDetailsDto } from './dto/manage-substation.dto';
import { normalizeOperationalText } from '../common/operational-text';

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
  mainhead: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  // The latest check-in GPS — the Pencawang's DERIVED position when no manual
  // coordinate is set (crews check in AT the Pencawang; see Substation.latitude).
  siteVisits: {
    where: {
      checkInLatitude: { not: null },
      checkInLongitude: { not: null },
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { checkInLatitude: true, checkInLongitude: true },
  },
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

  // Link a Pencawang to its MAINHEAD (or clear the link with `null`). This is the
  // manual counterpart to the auto-link on check-in — it lets an admin fix a
  // Pencawang that fell into the map's "Unassigned" bucket without touching the DB
  // directly. MAINHEAD is a shared (tenant-agnostic) reference table, so we only
  // check that the target exists.
  async assignSubstationMainhead(
    user: RequestUser,
    id: string,
    mainheadId: string | null,
  ) {
    await this.findSubstationOrThrow(user.tenantId, id);

    if (mainheadId) {
      const mainhead = await this.prisma.mainhead.findUnique({
        where: { id: mainheadId },
        select: { id: true },
      });
      if (!mainhead) {
        throw new NotFoundException('Mainhead not found.');
      }
    }

    const substation = await this.prisma.substation.update({
      where: { id },
      data: { mainheadId },
      include: substationCountInclude,
    });

    return this.serializeSubstation(substation);
  }

  /**
   * Edit a Pencawang's details: name, functional location, and its OWN map
   * coordinate. The coordinate is the office fix for a mis-pointed check-in —
   * once set it wins over every future check-in; clearing it (null pair)
   * reverts to check-in-derived. ADMIN anywhere; a MANAGER only when every
   * survey at this Pencawang belongs to their own company (the cascade-delete
   * own-company rule).
   */
  async updateSubstationDetails(
    user: RequestUser,
    id: string,
    dto: UpdateSubstationDetailsDto,
  ) {
    await this.findSubstationOrThrow(user.tenantId, id);
    await this.assertManagerOwnsPencawang(user, id, 'edit');

    const data: Prisma.SubstationUpdateInput = {};

    // Renamed identity strings (KOD PENCAWANG and/or name) collected for one
    // clash check below.
    const identities: string[] = [];

    if (dto.code !== undefined) {
      const code = normalizeOperationalText(dto.code.trim().replace(/\s+/g, ' '));
      if (!code) {
        throw new BadRequestException('The Kod Pencawang cannot be empty.');
      }
      data.code = code;
      identities.push(code);
    }

    if (dto.name !== undefined) {
      const name = normalizeOperationalText(dto.name.trim().replace(/\s+/g, ' '));
      if (!name) {
        throw new BadRequestException('The Pencawang name cannot be empty.');
      }
      data.name = name;
      identities.push(name);
    }

    // Mirror the check-in create guard: mobile matches an "existing" Pencawang
    // by code OR name (case-insensitive), so a rename that collides with
    // another one — on EITHER column — would make it ambiguous there. The DB
    // unique [tenantId, code] is the backstop (P2002 catch on the update).
    if (identities.length > 0) {
      const clash = await this.prisma.substation.findFirst({
        where: {
          tenantId: user.tenantId,
          id: { not: id },
          OR: identities.flatMap((value) => [
            { code: { equals: value, mode: 'insensitive' as const } },
            { name: { equals: value, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          'Another Pencawang already uses this name or code.',
        );
      }
    }

    if (dto.location !== undefined) {
      const location = dto.location?.trim().replace(/\s+/g, ' ') ?? '';
      data.location = location ? normalizeOperationalText(location) : null;
    }

    const hasLatitude = dto.latitude !== undefined;
    const hasLongitude = dto.longitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'Latitude and longitude must be provided together.',
      );
    }
    if (hasLatitude && hasLongitude) {
      const clearing = dto.latitude === null || dto.longitude === null;
      if (clearing && !(dto.latitude === null && dto.longitude === null)) {
        throw new BadRequestException(
          'Latitude and longitude must be provided together.',
        );
      }
      data.latitude = dto.latitude;
      data.longitude = dto.longitude;
      // Stamp who pinned it; a cleared pin reverts fully to check-in-derived.
      data.locationSetAt = clearing ? null : new Date();
      data.locationSetByEmail = clearing ? null : user.email;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update.');
    }

    try {
      const substation = await this.prisma.substation.update({
        where: { id },
        data,
        include: substationCountInclude,
      });
      return this.serializeSubstation(substation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Another Pencawang already uses this name or code.',
        );
      }
      throw error;
    }
  }

  // A non-ADMIN may only touch a Pencawang wholly covered by their own
  // company's surveys — the same rule the cascade delete applies. A Pencawang
  // with no surveys at all is fair game (nothing of anyone else's to distort).
  private async assertManagerOwnsPencawang(
    user: RequestUser,
    substationId: string,
    action: string,
  ) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
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
      throw new ForbiddenException(
        `This Pencawang holds surveys from another team or company. Only an administrator can ${action} it.`,
      );
    }
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

  // Owner decision 2026-08-11: deleting a Pencawang is ADMIN-only (managers
  // edit their own company's, but never delete). Used to also allow MANAGER.
  private assertCanDeletePencawang(user: RequestUser) {
    if (user.role === UserRole.ADMIN) {
      return;
    }
    throw new ForbiddenException('Only an administrator can delete a Pencawang.');
  }

  /**
   * Returns a human reason a Pencawang cascade-delete must be refused, or null.
   * Data-integrity guards only (route endpoint, shared SAVT poles) — the caller
   * is always an ADMIN now, so the old own-company branch is gone.
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
    const derivedVisit = substation.siteVisits[0] ?? null;
    const hasManualLocation = substation.latitude != null && substation.longitude != null;
    return {
      id: substation.id,
      tenantId: substation.tenantId,
      code: substation.code,
      name: substation.name,
      location: substation.location,
      // Manual coordinate (null = derived from check-in) + the effective
      // position every map consumer should show. `locationSource` labels which
      // one won so the UI can say "Manual" vs "From latest check-in".
      latitude: substation.latitude,
      longitude: substation.longitude,
      locationSetAt: substation.locationSetAt,
      locationSetByEmail: substation.locationSetByEmail,
      effectiveLatitude: hasManualLocation
        ? substation.latitude
        : (derivedVisit?.checkInLatitude ?? null),
      effectiveLongitude: hasManualLocation
        ? substation.longitude
        : (derivedVisit?.checkInLongitude ?? null),
      locationSource: hasManualLocation
        ? ('MANUAL' as const)
        : derivedVisit
          ? ('CHECK_IN' as const)
          : null,
      isActive: substation.isActive,
      // The MAINHEAD this Pencawang rolls up under on the hierarchical map
      // (null = "Unassigned"). Editable via assignSubstationMainhead.
      mainheadId: substation.mainheadId,
      mainhead: substation.mainhead
        ? {
            id: substation.mainhead.id,
            name: substation.mainhead.name,
            code: substation.mainhead.code,
          }
        : null,
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
    // it to the caller's own company for non-admins (ADMIN → tenant-wide). Uses the
    // OVERSIGHT scope so a MAIN_CONTRACTOR manager also sees its subcontractor
    // subtree's assets (self-limiting: identical to own-company for everyone else).
    // The substation-filtered path (the mobile map + inspection flow) is narrowed
    // to the caller's ASSIGNED Mainheads — owner decision 2026-08-05, superseding
    // the Deploy-60 tenant-wide cross-team map now that wide accounts load 10k+.
    const companyScope = substationId
      ? await this.assetMainheadScope(user)
      : assetOversightWhere(user, await buildScopeContext(this.prisma, user));
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

  /**
   * Narrow substation-filtered asset reads (the mobile map feed + inspection
   * flow) to the caller's ASSIGNED Mainheads — owner decision 2026-08-05,
   * superseding the Deploy-60 tenant-wide cross-team map:
   *
   * - ADMIN: tenant-wide (unchanged).
   * - CLIENT viewer: its OrganizationMainhead assignments, FAIL CLOSED (empty
   *   = see nothing — same rule as the client progress view).
   * - TECHNICIAN: the Mainheads where their teams work (team assignment +
   *   the teams' site visits — the existing cross-team scope, now the CEILING
   *   instead of a widening).
   * - Other org users (manager/supervisor/etc.): their company's active
   *   OrganizationMainhead assignments.
   *
   * A non-client caller whose scope resolves EMPTY (org with no Mainhead
   * assignments, technician with no team) keeps the old tenant-wide view —
   * unconfigured orgs behave exactly as before; assigning Mainheads to the
   * company is what activates the narrowing. Substations still in the
   * "Unassigned" bucket (mainheadId null) stay visible to every contractor so
   * a freshly-created Pencawang never vanishes mid-survey.
   */
  private async assetMainheadScope(
    user: RequestUser,
  ): Promise<Prisma.AssetWhereInput> {
    const ctx = await buildScopeContext(this.prisma, user);
    if (ctx.isAdmin) {
      return {};
    }

    if (ctx.isClientViewer) {
      return { substation: { mainheadId: { in: ctx.clientMainheadIds } } };
    }

    let allowed: string[] = [];
    if (user.role === UserRole.TECHNICIAN) {
      allowed = ctx.crossTeamMainheadIds;
    } else if (user.organizationId) {
      const assignments = await this.prisma.organizationMainhead.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        select: { mainheadId: true },
      });
      allowed = assignments.map((row) => row.mainheadId);
    }

    if (allowed.length === 0) {
      return {};
    }

    return {
      substation: {
        OR: [{ mainheadId: { in: allowed } }, { mainheadId: null }],
      },
    };
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
