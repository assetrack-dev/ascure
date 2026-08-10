import { ForbiddenException, Injectable } from '@nestjs/common';
import { InspectionCompletionStatus, Prisma } from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import { siteVisitAccessWhere } from '../common/authorization/site-visit-scope';
import { isSurveyFinished } from '../common/client-visibility';

/** Open defect statuses — mirrors the map/dashboard definition of "open". */
const OPEN_DEFECT_STATUSES = ['OPEN', 'IN_PROGRESS', 'MONITORING'] as const;

/** Poles returned for one Pencawang / one visit before the list is truncated.
 *  The response reports the true total so the UI never implies it showed all. */
const POLE_PAGE_SIZE = 1000;

/** Surveys returned by the visits list. */
const VISIT_PAGE_SIZE = 200;

/**
 * What "surveyed" means to a client: the crew has SUBMITTED the pole's
 * inspection. The survey it belongs to need not have left the field.
 *
 * ⚠ ONE definition for the whole view — coverage, the group roll-ups and the
 * pole lists all filter on this, so the headline and the drill-down can never
 * contradict each other.
 *
 * ⚠ HISTORY: this used to additionally require the survey to have reached
 * RONDAAN_SELESAI or later, because a client could only SEE finished work and a
 * Pencawang that read 44/44 = 100% opened to "no completed surveys yet". The
 * owner opened the client view to every status on 2026-08-10, so that
 * contradiction is gone the other way: in-field poles are now visible AND
 * counted, and the lifecycle is shown per row instead of gating the row.
 */
