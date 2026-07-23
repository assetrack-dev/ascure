import { ForbiddenException, Injectable } from '@nestjs/common';
import { InspectionCompletionStatus, Prisma } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import { siteVisitAccessWhere } from '../common/authorization/site-visit-scope';
import { CLIENT_VISIBLE_LIFECYCLE } from '../common/client-visibility';

/** Open defect statuses — mirrors the map/dashboard definition of "open". */
const OPEN_DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'MONITORING'] as const;

/**
 * What "surveyed" means to a client: the pole has a SUBMITTED inspection AND the
 * survey it belongs to has left the field ({@link CLIENT_VISIBLE_LIFECYCLE}).
 *
 * ⚠ ONE definition for the whole page. Counting bare submissions here while the
 * evidence drill-down required a completed survey produced a contradiction the
 * client could see: a Pencawang reading 44/44 = 100% that opened to "no
 * completed surveys yet". A pole inside a survey still being walked can still be
 * amended and its defects can still change, so it is not finished work.
 */
const SURVEYED_INSPECTION: Prisma.InspectionWhereInput = {
  completionStatus: InspectionCompletionStatus.SUBMITTED,
  siteVisit: { lifecycleStatus: { in: CLIENT_VISIBLE_LIFECYCLE } },
};

/** Defects raised by a survey the client may see — same gate as the counts. */
const SURVEYED_DEFECT_SOURCE = {
  isDefect: true,
  inspection: SURVEYED_INSPECTION,
} as const;


type ProgressGroup = {
  id: string;
  name: string;
  /** Poles registered under this group (the denominator we can honestly claim). */
  total: number;
  /** Poles surveyed — see {@link SURVEYED_INSPECTION} (submitted AND the
   *  survey completed). */
  inspected: number;
  /** 0-100, rounded. */
  percent: number;
  openDefects: number;
  emergency: number;
};

/**
 * Read-only progress reporting for the network OWNER (TNB / a CLIENT org).
 *
 * ⚠ Scope is by MAINHEAD, not by team or company: the client sees every survey
 * on the Mainheads assigned to their organization, whichever contractor did the
 * work. `ScopeContext.clientMainheadIds` fails closed — an org with no
 * assignment sees nothing.
 *
 * ⚠ DENOMINATOR CAVEAT: ASCURE only knows a pole once a crew has registered it,
 * so `total` is "poles known in your Mainheads", NOT "every pole you own". Until
 * the full asset register is imported the UI must say so rather than imply
 * whole-network coverage.
 */
