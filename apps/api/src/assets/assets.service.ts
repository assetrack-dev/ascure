import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetStatus,
  DefectSeverity,
  DefectStatus,
  InspectionCompletionStatus,
  InspectionItemInputType,
  MaintenanceCategory,
  OperationalScope,
  Prisma,
  SiteVisitStatus,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { normalizeOperationalText } from '../common/operational-text';
import {
  inferOperationalScopeFromAssetTypeCode,
  isNetworkScope,
} from '../common/operational-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildScopeContext,
  type ScopeContext,
} from '../common/authorization/scope-context';
import {
  assetAccessWhere,
  assetOversightWhere,
  siteVisitMapWhere,
} from '../common/authorization/site-visit-scope';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
import { MapQueryDto } from './dto/map-query.dto';
import { renderNoTiangRondaan, type StoredMembership } from '../common/rondaan';
import { buildInspectionImagePath } from '../common/uploads.constants';
import { CLIENT_VISIBLE_LIFECYCLE } from '../common/client-visibility';
import {
  checklistColumnOptions,
  checklistResultValue,
  normalizeChecklistLabel,
  type ChecklistColumnDef,
  type ChecklistImage,
  type ChecklistResultValueRow,
} from '../common/checklist-columns';
import {
  buildNormalizedKey,
  formatBranchSuffix,
  getExpectedParentKey,
  parsePoleCode,
} from '@ascure/shared-utils';

const ASSET_CODE_SCOPE_CONFLICT_MESSAGE =
  'An asset with this code already exists in this Pencawang.';

// Defect statuses that still need field/maintenance work — a pole "has a defect"
// on the map only while at least one of these is open. RESOLVED/CLOSED drop off.
const OPEN_DEFECT_STATUSES = [
  DefectStatus.OPEN,
  DefectStatus.IN_PROGRESS,
  DefectStatus.MONITORING,
] as const;

// Severity ordering so the map can surface a pole's single worst open defect.
const DEFECT_SEVERITY_RANK: Record<DefectSeverity, number> = {
  [DefectSeverity.LOW]: 1,
  [DefectSeverity.MEDIUM]: 2,
  [DefectSeverity.HIGH]: 3,
  [DefectSeverity.CRITICAL]: 4,
};
const DEFECT_SEVERITY_BY_RANK = [
  DefectSeverity.LOW,
  DefectSeverity.MEDIUM,
  DefectSeverity.HIGH,
  DefectSeverity.CRITICAL,
] as const;

/** Split a comma-separated query param into trimmed, non-empty values. */
function splitCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Max poles returned for the Mainhead-wide "show all poles" view — matches the
 *  AppSheet-style cap; the viewport bbox keeps the visible set under this. */
const MAINHEAD_POINTS_CAP = 1000;

/** Parse a "minLng,minLat,maxLng,maxLat" viewport string → bounds, or null if it
 *  is missing / malformed / degenerate. Tolerant: a bad value disables the clip
 *  (returns the capped set unfiltered) rather than erroring. */