const SURVEYED_INSPECTION: Prisma.InspectionWhereInput = {
  completionStatus: InspectionCompletionStatus.SUBMITTED,
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

    const [total, inspected, groups, defects, lastActivity, pencawang] =
      await Promise.all([
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
        this.pencawangSummary(where),
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
      pencawang,
    };
  }

  /**
   * How many Pencawang the client has, and how many are FINISHED — every pole
   * recorded there surveyed. "How many substations are done" is the question a
   * network owner actually asks; a pole percentage hides that one Pencawang at
   * 40% is a site someone still has to go back to.
   *
   * ⚠ Two groupBy queries, NOT one rollup per Pencawang — this runs at every
   * drill level, and a per-Pencawang loop would be N+1 over a Mainhead that can
   * hold a hundred of them.
   */
  private async pencawangSummary(scope: Prisma.AssetWhereInput) {
    const [totals, surveyed] = await Promise.all([
      this.prisma.asset.groupBy({
        by: ['substationId'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({
        by: ['substationId'],
        // AND, not a spread: `scope` is caller-supplied and may grow keys.
        where: { AND: [scope, { inspections: { some: SURVEYED_INSPECTION } }] },
        _count: { _all: true },
      }),
    ]);

    const surveyedBySubstation = new Map(
      surveyed.map((row) => [row.substationId, row._count._all]),
    );

    // A Pencawang with no poles recorded isn't in `totals` at all, so it can
    // never be miscounted as "complete" on an empty denominator.
    const completed = totals.filter(
      (row) => (surveyedBySubstation.get(row.substationId) ?? 0) >= row._count._all,
    ).length;

    return {
      total: totals.length,
      completed,
      percent:
        totals.length > 0 ? Math.round((completed / totals.length) * 100) : 0,
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

  /** The pole row every client list returns — see {@link toClientPole}. */
  private static readonly POLE_SELECT = {
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
        siteVisit: { select: { id: true, lifecycleStatus: true } },
        itemResults: {
          where: { isDefect: true },
          select: { id: true, label: true, severity: true },
        },
        _count: { select: { inspectionImages: true } },
      },
    },
  } satisfies Prisma.AssetSelect;

  /**
   * Shape one pole for the client, from its LATEST submitted inspection.
   *
   * `surveyState` is what the UI chips on: NOT_SURVEYED (nobody has submitted
   * this pole yet — a registered pole with no work) vs SURVEYED. `isFinished`
   * then splits a surveyed pole into settled work vs a survey still in the
   * field, so the client can tell "done" from "being walked right now" without
   * either being hidden from them.
   */
  private toClientPole(
    asset: Prisma.AssetGetPayload<{
      select: typeof ClientProgressService.POLE_SELECT;
    }>,
  ) {
    const latest = asset.inspections[0];
    const lifecycleStatus = latest?.siteVisit?.lifecycleStatus ?? null;

    return {
      id: asset.id,
      assetCode: asset.assetCode,
      name: asset.name,
      latitude: asset.latitude,
      longitude: asset.longitude,
      inspectionId: latest?.id ?? null,
      inspectedAt: latest?.submittedAt?.toISOString() ?? null,
      visitId: latest?.siteVisit?.id ?? null,
      lifecycleStatus,
      surveyState: latest ? ('SURVEYED' as const) : ('NOT_SURVEYED' as const),
      isFinished: isSurveyFinished(lifecycleStatus),
      photoCount: latest?._count.inspectionImages ?? 0,
      defects:
        latest?.itemResults.map((item) => ({
          id: item.id,
          label: item.label,
          severity: item.severity,
        })) ?? [],
    };
  }

  /**
   * EVERY pole in one Pencawang — surveyed or not, at any lifecycle stage.
   *
   * ⚠ This used to return only poles whose survey had left the field. The client
   * owns the network, so an untouched pole is as much their business as a
   * finished one; each row now carries `surveyState` + `lifecycleStatus` so the
   * UI says WHICH state a pole is in instead of dropping it from the list.
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

    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      substationId: substation.id,
    };

    const [total, assets] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        select: ClientProgressService.POLE_SELECT,
        orderBy: { assetCode: 'asc' },
        take: POLE_PAGE_SIZE,
      }),
    ]);

    return {
      substation: {
        id: substation.id,
        name: substation.name || substation.code || '—',
      },
      // Kept so an ADMIN previewing the view sees the same shape a client does.
      isClientView: !ctx.isAdmin,
      /** True count in the Pencawang — `poles` may be truncated to the page size. */
      total,
      poles: assets.map((asset) => this.toClientPole(asset)),
    };
  }

  /**
   * Guard for the client's pole drill-down: the pole must sit in one of their
   * assigned Mainheads. ⚠ No lifecycle condition — the client sees their network
   * at every stage; scope is the only boundary, and it still fails closed.
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
      },
      select: { id: true },
    });

    if (!asset) {
      throw new ForbiddenException('That pole is not in your scope.');
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

  /** The survey row every client visit list returns — see {@link toClientVisit}. */
  private static readonly VISIT_SELECT = {
    id: true,
    lifecycleStatus: true,
    startedAt: true,
    completedAt: true,
    endedAt: true,
    substation: {
      select: {
        id: true,
        name: true,
        code: true,
        // Fallback for the Mainhead label — see toClientVisit.
        mainhead: { select: { id: true, name: true } },
      },
    },
    // `mainhead` is a legacy free-text column; the relation is mainheadRecord.
    mainheadRecord: { select: { id: true, name: true } },
    _count: { select: { visitAssets: true } },
  } satisfies Prisma.SiteVisitSelect;

  /**
   * Shape one survey for the client.
   *
   * ⚠ NO ATTRIBUTION: the contractor org / crew that walked the survey is
   * deliberately absent (owner's call, 2026-08-10). The client sees WHAT was
   * done on their network, not WHO did it — keep it that way if this grows.
   *
   * `poleCount` takes the larger of the linked poles and the surveyed ones so a
   * visit whose SiteVisitAsset links are incomplete can never read "45 of 44".
   */
  private toClientVisit(
    visit: Prisma.SiteVisitGetPayload<{
      select: typeof ClientProgressService.VISIT_SELECT;
    }>,
    surveyedByVisit: Map<string, number>,
    defectsByVisit: Map<string, { open: number; emergency: number }>,
  ) {
    const surveyed = surveyedByVisit.get(visit.id) ?? 0;
    const linked = visit._count.visitAssets;
    const defects = defectsByVisit.get(visit.id) ?? { open: 0, emergency: 0 };
    // ⚠ SiteVisit.mainheadId is nullable and is only stamped at check-in, so fall
    // back to the Pencawang's Mainhead — the same link the client scope matches
    // on. Without this an in-scope survey renders a bare "—" for its Mainhead.
    const mainhead = visit.mainheadRecord ?? visit.substation?.mainhead ?? null;

    return {
      id: visit.id,
      pencawang: visit.substation?.name || visit.substation?.code || '—',
      pencawangId: visit.substation?.id ?? null,
      mainhead: mainhead?.name ?? '—',
      mainheadId: mainhead?.id ?? null,
      lifecycleStatus: visit.lifecycleStatus,
      isFinished: isSurveyFinished(visit.lifecycleStatus),
      startedAt: visit.startedAt?.toISOString() ?? null,
      completedAt: (visit.completedAt ?? visit.endedAt)?.toISOString() ?? null,
      poleCount: Math.max(linked, surveyed),
      surveyedCount: surveyed,
      openDefects: defects.open,
      emergency: defects.emergency,
    };
  }

  /** Per-visit surveyed-pole and open-defect tallies for a page of visits. */
  private async visitTallies(visitIds: string[]) {
    if (visitIds.length === 0) {
      return {
        surveyedByVisit: new Map<string, number>(),
        defectsByVisit: new Map<string, { open: number; emergency: number }>(),
      };
    }

    const [submitted, defectRows] = await Promise.all([
      this.prisma.inspection.groupBy({
        by: ['siteVisitId'],
        where: { siteVisitId: { in: visitIds }, ...SURVEYED_INSPECTION },
        _count: { _all: true },
      }),
      this.prisma.defect.findMany({
        where: {
          status: { in: [...OPEN_DEFECT_STATUSES] },
          inspectionItemResult: {
            ...SURVEYED_DEFECT_SOURCE,
            inspection: { ...SURVEYED_INSPECTION, siteVisitId: { in: visitIds } },
          },
        },
        select: {
          isEmergency: true,
          inspectionItemResult: {
            select: { inspection: { select: { siteVisitId: true } } },
          },
        },
      }),
    ]);

    const defectsByVisit = new Map<string, { open: number; emergency: number }>();
    for (const row of defectRows) {
      const key = row.inspectionItemResult.inspection.siteVisitId;
      const entry = defectsByVisit.get(key) ?? { open: 0, emergency: 0 };
      entry.open += 1;
      if (row.isEmergency) entry.emergency += 1;
      defectsByVisit.set(key, entry);
    }

    return {
      surveyedByVisit: new Map(
        submitted.map((row) => [row.siteVisitId, row._count._all]),
      ),
      defectsByVisit,
    };
  }

  /**
   * Surveys on the client's network, newest first.
   *
   * ⚠ EVERY lifecycle status — work still being walked included. The row carries
   * `lifecycleStatus` + `isFinished` so the UI LABELS in-field work rather than
   * hiding it (owner's call, 2026-08-10).
   */
  async listVisits(
    user: RequestUser,
    mainheadId?: string,
    take = VISIT_PAGE_SIZE,
  ) {
    const { ctx, mainheadIds } = await this.requireClientScope(user);

    if (mainheadId && mainheadIds !== null && !mainheadIds.includes(mainheadId)) {
      throw new ForbiddenException('That Mainhead is not in your scope.');
    }

    // ⚠ AND, never two spreads of the same key: the client scope and the
    // Mainhead filter BOTH constrain `mainheadId`, and spreading them would let
    // the filter silently REPLACE the scope — the exact bug that once showed a
    // TNB user an unassigned Mainhead on the map.
    const where: Prisma.SiteVisitWhereInput = {
      AND: [
        siteVisitAccessWhere(user, ctx),
        { tenantId: user.tenantId },
        // Same two branches as the client scope itself — a visit whose own
        // mainheadId was never stamped is still THIS Mainhead's if its Pencawang
        // is (see the client branch in buildSiteVisitScope).
        ...(mainheadId
          ? [{ OR: [{ mainheadId }, { substation: { mainheadId } }] }]
          : []),
      ],
    };

    const [total, visits] = await Promise.all([
      this.prisma.siteVisit.count({ where }),
      this.prisma.siteVisit.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }],
        take: Math.min(take, VISIT_PAGE_SIZE),
        select: ClientProgressService.VISIT_SELECT,
      }),
    ]);

    const { surveyedByVisit, defectsByVisit } = await this.visitTallies(
      visits.map((visit) => visit.id),
    );

    return {
      /** True count in scope — `visits` is truncated to the page size. */
      total,
      visits: visits.map((visit) =>
        this.toClientVisit(visit, surveyedByVisit, defectsByVisit),
      ),
    };
  }

  /** One survey and the poles it covers, at any lifecycle stage. */
  async getVisit(user: RequestUser, visitId: string) {
    const { ctx } = await this.requireClientScope(user);

    const visit = await this.prisma.siteVisit.findFirst({
      where: {
        AND: [
          siteVisitAccessWhere(user, ctx),
          { id: visitId, tenantId: user.tenantId },
        ],
      },
      select: ClientProgressService.VISIT_SELECT,
    });

    if (!visit) {
      throw new ForbiddenException('That survey is not in your scope.');
    }

    // A pole belongs to a survey three ways: linked to it, registered during it,
    // or inspected on it. Older visits predate one or another of those, so take
    // the union rather than trusting any single link.
    const where: Prisma.AssetWhereInput = {
      tenantId: user.tenantId,
      OR: [
        { siteVisitAssets: { some: { siteVisitId: visit.id } } },
        { createdDuringVisitId: visit.id },
        { inspections: { some: { siteVisitId: visit.id } } },
      ],
    };

    const [total, assets, tallies] = await Promise.all([
      this.prisma.asset.count({ where }),
      this.prisma.asset.findMany({
        where,
        select: ClientProgressService.POLE_SELECT,
        orderBy: { assetCode: 'asc' },
        take: POLE_PAGE_SIZE,
      }),
      this.visitTallies([visit.id]),
    ]);

    return {
      visit: this.toClientVisit(
        visit,
        tallies.surveyedByVisit,
        tallies.defectsByVisit,
      ),
      /** True pole count on the survey — `poles` is truncated to the page size. */
      total,
      poles: assets.map((asset) => this.toClientPole(asset)),
    };
  }

  /**
   * The latest surveys in scope — the Progress page's "what's happening" feed.
   * A thin wrapper over {@link listVisits} so the two can never disagree.
   */
  async listRecentSurveys(user: RequestUser) {
    const { visits } = await this.listVisits(user, undefined, 20);
    return visits;
  }
}