@Injectable()
export class ClientProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the caller's client scope, rejecting anyone who is not a client
   * viewer. ADMIN is allowed through (scoped to nothing extra) so the team can
   * see what the client sees without a second account.
   */
  private async requireClientScope(user: RequestUser): Promise<{
    ctx: ScopeContext;
    mainheadIds: string[] | null;
  }> {
    const ctx = await buildScopeContext(this.prisma, user);

    if (ctx.isAdmin) {
      // null = no Mainhead restriction (tenant-wide), for previewing the view.
      return { ctx, mainheadIds: null };
    }

    if (!ctx.isClientViewer) {
      throw new ForbiddenException(
        'This view is only available to a client organization.',
      );
    }

    return { ctx, mainheadIds: ctx.clientMainheadIds };
  }

  /** Assets in the client's scope — the base filter every rollup builds on. */
  private assetScope(
    user: RequestUser,
    mainheadIds: string[] | null,
  ): Prisma.AssetWhereInput {
    if (mainheadIds === null) {
      return { tenantId: user.tenantId };
    }
    // A pole belongs to the client's network when its Pencawang sits under one
    // of their Mainheads. Substation.mainheadId is kept current by the check-in
    // self-heal + the admin Pencawang→Mainhead assignment.
    return {
      tenantId: user.tenantId,
      substation: { mainheadId: { in: mainheadIds } },
    };
  }

  /**
   * Headline coverage + a breakdown by Mainhead, optionally drilled into one
   * Mainhead's Pencawang. This is the client's "how far along are you" view.
   */
  async getProgress(user: RequestUser, mainheadId?: string) {
    const { mainheadIds } = await this.requireClientScope(user);

    // Drilling into a Mainhead the client isn't assigned = empty, not an error:
    // the UI can't offer it, so this only trips on a hand-crafted request.
    if (mainheadId && mainheadIds !== null && !mainheadIds.includes(mainheadId)) {
      throw new ForbiddenException('That Mainhead is not in your scope.');
    }

    const base = this.assetScope(user, mainheadIds);
    const where: Prisma.AssetWhereInput = mainheadId
      ? { ...base, substation: { mainheadId } }
      : base;

    const [total, inspected, groups, defects, lastActivity] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.count({
        where: { ...where, inspections: { some: SURVEYED_INSPECTION } },
      }),
      mainheadId
        ? this.groupByPencawang(where)
        : this.groupByMainhead(user, mainheadIds),
      this.defectSummary(where),
      this.prisma.inspection.findFirst({
        where: { asset: where, ...SURVEYED_INSPECTION },
        orderBy: { submittedAt: 'desc' },
        select: { submittedAt: true },
      }),
    ]);

    return {
      level: mainheadId ? ('pencawang' as const) : ('mainhead' as const),
      mainheadId: mainheadId ?? null,
      total,
      inspected,
      percent: total > 0 ? Math.round((inspected / total) * 100) : 0,
      lastInspectionAt: lastActivity?.submittedAt?.toISOString() ?? null,
      groups,
      defects,
    };
  }

  /** Per-Mainhead rollup across everything in scope. */
  private async groupByMainhead(
    user: RequestUser,
    mainheadIds: string[] | null,
  ): Promise<ProgressGroup[]> {
    const mainheads = await this.prisma.mainhead.findMany({
      where: {
        isActive: true,
        ...(mainheadIds === null ? {} : { id: { in: mainheadIds } }),
        // Only Mainheads that actually hold poles — an empty one is noise.
        substations: { some: { assets: { some: {} } } },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return Promise.all(
      mainheads.map(async (mainhead) => {
        const where: Prisma.AssetWhereInput = {
          tenantId: user.tenantId,
          substation: { mainheadId: mainhead.id },
        };
        return {
          id: mainhead.id,
          name: mainhead.name,
          ...(await this.rollup(where)),
        };
      }),
    );
  }

  /** Per-Pencawang rollup inside one Mainhead. */
  private async groupByPencawang(
    scope: Prisma.AssetWhereInput,
  ): Promise<ProgressGroup[]> {
    const substations = await this.prisma.substation.findMany({
      where: { assets: { some: scope } },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });

    return Promise.all(
      substations.map(async (substation) => ({
        id: substation.id,
        name: substation.name || substation.code || '—',
        ...(await this.rollup({ ...scope, substationId: substation.id })),
      })),
    );
  }

  /** Shared count/inspected/defect rollup for one group's asset filter. */
  private async rollup(
    where: Prisma.AssetWhereInput,
  ): Promise<Omit<ProgressGroup, 'id' | 'name'>> {
    const [total, inspected, defectRows] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.count({
        where: { ...where, inspections: { some: SURVEYED_INSPECTION } },
      }),
      this.prisma.defect.findMany({
        where: {
          status: { in: [...OPEN_DEFECT_STATUSES] },
          inspectionItemResult: {
            ...SURVEYED_DEFECT_SOURCE,
            inspection: { ...SURVEYED_INSPECTION, asset: where },
          },
        },
        select: { isEmergency: true },
      }),
    ]);

    return {
      total,
      inspected,
      percent: total > 0 ? Math.round((inspected / total) * 100) : 0,
      openDefects: defectRows.length,
      emergency: defectRows.filter((row) => row.isEmergency).length,
    };
  }

  /** What was found: open defects split by severity and by work category. */
  private async defectSummary(scope: Prisma.AssetWhereInput) {
    const rows = await this.prisma.defect.findMany({
      where: {
        status: { in: [...OPEN_DEFECT_STATUSES] },
        inspectionItemResult: {
          ...SURVEYED_DEFECT_SOURCE,
          inspection: { ...SURVEYED_INSPECTION, asset: scope },
        },
      },
      select: { severity: true, maintenanceCategory: true, isEmergency: true },
    });

    const bySeverity = new Map<string, number>();
    const byCategory = new Map<string, number>();
    for (const row of rows) {
      const severity = row.severity ?? 'UNSPECIFIED';
      bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
      const category = row.maintenanceCategory ?? 'SELENGGARAAN';
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    }

    return {
      open: rows.length,
      emergency: rows.filter((row) => row.isEmergency).length,
      bySeverity: Array.from(bySeverity, ([label, value]) => ({ label, value })),
      byCategory: Array.from(byCategory, ([label, value]) => ({ label, value })),
    };
  }

  /**
   * Poles in one Pencawang the client may open evidence for — SUBMITTED
   * inspections on surveys the crew has finished ({@link
   * CLIENT_VISIBLE_LIFECYCLE}), so work-in-progress never surfaces.
   */
  async listPoles(user: RequestUser, substationId: string) {
    const { ctx, mainheadIds } = await this.requireClientScope(user);

    const substation = await this.prisma.substation.findFirst({
      where: {
        id: substationId,
        tenantId: user.tenantId,
        ...(mainheadIds === null ? {} : { mainheadId: { in: mainheadIds } }),
      },
      select: { id: true, name: true, code: true, mainheadId: true },
    });

    if (!substation) {
      throw new ForbiddenException('That Pencawang is not in your scope.');
    }

    const assets = await this.prisma.asset.findMany({
      where: {
        tenantId: user.tenantId,
        substationId: substation.id,
        inspections: {
          some: {
            completionStatus: InspectionCompletionStatus.SUBMITTED,
            siteVisit: { lifecycleStatus: { in: CLIENT_VISIBLE_LIFECYCLE } },
          },
        },
      },
      select: {
        id: true,
        assetCode: true,
        name: true,
        latitude: true,
        longitude: true,
        inspections: {
          where: { completionStatus: InspectionCompletionStatus.SUBMITTED },
          orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            submittedAt: true,
            siteVisit: { select: { lifecycleStatus: true } },
            itemResults: {
              where: { isDefect: true },
              select: { id: true, label: true, severity: true },
            },
            _count: { select: { inspectionImages: true } },
          },
        },
      },
      orderBy: { assetCode: 'asc' },
      take: 500,
    });

    return {
      substation: {
        id: substation.id,
        name: substation.name || substation.code || '—',
      },
      // Kept so an ADMIN previewing the view sees the same shape a client does.
      isClientView: !ctx.isAdmin,
      poles: assets.map((asset) => {
        const latest = asset.inspections[0];
        return {
          id: asset.id,
          assetCode: asset.assetCode,
          name: asset.name,
          latitude: asset.latitude,
          longitude: asset.longitude,
          inspectionId: latest?.id ?? null,
          inspectedAt: latest?.submittedAt?.toISOString() ?? null,
          lifecycleStatus: latest?.siteVisit?.lifecycleStatus ?? null,
          photoCount: latest?._count.inspectionImages ?? 0,
          defects:
            latest?.itemResults.map((item) => ({
              id: item.id,
              label: item.label,
              severity: item.severity,
            })) ?? [],
        };
      }),
    };
  }

  /**
   * Guard for the client's evidence drill-down: the pole must sit in their
   * Mainheads AND its latest survey must have left the field. Returns the asset
   * id so the caller can reuse the normal asset-detail read.
   */
  async assertPoleVisible(user: RequestUser, assetId: string): Promise<void> {
    const { mainheadIds } = await this.requireClientScope(user);

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: assetId,
        tenantId: user.tenantId,
        ...(mainheadIds === null
          ? {}
          : { substation: { mainheadId: { in: mainheadIds } } }),
        inspections: {
          some: {
            completionStatus: InspectionCompletionStatus.SUBMITTED,
            siteVisit: { lifecycleStatus: { in: CLIENT_VISIBLE_LIFECYCLE } },
          },
        },
      },
      select: { id: true },
    });

    if (!asset) {
      throw new ForbiddenException(
        'That pole is not available in your scope yet.',
      );
    }
  }

  /** The Mainheads assigned to the client's organization (for the filter bar). */
  async listMainheads(user: RequestUser) {
    const { mainheadIds } = await this.requireClientScope(user);

    const mainheads = await this.prisma.mainhead.findMany({
      where: {
        isActive: true,
        ...(mainheadIds === null ? {} : { id: { in: mainheadIds } }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    return mainheads;
  }

  /**
   * Recently completed surveys in scope — the client's "what happened lately"
   * feed. Same lifecycle gate as the evidence view.
   */
  async listRecentSurveys(user: RequestUser) {
    const { ctx } = await this.requireClientScope(user);
    const scopeWhere = siteVisitAccessWhere(user, ctx);

    const visits = await this.prisma.siteVisit.findMany({
      where: {
        ...scopeWhere,
        tenantId: user.tenantId,
        lifecycleStatus: { in: CLIENT_VISIBLE_LIFECYCLE },
      },
      orderBy: [{ completedAt: 'desc' }, { endedAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        lifecycleStatus: true,
        completedAt: true,
        endedAt: true,
        substation: { select: { id: true, name: true, code: true } },
        // `mainhead` is a legacy free-text column; the relation is mainheadRecord.
        mainheadRecord: { select: { id: true, name: true } },
        _count: { select: { visitAssets: true } },
      },
    });

    return visits.map((visit) => ({
      id: visit.id,
      pencawang: visit.substation?.name || visit.substation?.code || '—',
      pencawangId: visit.substation?.id ?? null,
      mainhead: visit.mainheadRecord?.name ?? '—',
      lifecycleStatus: visit.lifecycleStatus,
      completedAt:
        (visit.completedAt ?? visit.endedAt)?.toISOString() ?? null,
      poleCount: visit._count.visitAssets,
    }));
  }
}