function parseBbox(
  raw: string | undefined,
): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  if (!raw) return null;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng || minLat > maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

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
  /**
   * The map's per-role asset visibility clause — the single definition every map
   * query spreads, so the bubble counts, the Pencawang list and the pole layer
   * can never disagree about what a caller may see.
   *
   * ADMIN: everything. CONTRACTORS: transitive through the visits they may see
   * (an Asset row carries no team/mainhead column) — i.e. scoped by WHO DID THE
   * WORK. CLIENT VIEWERS: scoped by WHOSE NETWORK IT IS — poles whose Pencawang
   * sits under a Mainhead assigned to their organization, matching the client
   * progress view exactly. Using the contractor's transitive rule for a client
   * would under-count badly: a pole nobody has surveyed yet has no visit to
   * reach it through, so the map would show 1 pole where progress counts 88.
   */
  private mapScopeWhere(
    user: RequestUser,
    ctx: ScopeContext,
    scopeWhere: Prisma.SiteVisitWhereInput,
  ): Prisma.AssetWhereInput {
    if (ctx.isAdmin) {
      return {};
    }

    if (ctx.isClientViewer) {
      // Fails closed: an empty assignment list matches no Pencawang.
      return { substation: { mainheadId: { in: ctx.clientMainheadIds } } };
    }

    return {
      OR: [
        { inspections: { some: { siteVisit: scopeWhere } } },
        { createdDuringVisit: scopeWhere },
      ],
    };
  }

  private async loadMapAssets(
    user: RequestUser,
    extraWhere?: Prisma.AssetWhereInput,
    take?: number,
  ) {
    const ctx = await buildScopeContext(this.prisma, user);
    // Map scope: a TECHNICIAN additionally sees (read-only) their company's other
    // teams working a MAINHEAD where their own team works, so same-area crews can
    // spot already-inspected poles. No-op for every other role (== oversight).
    const scopeWhere = siteVisitMapWhere(user, ctx);

    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      latitude: { not: null },
      longitude: { not: null },
      // AND rather than spread: `extraWhere` can also constrain `substation`
      // (the Mainhead-wide points view does), and a client viewer's scope is a
      // substation filter too — spreading both would let one silently replace
      // the other. See the same guard in aggregateMap.
      AND: [this.mapScopeWhere(user, ctx, scopeWhere), extraWhere ?? {}],
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
      // Undefined = no limit (single-Pencawang view). The Mainhead-wide view
      // passes a cap so a huge Mainhead can't flood the client.
      take,
    });

    // Attach a lightweight open-defect summary per pole so the map can filter by
    // maintenance category and recolour by defect. One extra query keyed on the
    // already-scoped asset ids (admin-web only — mobile never calls this route),
    // and no lazy materialization here so the map stays fast: the dashboard /
    // defects pages are what materialize defects from failed items.
    const assetIds = assets.map((asset) => asset.id);
    const openDefects =
      assetIds.length > 0
        ? await this.prisma.defect.findMany({
            where: {
              status: { in: [...OPEN_DEFECT_STATUSES] },
              inspectionItemResult: {
                isDefect: true,
                inspection: { assetId: { in: assetIds } },
              },
            },
            select: {
              severity: true,
              status: true,
              maintenanceCategory: true,
              isEmergency: true,
              inspectionItemResult: {
                select: { inspection: { select: { assetId: true } } },
              },
            },
          })
        : [];

    type DefectSummary = {
      openDefectCount: number;
      categories: Set<MaintenanceCategory>;
      maxSeverityRank: number;
      hasEmergency: boolean;
      // True once the pole carries a non-monitoring open defect (OPEN or
      // IN_PROGRESS). Lets the map show a distinct "Monitoring" marker state for
      // poles whose open defects are ALL MONITORING (OPEN_DEFECT_STATUSES folds
      // the three together, so this is the only way to tell them apart).
      hasActiveDefect: boolean;
    };
    const defectsByAsset = new Map<string, DefectSummary>();
    for (const defect of openDefects) {
      const assetId = defect.inspectionItemResult.inspection.assetId;
      let summary = defectsByAsset.get(assetId);
      if (!summary) {
        summary = {
          openDefectCount: 0,
          categories: new Set<MaintenanceCategory>(),
          maxSeverityRank: 0,
          hasEmergency: false,
          hasActiveDefect: false,
        };
        defectsByAsset.set(assetId, summary);
      }
      summary.openDefectCount += 1;
      if (defect.status !== DefectStatus.MONITORING) {
        summary.hasActiveDefect = true;
      }
      // Null category = legacy/untagged → SELENGGARAAN, matching the defect
      // materialization default so the map buckets identically to the list.
      summary.categories.add(
        defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN,
      );
      summary.maxSeverityRank = Math.max(
        summary.maxSeverityRank,
        DEFECT_SEVERITY_RANK[defect.severity],
      );
      if (defect.isEmergency) {
        summary.hasEmergency = true;
      }
    }

    return assets.map(({ inspections, createdDuringVisit, ...asset }) => {
      const latest = inspections[0] ?? null;
      // Prefer the latest submitted inspection's visit ("inspected by"), then
      // the asset's creation visit, for the team/mainhead association.
      const visit = latest?.siteVisit ?? createdDuringVisit ?? null;
      const defectSummary = defectsByAsset.get(asset.id) ?? null;
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
        openDefectCount: defectSummary?.openDefectCount ?? 0,
        defectCategories: defectSummary
          ? Array.from(defectSummary.categories)
          : [],
        maxDefectSeverity:
          defectSummary && defectSummary.maxSeverityRank > 0
            ? DEFECT_SEVERITY_BY_RANK[defectSummary.maxSeverityRank - 1]
            : null,
        hasEmergencyDefect: defectSummary?.hasEmergency ?? false,
        hasActiveDefect: defectSummary?.hasActiveDefect ?? false,
      };
    });
  }

  /**
   * Orthogonal map filters (inspection / asset type / defects-only / defect
   * category) folded into a single AND so they compose without clobbering the
   * shared `inspections` relation key. Returns {} when no filter is set. Applied
   * at every level, so they narrow the bubble counts and the leaf points alike.
   */
  private mapFilterWhere(query: MapQueryDto): Prisma.AssetWhereInput {
    const and: Prisma.AssetWhereInput[] = [];

    if (query.inspected === 'inspected') {
      and.push({
        inspections: {
          some: { completionStatus: InspectionCompletionStatus.SUBMITTED },
        },
      });
    } else if (query.inspected === 'not') {
      and.push({
        NOT: {
          inspections: {
            some: { completionStatus: InspectionCompletionStatus.SUBMITTED },
          },
        },
      });
    }

    const assetTypeIds = splitCsv(query.assetTypeIds);
    if (assetTypeIds.length > 0) {
      and.push({ assetTypeId: { in: assetTypeIds } });
    }

    if (query.defectsOnly === 'true') {
      and.push({
        inspections: {
          some: {
            itemResults: {
              some: {
                isDefect: true,
                defect: { status: { in: [...OPEN_DEFECT_STATUSES] } },
              },
            },
          },
        },
      });
    }

    const categories = splitCsv(query.categories).filter(
      (value): value is MaintenanceCategory =>
        (Object.values(MaintenanceCategory) as string[]).includes(value),
    );
    if (categories.length > 0) {
      // The map buckets a null defect category as SELENGGARAAN, so match null
      // too when SELENGGARAAN is among the chosen categories.
      const categoryMatch: Prisma.DefectWhereInput[] = [
        { maintenanceCategory: { in: categories } },
      ];
      if (categories.includes(MaintenanceCategory.SELENGGARAAN)) {
        categoryMatch.push({ maintenanceCategory: null });
      }
      and.push({
        inspections: {
          some: {
            itemResults: {
              some: {
                isDefect: true,
                defect: {
                  status: { in: [...OPEN_DEFECT_STATUSES] },
                  OR: categoryMatch,
                },
              },
            },
          },
        },
      });
    }

    // Mainhead / Pencawang are ALSO the drill-down nav, but a direct filter lets
    // the user narrow across the hierarchy without walking it.
    const mainheadIds = splitCsv(query.mainheadIds);
    if (mainheadIds.length > 0) {
      and.push({ substation: { mainheadId: { in: mainheadIds } } });
    }

    const pencawangIds = splitCsv(query.pencawangIds);
    if (pencawangIds.length > 0) {
      and.push({ substationId: { in: pencawangIds } });
    }

    const statuses = splitCsv(query.statuses).filter(
      (value): value is AssetStatus =>
        (Object.values(AssetStatus) as string[]).includes(value),
    );
    if (statuses.length > 0) {
      and.push({ status: { in: statuses } });
    }

    // Team isn't a column on Asset — it comes from the pole's latest inspection
    // visit or its creation visit (mirrors how loadMapAssets derives it).
    const teamIds = splitCsv(query.teamIds);
    if (teamIds.length > 0) {
      and.push({
        OR: [
          { inspections: { some: { siteVisit: { teamId: { in: teamIds } } } } },
          { createdDuringVisit: { teamId: { in: teamIds } } },
        ],
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  /**
   * Scoped option lists for the map's filter dock: the Mainheads and Pencawang
   * that actually have a located, in-scope pole (so the filters never offer an
   * empty option). Same scope as the map feed. Teams / asset types / statuses
   * are sourced elsewhere (existing endpoints / a static enum).
   */
  async mapFilterOptions(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    const scopeWhere = siteVisitMapWhere(user, ctx);
    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      latitude: { not: null },
      longitude: { not: null },
      ...this.mapScopeWhere(user, ctx, scopeWhere),
    };

    const substations = await this.prisma.substation.findMany({
      where: { assets: { some: where } },
      select: {
        id: true,
        code: true,
        name: true,
        mainhead: { select: { id: true, name: true } },
      },
      orderBy: { code: 'asc' },
    });

    const mainheads = new Map<string, string>();
    const pencawang = substations.map((s) => {
      if (s.mainhead) mainheads.set(s.mainhead.id, s.mainhead.name);
      // mainheadId lets the filter dock scope the Pencawang list to the drilled
      // Mainhead (null = Pencawang has no Mainhead → the "Unassigned" bucket).
      return { id: s.id, name: s.name || s.code, mainheadId: s.mainhead?.id ?? null };
    });

    return {
      mainheads: [...mainheads.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      pencawang,
    };
  }

  /**
   * The Pencawang's own map location — its most recent site-visit check-in GPS.
   * Shown alongside the poles (as a distinct marker) at the points level.
   */
  private async pencawangCheckIn(user: RequestUser, pencawangId: string) {
    const substation = await this.prisma.substation.findFirst({
      where: { id: pencawangId, tenantId: user.tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        siteVisits: {
          where: {
            checkInLatitude: { not: null },
            checkInLongitude: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { checkInLatitude: true, checkInLongitude: true },
        },
      },
    });
    const visit = substation?.siteVisits[0];
    if (
      !substation ||
      !visit ||
      visit.checkInLatitude == null ||
      visit.checkInLongitude == null
    ) {
      return null;
    }
    return {
      id: substation.id,
      name: substation.name || substation.code,
      latitude: visit.checkInLatitude,
      longitude: visit.checkInLongitude,
    };
  }

  /**
   * Hierarchical map feed. Without a `level` this returns the legacy full
   * per-asset list (kept until the client always drills down). With a level it
   * returns aggregated count "bubbles" for region / mainhead / pencawang, or the
   * per-asset points for a single Pencawang. See docs/PLAN-hierarchical-map.md.
   */
  async listMap(user: RequestUser, query: MapQueryDto) {
    if (!query.level) {
      return this.loadMapAssets(user);
    }
    if (query.level === 'points') {
      // Single-Pencawang view: every pole (no cap — a Pencawang is bounded).
      if (query.pencawangId) {
        const [poles, pencawang] = await Promise.all([
          this.loadMapAssets(user, {
            substationId: query.pencawangId,
            ...this.mapFilterWhere(query),
          }),
          this.pencawangCheckIn(user, query.pencawangId),
        ]);
        return { poles, pencawang };
      }
      // Mainhead-wide "show all poles" view: poles under the Mainhead's
      // Pencawang, clipped to the viewport bbox and capped so the map can't jam.
      // Fetch cap+1 to detect truncation; the client colours by Pencawang and
      // derives the per-Pencawang anchors from the poles' substation ids.
      if (query.mainheadId) {
        const bbox = parseBbox(query.bbox);
        const [rows, pencawangBubbles] = await Promise.all([
          this.loadMapAssets(
            user,
            {
              substation: { mainheadId: query.mainheadId },
              ...(bbox
                ? {
                    latitude: { gte: bbox.minLat, lte: bbox.maxLat },
                    longitude: { gte: bbox.minLng, lte: bbox.maxLng },
                  }
                : {}),
              ...this.mapFilterWhere(query),
            },
            MAINHEAD_POINTS_CAP + 1,
          ),
          // STABLE per-Pencawang anchor points: the centroid of ALL the
          // Pencawang's poles (viewport-independent), so the on-map label sits
          // still instead of drifting to the visible-poles centroid on every pan.
          // Reuses the Pencawang-bubble aggregation.
          this.aggregateMap(user, 'pencawang', query),
        ]);
        const truncated = rows.length > MAINHEAD_POINTS_CAP;
        return {
          poles: truncated ? rows.slice(0, MAINHEAD_POINTS_CAP) : rows,
          truncated,
          mainheadWide: true,
          pencawangMarkers: pencawangBubbles.map((b) => ({
            id: b.id,
            name: b.name,
            latitude: b.latitude,
            longitude: b.longitude,
          })),
        };
      }
      throw new BadRequestException(
        'The points level requires pencawangId (one Pencawang) or mainheadId (all poles in a Mainhead).',
      );
    }
    return this.aggregateMap(user, query.level, query);
  }

  /**
   * One count bubble per group at the requested level, positioned at the
   * count-weighted centroid of its poles. The DB does the heavy grouping (by
   * Pencawang); a light JS roll-up folds Pencawang into mainhead / region, so the
   * payload is a handful of bubbles no matter how many poles exist.
   */
  private async aggregateMap(
    user: RequestUser,
    level: 'region' | 'mainhead' | 'pencawang',
    query: MapQueryDto,
  ) {
    const ctx = await buildScopeContext(this.prisma, user);
    const scopeWhere = siteVisitMapWhere(user, ctx);

    // Parent drill-down filter (a Region's mainheads, a Mainhead's pencawangs).
    const substationFilter: Prisma.SubstationWhereInput = {};
    if (level === 'mainhead' && query.regionId) {
      substationFilter.mainhead = { operationalRegionId: query.regionId };
    }
    if (level === 'pencawang' && query.mainheadId) {
      substationFilter.mainheadId = query.mainheadId;
    }

    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      latitude: { not: null },
      longitude: { not: null },
      // ⚠ The scope clause and the drill-down filter can BOTH constrain
      // `substation` (a client viewer is scoped by substation.mainheadId; the
      // region/mainhead drill filters on it too). Spreading both would let the
      // later key silently REPLACE the earlier one — which dropped the client
      // scope entirely and showed a TNB user another Mainhead's poles. AND-ing
      // them keeps both constraints.
      AND: [
        this.mapScopeWhere(user, ctx, scopeWhere),
        ...(Object.keys(substationFilter).length > 0
          ? [{ substation: substationFilter }]
          : []),
      ],
      ...this.mapFilterWhere(query),
    };

    // Count + centroid per Pencawang (the DB does the grouping).
    const grouped = await this.prisma.asset.groupBy({
      by: ['substationId'],
      where,
      _count: true,
      _avg: { latitude: true, longitude: true },
    });
    if (grouped.length === 0) {
      return [];
    }

    // Inspected poles per Pencawang.
    const inspectedGrouped = await this.prisma.asset.groupBy({
      by: ['substationId'],
      where: {
        ...where,
        inspections: {
          some: { completionStatus: InspectionCompletionStatus.SUBMITTED },
        },
      },
      _count: true,
    });
    const inspectedBySub = new Map(
      inspectedGrouped.map((g) => [g.substationId, g._count] as const),
    );

    // Open-defect poles per Pencawang (distinct assets + the emergency subset).
    const openDefects = await this.prisma.defect.findMany({
      where: {
        status: { in: [...OPEN_DEFECT_STATUSES] },
        inspectionItemResult: { isDefect: true, inspection: { asset: where } },
      },
      select: {
        isEmergency: true,
        inspectionItemResult: {
          select: {
            inspection: {
              select: {
                assetId: true,
                asset: { select: { substationId: true } },
              },
            },
          },
        },
      },
    });
    const defectAssetsBySub = new Map<string, Set<string>>();
    const emergencyAssetsBySub = new Map<string, Set<string>>();
    for (const defect of openDefects) {
      const { assetId, asset } = defect.inspectionItemResult.inspection;
      const subId = asset.substationId;
      let withDefect = defectAssetsBySub.get(subId);
      if (!withDefect) defectAssetsBySub.set(subId, (withDefect = new Set()));
      withDefect.add(assetId);
      if (defect.isEmergency) {
        let withEmergency = emergencyAssetsBySub.get(subId);
        if (!withEmergency)
          emergencyAssetsBySub.set(subId, (withEmergency = new Set()));
        withEmergency.add(assetId);
      }
    }

    // Pencawang metadata (name + its mainhead + region) for the roll-up keys.
    const substationIds = grouped.map((g) => g.substationId);
    const substations = await this.prisma.substation.findMany({
      where: { id: { in: substationIds } },
      select: {
        id: true,
        code: true,
        name: true,
        mainheadId: true,
        mainhead: {
          select: {
            id: true,
            name: true,
            operationalRegion: { select: { id: true, name: true } },
          },
        },
      },
    });
    const subMeta = new Map(substations.map((s) => [s.id, s] as const));

    // Roll each Pencawang up into the requested level's bucket.
    const UNASSIGNED = '__unassigned__';
    type Bucket = {
      id: string;
      name: string;
      count: number;
      sumLat: number;
      sumLng: number;
      inspected: number;
      openDefects: number;
      emergency: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const g of grouped) {
      const meta = subMeta.get(g.substationId);
      const count = g._count;
      const key =
        level === 'pencawang'
          ? { id: g.substationId, name: meta?.name || meta?.code || 'Pencawang' }
          : level === 'mainhead'
            ? {
                id: meta?.mainheadId ?? UNASSIGNED,
                name: meta?.mainhead?.name ?? 'Unassigned',
              }
            : {
                id: meta?.mainhead?.operationalRegion?.id ?? UNASSIGNED,
                name: meta?.mainhead?.operationalRegion?.name ?? 'Unassigned',
              };

      let bucket = buckets.get(key.id);
      if (!bucket) {
        buckets.set(
          key.id,
          (bucket = {
            id: key.id,
            name: key.name,
            count: 0,
            sumLat: 0,
            sumLng: 0,
            inspected: 0,
            openDefects: 0,
            emergency: 0,
          }),
        );
      }
      bucket.count += count;
      bucket.sumLat += (g._avg.latitude ?? 0) * count;
      bucket.sumLng += (g._avg.longitude ?? 0) * count;
      bucket.inspected += inspectedBySub.get(g.substationId) ?? 0;
      bucket.openDefects += defectAssetsBySub.get(g.substationId)?.size ?? 0;
      bucket.emergency += emergencyAssetsBySub.get(g.substationId)?.size ?? 0;
    }

    return [...buckets.values()]
      .map((b) => ({
        level,
        id: b.id,
        name: b.name,
        count: b.count,
        latitude: b.count > 0 ? b.sumLat / b.count : 0,
        longitude: b.count > 0 ? b.sumLng / b.count : 0,
        inspected: b.inspected,
        notInspected: b.count - b.inspected,
        openDefects: b.openDefects,
        emergency: b.emergency,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'en', {
          numeric: true,
          sensitivity: 'base',
        }),
      );
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
        code: true,
        operationalScope: true,
      },
    });

    if (!assetType) {
      throw new NotFoundException('Asset type not found.');
    }

    let linkedSiteVisit:
      | { id: string; operationalScope: OperationalScope | null }
      | null = null;

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
          operationalScope: true,
        },
      });

      if (!siteVisit) {
        throw new NotFoundException('Active site visit not found for asset creation.');
      }

      linkedSiteVisit = siteVisit;
    }

    // A pole created during a SAVR/SAVT survey must carry that survey's asset type,
    // or its inspection binds to the wrong checklist template and its answers are
    // rejected on sync. Offline clients can send the wrong type when they can't read
    // the visit scope, so the server self-corrects here.
    const effectiveAssetTypeId = await this.resolveScopedAssetTypeId(user, {
      requestedAssetType: assetType,
      visitScope: linkedSiteVisit?.operationalScope ?? null,
    });

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
            assetTypeId: effectiveAssetTypeId,
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

  /**
   * A pole created during a network survey (SAVR/SAVT) must carry that survey's
   * asset type — otherwise its inspection binds to the wrong checklist template and
   * its answers are rejected on sync (the SAVT-answer-on-a-SAVR-pole incident). That
   * happens when an offline client can't read the visit scope and defaults the type
   * to the first one in its list. The server self-heals: when the creation visit is
   * scope-locked (SAVR/SAVT) and the requested asset type's scope differs, swap in
   * the canonical asset type for the visit's scope. The requested type is left
   * untouched when the visit isn't scope-locked, already matches, or has no
   * scope-matching asset type.
   */
  private async resolveScopedAssetTypeId(
    user: RequestUser,
    input: {
      requestedAssetType: {
        id: string;
        code: string;
        operationalScope: OperationalScope | null;
      };
      visitScope: OperationalScope | null;
    },
  ): Promise<string> {
    const { requestedAssetType, visitScope } = input;

    // Only the network survey scopes (SAVR/SAVT) drive a distinct checklist
    // template, so a type/scope mismatch only causes a failure there.
    if (!visitScope || !isNetworkScope(visitScope)) {
      return requestedAssetType.id;
    }

    const requestedScope =
      requestedAssetType.operationalScope ??
      inferOperationalScopeFromAssetTypeCode(requestedAssetType.code);

    if (requestedScope === visitScope) {
      return requestedAssetType.id;
    }

    // Find the canonical asset type for the visit's scope. Prefer an explicit
    // operationalScope match; fall back to the code keyword (mirrors the mobile's
    // pickDefaultAssetTypeId) so this still works when asset types carry a null
    // operationalScope and only encode their scope in the code (e.g. "SAVT_POLE").
    const candidates = await this.prisma.assetType.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, operationalScope: true },
    });
    const scopeAssetType =
      candidates.find((type) => type.operationalScope === visitScope) ??
      candidates.find(
        (type) => inferOperationalScopeFromAssetTypeCode(type.code) === visitScope,
      ) ??
      null;

    if (!scopeAssetType) {
      // No canonical type for this scope — keep the requested one rather than fail.
      return requestedAssetType.id;
    }

    this.logger.warn(
      `Coerced asset type on create: requested "${requestedAssetType.code}" ` +
        `(scope ${requestedScope ?? 'none'}) inside a ${visitScope} visit — ` +
        `using the ${visitScope} asset type ${scopeAssetType.id} instead.`,
    );

    return scopeAssetType.id;
  }

  async getById(user: RequestUser, id: string) {
    // A CLIENT viewer (TNB) is an EXTERNAL party, so tenant scope alone is not
    // enough here: narrow to poles in their assigned Mainheads whose survey has
    // left the field. Without this they could read any pole in the tenant by id,
    // bypassing the client progress view's own scoping.
    const ctx = await buildScopeContext(this.prisma, user);
    const clientWhere: Prisma.AssetWhereInput =
      ctx.isClientViewer && !ctx.isAdmin
        ? {
            substation: { mainheadId: { in: ctx.clientMainheadIds } },
            inspections: {
              some: {
                completionStatus: InspectionCompletionStatus.SUBMITTED,
                siteVisit: {
                  lifecycleStatus: { in: CLIENT_VISIBLE_LIFECYCLE },
                },
              },
            },
          }
        : {};

    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...clientWhere,
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
                // Which checklist item the photo was captured against, so an
                // IMAGE column in the asset panel can resolve its photo.
                templateItemId: true,
              },
            },
            // The template behind this inspection — drives the panel's checklist
            // columns (label / input type / options), the same way the Site Visit
            // Linked-Assets table builds its toggleable columns.
            template: {
              select: {
                sections: { select: { id: true, title: true, sortOrder: true } },
                items: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    label: true,
                    sortOrder: true,
                    sectionId: true,
                    inputType: true,
                    optionsJson: true,
                  },
                },
              },
            },
            results: {
              select: {
                valueText: true,
                valueNumber: true,
                valueBoolean: true,
                valueDate: true,
                valueDateTime: true,
                templateItemId: true,
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
            // The visit the inspection was recorded in — an in-place checklist
            // edit passes it so the API can reject an edit aimed at a value
            // recorded in a different survey cycle.
            siteVisitId: latestInspection.siteVisitId,
            cycleNumber: latestInspection.inspectionCycle,
            status: latestInspection.completionStatus,
            submittedAt: latestInspection.submittedAt?.toISOString() ?? '',
            createdAt: latestInspection.createdAt.toISOString(),
            remarks: this.extractRemarks(latestInspection.results),
            // Every checklist field of the inspection's template with its
            // recorded value, so the asset panel can show (and a manager edit)
            // the full checklist rather than only the pass/fail item results.
            checklist: this.buildAssetChecklist(latestInspection),
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
              // The checklist item this photo was captured against (null for a
              // general inspection photo) — lets the client caption it with the
              // field name instead of a bare "Image 3".
              templateItemId: image.templateItemId,
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

    const scope = await this.mutableAssetScope(user);
    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...scope,
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

    const scope = await this.mutableAssetScope(user);
    const asset = await this.prisma.asset.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        ...scope,
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

        // Moving a pole to a new Pencawang carries its in-progress survey with
        // it, so the inspection follows the pole instead of being stranded on the
        // old Pencawang's visit. `data.substationId` is set only when it changed.
        if (data.substationId !== undefined) {
          await this.migrateOpenSurveyOnPencawangChange(tx, {
            tenantId: user.tenantId,
            assetId: id,
            fromSubstationId: asset.substationId,
            toSubstationId: data.substationId,
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

    // Only assets within the caller's DELETE scope (own team / own org; ADMIN
    // tenant-wide; a MAIN_CONTRACTOR manager also its subcontractor subtree).
    // Out-of-scope assets 404 exactly like a non-existent one, so a field crew can
    // delete their own poles but not another team's.
    const scope = await this.deletableAssetScope(user);
    const asset = await this.prisma.asset.findFirst({
      where: { id, tenantId: user.tenantId, ...scope },
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

    // Restrict to assets the caller may delete (own team / own org; ADMIN
    // tenant-wide; a MAIN_CONTRACTOR manager also its subcontractor subtree).
    // Out-of-scope ids fall through to `notFound`, never deleted.
    const scope = await this.deletableAssetScope(user);
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: uniqueIds }, tenantId: user.tenantId, ...scope },
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
  /**
   * When a pole is moved to a new Pencawang, carry its CURRENT (in-progress)
   * survey with it: re-home the inspection(s), the visit link, and the
   * "created during" attribution from the old Pencawang's active visit to the
   * new Pencawang's active visit.
   *
   * Why: an Inspection is bound to `siteVisitId` (never a substation), and a
   * visit's rollup counts assets from `SiteVisitAsset`, `Asset.createdDuringVisitId`
   * and `Inspection.siteVisitId`. Without this migration a moved pole's completed
   * inspection stays on the OLD visit — the old Pencawang keeps showing it as
   * inspected while the new one shows it as pending (the 2026-07-16 PE KAMPUNG
   * PANDAN 1 -> PDT ERA GEMILANG incident).
   *
   * Safety: only IN-PROGRESS surveys are touched on either side. A finished or
   * report-frozen survey (status COMPLETED/CANCELLED, or lifecycle
   * LAPORAN_SELESAI/ARKIB) is never rewritten — its history stands. And if the
   * new Pencawang has no active visit there is nowhere to migrate to, so the
   * survey links are left untouched (only the pole's substation moves).
   */
  private async migrateOpenSurveyOnPencawangChange(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      assetId: string;
      fromSubstationId: string;
      toSubstationId: string;
    },
  ): Promise<void> {
    const { tenantId, assetId, fromSubstationId, toSubstationId } = params;

    // An "open" (still-editable) survey: actively running and not yet
    // report-frozen. Matches on both the source and destination visit.
    const openVisitWhere: Prisma.SiteVisitWhereInput = {
      status: {
        in: [
          SiteVisitStatus.ACTIVE,
          SiteVisitStatus.OPEN,
          SiteVisitStatus.IN_PROGRESS,
        ],
      },
      OR: [
        { lifecycleStatus: null },
        {
          lifecycleStatus: {
            notIn: [
              SurveyLifecycleStatus.LAPORAN_SELESAI,
              SurveyLifecycleStatus.ARKIB,
            ],
          },
        },
      ],
    };

    // Destination: the most recent in-progress visit at the NEW Pencawang.
    const destVisit = await tx.siteVisit.findFirst({
      where: { tenantId, substationId: toSubstationId, ...openVisitWhere },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    if (!destVisit) {
      // No active survey at the new Pencawang — nothing to migrate onto.
      return;
    }

    // The pole's inspections that belong to an in-progress visit at the OLD
    // Pencawang (never a finished/frozen one). Their visits are the sources.
    const sourceInspections = await tx.inspection.findMany({
      where: {
        tenantId,
        assetId,
        siteVisit: { substationId: fromSubstationId, ...openVisitWhere },
      },
      select: { siteVisitId: true },
    });
    const sourceVisitIds = Array.from(
      new Set(sourceInspections.map((inspection) => inspection.siteVisitId)),
    ).filter((visitId) => visitId !== destVisit.id);

    if (sourceVisitIds.length === 0) {
      return;
    }

    // 1) Inspections (any completion status) -> the destination visit.
    await tx.inspection.updateMany({
      where: { tenantId, assetId, siteVisitId: { in: sourceVisitIds } },
      data: { siteVisitId: destVisit.id },
    });

    // 2) "Created during" attribution -> destination, so the old visit's asset
    //    total drops (the rollup counts createdDuringVisitId too).
    await tx.asset.updateMany({
      where: { id: assetId, createdDuringVisitId: { in: sourceVisitIds } },
      data: { createdDuringVisitId: destVisit.id },
    });

    // 3) Ensure a link on the destination visit, then drop the old-visit links.
    await tx.siteVisitAsset.upsert({
      where: {
        siteVisitId_assetId: { siteVisitId: destVisit.id, assetId },
      },
      create: {
        siteVisitId: destVisit.id,
        assetId,
        source: 'PENCAWANG_CHANGE',
      },
      update: {},
    });
    await tx.siteVisitAsset.deleteMany({
      where: { assetId, siteVisitId: { in: sourceVisitIds } },
    });
  }

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

  /**
   * The inspection's checklist as columns + recorded values, mirroring the Site
   * Visit Linked-Assets table so the two read identically and a value edited in
   * one shows up in the other. Columns come from the template (so a field nobody
   * filled still appears, blank); values are keyed by the same normalized label
   * that `PATCH /inspections/:id/checklist-result` resolves an edit against.
   */
  private buildAssetChecklist(inspection: {
    template: {
      sections: { id: string; title: string; sortOrder: number }[];
      items: {
        id: string;
        label: string;
        sortOrder: number;
        sectionId: string;
        inputType: InspectionItemInputType;
        optionsJson: Prisma.JsonValue | null;
      }[];
    } | null;
    results: Array<
      ChecklistResultValueRow & {
        templateItemId: string;
        templateItem: { key: string; label: string } | null;
      }
    >;
    inspectionImages: Array<{
      url: string;
      filename: string;
      latitude: number | null;
      longitude: number | null;
      timestamp: Date | null;
      createdAt: Date;
      templateItemId: string | null;
    }>;
  }): {
    columns: ChecklistColumnDef[];
    values: Record<string, string | null>;
    images: Record<string, ChecklistImage>;
  } {
    const sectionById = new Map(
      (inspection.template?.sections ?? []).map((section) => [section.id, section]),
    );

    // Dedupe by normalized label — the same label can appear twice in a template
    // (e.g. split across sections); the first definition wins and later item ids
    // join it, so an item-tagged photo recorded under either still resolves.
    const byKey = new Map<string, ChecklistColumnDef & { s: number; i: number }>();
    for (const item of inspection.template?.items ?? []) {
      const key = normalizeChecklistLabel(item.label);
      if (!key) {
        continue;
      }
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.templateItemIds.includes(item.id)) {
          existing.templateItemIds.push(item.id);
        }
        continue;
      }
      const section = sectionById.get(item.sectionId) ?? null;
      byKey.set(key, {
        key,
        label: item.label,
        section: section?.title ?? null,
        inputType: item.inputType,
        options: checklistColumnOptions(item.inputType, item.optionsJson),
        templateItemIds: [item.id],
        s: section?.sortOrder ?? 0,
        i: item.sortOrder,
      });
    }

    const columns = Array.from(byKey.values())
      .sort((a, b) => a.s - b.s || a.i - b.i || a.label.localeCompare(b.label))
      .map(({ key, label, section, inputType, options, templateItemIds }) => ({
        key,
        label,
        section,
        inputType,
        options,
        templateItemIds,
      }));

    // The first non-empty value wins for a label, so a later blank row can never
    // clobber a recorded one; a label present but unfilled maps to null.
    const values: Record<string, string | null> = {};
    for (const column of columns) {
      values[column.key] = null;
    }
    for (const row of inspection.results) {
      const label = row.templateItem?.label;
      if (!label) {
        continue;
      }
      const key = normalizeChecklistLabel(label);
      if (values[key] == null) {
        values[key] = checklistResultValue(row);
      }
    }

    // Item-tagged photos keyed by templateItemId, so an IMAGE column renders its
    // capture. The first photo recorded for an item wins.
    const images: Record<string, ChecklistImage> = {};
    for (const image of inspection.inspectionImages) {
      if (!image.templateItemId || images[image.templateItemId]) {
        continue;
      }
      images[image.templateItemId] = {
        url: image.url,
        filename: image.filename,
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      };
    }

    return { columns, values, images };
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

  /**
   * Prisma filter restricting an Asset query to assets the caller may MUTATE
   * (edit / delete). ADMIN: unrestricted within the tenant. Everyone else: only
   * assets reachable through a site visit they may mutate — the asset's creation
   * visit (`createdDuringVisit`) or one of its inspections.
   *
   * Uses the STRICT {@link siteVisitAccessWhere} (own team / own org / QA
   * mainheads), NOT the widened map/oversight scope: a technician may SEE another
   * team's poles on the map (siteVisitMapWhere) but must never edit or delete
   * them. Callers still apply `tenantId` themselves; spread this alongside it.
   *
   * The `createdByUserId` branch keeps a pole deletable by the person who added
   * it even if its creation visit was later removed (createdDuringVisit is
   * onDelete:SetNull), so a field crew can always undo their own mistaken pole.
   * It only ever matches the caller's OWN creations, so it doesn't reopen the
   * cross-team hole this scope closes.
   */
  private async mutableAssetScope(
    user: RequestUser,
  ): Promise<Prisma.AssetWhereInput> {
    const ctx = await buildScopeContext(this.prisma, user);
    return assetAccessWhere(user, ctx);
  }

  /**
   * Prisma filter restricting an Asset query to assets the caller may DELETE.
   * Same as {@link mutableAssetScope} (strict own-team/org; ADMIN tenant-wide)
   * EXCEPT a MAIN_CONTRACTOR manager may ALSO delete its active subcontractor
   * subtree's assets ({@link assetOversightWhere} — self-limiting, so identical to
   * the strict scope for every other role/manager). Deliberately WIDER than
   * mutableAssetScope, which stays strict: a main contractor may VIEW + DELETE, but
   * not EDIT, a subcontractor's poles. Delete is intentional bulk cleanup of
   * delegated work; edit would silently alter another company's survey data.
   */
  private async deletableAssetScope(
    user: RequestUser,
  ): Promise<Prisma.AssetWhereInput> {
    const ctx = await buildScopeContext(this.prisma, user);
    return assetOversightWhere(user, ctx);
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
