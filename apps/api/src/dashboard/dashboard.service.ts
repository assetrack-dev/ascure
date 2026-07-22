import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DefectSeverity,
  DefectStatus,
  InspectionCompletionStatus,
  MaintenanceCategory,
  OrganizationCapabilityType,
  Prisma,
  SiteVisitStatus,
  SiteVisitType,
  SiteVisitValidationStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { APPSHEET_IMPORT_REPORTING_GROUP_PREFIX } from '../common/import.constants';
import { buildInitialDefectData } from '../defects/defect-materialization.util';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import { siteVisitOversightWhere } from '../common/authorization/site-visit-scope';
import {
  calculateOperationalHealthStatus,
  parseOperationalOverdueThresholdHours,
} from '../common/operational-health';
import { PrismaService } from '../prisma/prisma.service';
import {
  DashboardRangeKey,
  GetDashboardQueryDto,
} from './dto/get-dashboard-query.dto';

const RANGE_LABELS: Record<DashboardRangeKey, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  ytd: 'year to date',
};

const ACTIVE_SLA_STATUSES = [
  DefectStatus.OPEN,
  DefectStatus.IN_PROGRESS,
  DefectStatus.MONITORING,
] as const;

type DefectSlaState = 'OVERDUE' | 'ON_TRACK' | 'NO_DUE_DATE' | 'STOPPED';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getDashboard(user: RequestUser, query?: GetDashboardQueryDto) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defectWhere = this.accessibleDefectWhere(user, ctx);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();
    const activeVisitCutoff = new Date(
      now.getTime() - overdueThresholdHours * 60 * 60 * 1000,
    );
    const { start: reportingTodayStart, end: reportingTodayEnd } =
      this.reportingDayBounds(now);
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Additive time-range windowing. All EXISTING response fields stay unwindowed
    // (mobile + admin read them as all-time). The `range`, `*ThisPeriod`,
    // `defectFlow`, and delta fields are the only range-scoped additions. When no
    // `range` is supplied the new fields default to 30d, and the trend keeps its
    // historical 7-day length so the no-param response is byte-compatible.
    const rangeKey = query?.range ?? '30d';
    const rangeDays = this.rangeDaysFor(rangeKey, reportingTodayStart, now);
    const rangeStart = new Date(
      reportingTodayStart.getTime() - (rangeDays - 1) * DAY_MS,
    );
    const rangeEnd = reportingTodayEnd;
    const prevStart = new Date(rangeStart.getTime() - rangeDays * DAY_MS);
    const prevEnd = rangeStart;

    // The trend follows the range only when the caller asked for one.
    const trendDays = query?.range ? rangeDays : 7;
    const trendWindowStart = new Date(
      reportingTodayStart.getTime() - (trendDays - 1) * DAY_MS,
    );

    const overdueDefectWhere: Prisma.DefectWhereInput = {
      ...defectWhere,
      status: {
        in: [...ACTIVE_SLA_STATUSES],
      },
      dueDate: {
        lt: now,
      },
    };
    const criticalOverdueDefectWhere: Prisma.DefectWhereInput = {
      ...overdueDefectWhere,
      severity: DefectSeverity.CRITICAL,
    };
    // Emergency predicates — share the scoped defectWhere so tenant + routed-pool
    // scoping is preserved. "Unassigned" uses assignedUserId/assignedTeamId (the
    // pair the dashboard already groups on; defects.service writes both pairs in
    // lockstep).
    const emergencyOpenWhere: Prisma.DefectWhereInput = {
      ...defectWhere,
      isEmergency: true,
      status: { not: DefectStatus.CLOSED },
    };
    const emergencyUnassignedWhere: Prisma.DefectWhereInput = {
      ...emergencyOpenWhere,
      assignedUserId: null,
      assignedTeamId: null,
    };
    const emergencyOverdueWhere: Prisma.DefectWhereInput = {
      ...defectWhere,
      isEmergency: true,
      status: { in: [...ACTIVE_SLA_STATUSES] },
      dueDate: { lt: now },
    };

    const [
      totalAssets,
      totalInspections,
      defectStatusCounts,
      defectSeverityCounts,
      recentDefectRows,
      overdueDefectCount,
      criticalOverdueDefectCount,
      defectAssigneeCounts,
      defectTeamCounts,
      defectsForSlaState,
      criticalOverdueItems,
      siteVisitStatusCounts,
      siteVisitValidationCounts,
      siteVisitTypeCounts,
      activeSiteVisitCount,
      completedSiteVisitCount,
      overdueSiteVisitCount,
      activeFieldTeamCounts,
      activeFieldTeams,
      siteVisitsForHealth,
      latestSiteVisitActivity,
      activeMappedVisitCount,
      assetsForMainhead,
      orgForPersona,
      defectCategoryCounts,
      trendInspections,
      periodInspections,
      prevPeriodInspections,
      emergencyOpenCount,
      emergencyUnassignedCount,
      emergencyOverdueCount,
      defectFlowRows,
      assetSubstationCounts,
      assetsInScopePrevCount,
      emergencyOverduePrevCount,
    ] = await Promise.all([
      this.prisma.asset.count({
        where: this.accessibleAssetWhere(user, ctx),
      }),
      this.prisma.inspection.count({
        where: this.accessibleInspectionWhere(user, ctx),
      }),
      this.prisma.defect.groupBy({
        by: ['status'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.groupBy({
        by: ['severity'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      // Read from the Defect table (not inspectionItemResult) so recent defects
      // honour defectWhere — a maintenance company sees its routed pool here too.
      this.prisma.defect.findMany({
        where: defectWhere,
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        select: {
          id: true,
          status: true,
          severity: true,
          dueDate: true,
          maintenanceCategory: true,
          assignedUser: {
            select: {
              name: true,
              email: true,
            },
          },
          assignedTeam: {
            select: {
              name: true,
              code: true,
            },
          },
          inspectionItemResult: {
            select: {
              label: true,
              createdAt: true,
              inspection: {
                select: {
                  asset: {
                    select: {
                      assetCode: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.defect.count({
        where: overdueDefectWhere,
      }),
      this.prisma.defect.count({
        where: criticalOverdueDefectWhere,
      }),
      this.prisma.defect.groupBy({
        by: ['assignedUserId'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.groupBy({
        by: ['assignedTeamId'],
        where: defectWhere,
        _count: {
          _all: true,
        },
      }),
      this.prisma.defect.findMany({
        where: defectWhere,
        select: {
          status: true,
          dueDate: true,
          createdAt: true,
          resolvedAt: true,
          closedAt: true,
        },
      }),
      this.prisma.defect.findMany({
        where: criticalOverdueDefectWhere,
        orderBy: [
          {
            dueDate: 'asc',
          },
          {
            createdAt: 'asc',
          },
        ],
        take: 5,
        select: {
          id: true,
          status: true,
          severity: true,
          dueDate: true,
          maintenanceCategory: true,
          assignedUser: {
            select: {
              name: true,
              email: true,
            },
          },
          assignedTeam: {
            select: {
              name: true,
              code: true,
            },
          },
          inspectionItemResult: {
            select: {
              label: true,
              inspection: {
                select: {
                  asset: {
                    select: {
                      assetCode: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.siteVisit.groupBy({
        by: ['status'],
        where: this.accessibleSiteVisitWhere(user, ctx),
        _count: {
          _all: true,
        },
      }),
      this.prisma.siteVisit.groupBy({
        by: ['validationStatus'],
        where: this.accessibleSiteVisitWhere(user, ctx),
        _count: {
          _all: true,
        },
      }),
      this.prisma.siteVisit.groupBy({
        by: ['visitType'],
        where: this.accessibleSiteVisitWhere(user, ctx),
        _count: {
          _all: true,
        },
      }),
      this.prisma.siteVisit.count({
        where: {
          ...this.accessibleSiteVisitWhere(user, ctx),
          status: {
            in: this.activeSiteVisitStatuses(),
          },
        },
      }),
      this.prisma.siteVisit.count({
        where: {
          ...this.accessibleSiteVisitWhere(user, ctx),
          status: SiteVisitStatus.COMPLETED,
        },
      }),
      this.prisma.siteVisit.count({
        where: {
          ...this.accessibleSiteVisitWhere(user, ctx),
          status: {
            in: this.activeSiteVisitStatuses(),
          },
          startedAt: {
            lt: activeVisitCutoff,
          },
        },
      }),
      this.prisma.siteVisit.groupBy({
        by: ['teamId'],
        where: {
          ...this.accessibleSiteVisitWhere(user, ctx),
          status: {
            in: this.activeSiteVisitStatuses(),
          },
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.team.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          ...this.teamAccessWhere(user, ctx),
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
      this.prisma.siteVisit.findMany({
        where: this.accessibleSiteVisitWhere(user, ctx),
        select: {
          status: true,
          validationStatus: true,
          startedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.siteVisit.aggregate({
        where: this.accessibleSiteVisitWhere(user, ctx),
        _max: {
          updatedAt: true,
        },
      }),
      this.prisma.siteVisit.count({
        where: {
          ...this.accessibleSiteVisitWhere(user, ctx),
          status: {
            in: this.activeSiteVisitStatuses(),
          },
          checkInLatitude: {
            not: null,
          },
          checkInLongitude: {
            not: null,
          },
        },
      }),
      // Assets carry no mainhead column, so attribute each to the mainhead of its
      // latest SUBMITTED inspection's site visit, falling back to its creation
      // visit (mirrors AssetsService.loadMapAssets). Light select — id + the two
      // candidate mainhead refs — tallied in JS below.
      this.prisma.asset.findMany({
        where: this.accessibleAssetWhere(user, ctx),
        select: {
          id: true,
          createdDuringVisit: {
            select: { mainheadRecord: { select: { id: true, name: true } } },
          },
          inspections: {
            where: {
              completionStatus: InspectionCompletionStatus.SUBMITTED,
            },
            take: 1,
            orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
            select: {
              siteVisit: {
                select: { mainheadRecord: { select: { id: true, name: true } } },
              },
            },
          },
        },
      }),
      // Persona classification — the caller's org type + active capabilities tell
      // us whether they do field work (SURVEY/INSPECTION) or maintenance
      // (MAINTENANCE/REPAIR), so the dashboard can lead with the right sections.
      user.organizationId
        ? this.prisma.organization.findUnique({
            where: { id: user.organizationId },
            select: {
              name: true,
              type: true,
              capabilities: {
                where: { isActive: true },
                select: { capability: true },
              },
            },
          })
        : Promise.resolve(null),
      // Defects by maintenance category (routed work-type buckets).
      this.prisma.defect.groupBy({
        by: ['maintenanceCategory'],
        where: defectWhere,
        _count: { _all: true },
      }),
      // Rolling daily inspection throughput — submitted inspections in the window,
      // bucketed to distinct assets per reporting-day below.
      this.prisma.inspection.findMany({
        where: {
          ...this.accessibleInspectionWhere(user, ctx),
          completionStatus: InspectionCompletionStatus.SUBMITTED,
          submittedAt: { gte: trendWindowStart },
        },
        select: { assetId: true, submittedAt: true },
      }),
      // --- Additive range-scoped queries (see the range setup above) ---
      // Distinct assets inspected in the current window (period-scoped).
      this.prisma.inspection.findMany({
        where: {
          ...this.accessibleInspectionWhere(user, ctx),
          completionStatus: InspectionCompletionStatus.SUBMITTED,
          submittedAt: { gte: rangeStart, lt: rangeEnd },
        },
        select: { assetId: true },
      }),
      // …and the previous equal-length window, for the delta.
      this.prisma.inspection.findMany({
        where: {
          ...this.accessibleInspectionWhere(user, ctx),
          completionStatus: InspectionCompletionStatus.SUBMITTED,
          submittedAt: { gte: prevStart, lt: prevEnd },
        },
        select: { assetId: true },
      }),
      this.prisma.defect.count({ where: emergencyOpenWhere }),
      this.prisma.defect.count({ where: emergencyUnassignedWhere }),
      this.prisma.defect.count({ where: emergencyOverdueWhere }),
      // Defect intake vs. closure — every defect opened OR closed in the window.
      this.prisma.defect.findMany({
        where: {
          ...defectWhere,
          OR: [
            { createdAt: { gte: rangeStart, lt: rangeEnd } },
            { closedAt: { gte: rangeStart, lt: rangeEnd } },
            { resolvedAt: { gte: rangeStart, lt: rangeEnd } },
          ],
        },
        select: { createdAt: true, resolvedAt: true, closedAt: true },
      }),
      // Assets per substation (all-time, matching assetsByMainhead semantics).
      this.prisma.asset.groupBy({
        by: ['substationId'],
        where: this.accessibleAssetWhere(user, ctx),
        _count: { _all: true },
      }),
      // Assets in scope as-of the previous window end (delta baseline).
      this.prisma.asset.count({
        where: {
          ...this.accessibleAssetWhere(user, ctx),
          createdAt: { lt: prevEnd },
        },
      }),
      // Emergency+overdue as-of prevEnd — a timestamp reconstruction (no status
      // history exists), so it's "active as of date", not an audited snapshot.
      this.prisma.defect.count({
        where: {
          ...defectWhere,
          isEmergency: true,
          createdAt: { lt: prevEnd },
          dueDate: { lt: prevEnd },
          AND: [
            { OR: [{ closedAt: null }, { closedAt: { gte: prevEnd } }] },
            { OR: [{ resolvedAt: null }, { resolvedAt: { gte: prevEnd } }] },
          ],
        },
      }),
    ]);

    const [assignedUsers, assignedTeams, substationNames] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          id: {
            in: defectAssigneeCounts
              .map((entry) => entry.assignedUserId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: {
          id: true,
          email: true,
          name: true,
        },
      }),
      this.prisma.team.findMany({
        where: {
          tenantId: user.tenantId,
          id: {
            in: defectTeamCounts
              .map((entry) => entry.assignedTeamId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
        },
      }),
      this.prisma.substation.findMany({
        where: {
          tenantId: user.tenantId,
          id: {
            in: assetSubstationCounts
              .map((entry) => entry.substationId)
              .filter((id): id is string => Boolean(id)),
          },
        },
        select: { id: true, name: true, code: true },
      }),
    ]);

    const countsByStatus = new Map(
      defectStatusCounts.map((entry) => [entry.status, entry._count._all]),
    );
    const openDefects = countsByStatus.get(DefectStatus.OPEN) ?? 0;
    const inProgressDefects = countsByStatus.get(DefectStatus.IN_PROGRESS) ?? 0;
    const monitoringDefects = countsByStatus.get(DefectStatus.MONITORING) ?? 0;
    const resolvedDefects = countsByStatus.get(DefectStatus.RESOLVED) ?? 0;
    const closedDefects = countsByStatus.get(DefectStatus.CLOSED) ?? 0;
    const totalDefects = defectStatusCounts.reduce(
      (total, entry) => total + entry._count._all,
      0,
    );
    const countsBySeverity = new Map(
      defectSeverityCounts.map((entry) => [entry.severity, entry._count._all]),
    );
    const defectsBySeverity = [
      DefectSeverity.CRITICAL,
      DefectSeverity.HIGH,
      DefectSeverity.MEDIUM,
      DefectSeverity.LOW,
    ].map((severity) => ({
      label: severity,
      value: countsBySeverity.get(severity) ?? 0,
    }));
    const usersById = new Map(
      assignedUsers.map((assignedUser) => [
        assignedUser.id,
        assignedUser.name || assignedUser.email,
      ]),
    );
    const teamsById = new Map(
      assignedTeams.map((assignedTeam) => [
        assignedTeam.id,
        assignedTeam.name || assignedTeam.code,
      ]),
    );
    const defectsByAssignee = defectAssigneeCounts
      .map((entry) => ({
        label: entry.assignedUserId
          ? usersById.get(entry.assignedUserId) ?? 'Unknown user'
          : 'Unassigned',
        value: entry._count._all,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    const defectsByTeam = defectTeamCounts
      .map((entry) => ({
        label: entry.assignedTeamId
          ? teamsById.get(entry.assignedTeamId) ?? 'Unknown team'
          : 'Unassigned',
        value: entry._count._all,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    const slaCounts = defectsForSlaState.reduce(
      (counts, defect) => {
        const slaState = this.calculateSlaState(defect.status, defect.dueDate, now);

        counts.set(slaState, (counts.get(slaState) ?? 0) + 1);

        return counts;
      },
      new Map<DefectSlaState, number>(),
    );
    const defectsBySlaState = (
      ['OVERDUE', 'ON_TRACK', 'NO_DUE_DATE', 'STOPPED'] as DefectSlaState[]
    ).map((slaState) => ({
      label: this.formatSlaState(slaState),
      value: slaCounts.get(slaState) ?? 0,
    }));
    const visitsByStatus = this.siteVisitStatusLabels().map((status) => ({
      label: this.formatEnumLabel(status),
      value:
        siteVisitStatusCounts.find((entry) => entry.status === status)?._count._all ??
        0,
    }));
    const visitsByValidationStatus = this.siteVisitValidationLabels().map(
      (validationStatus) => ({
        label: this.formatEnumLabel(validationStatus),
        value:
          siteVisitValidationCounts.find(
            (entry) => entry.validationStatus === validationStatus,
          )?._count._all ?? 0,
      }),
    );
    const visitsByType = this.siteVisitTypeLabels().map((visitType) => ({
      label: this.formatEnumLabel(visitType),
      value:
        siteVisitTypeCounts.find((entry) => entry.visitType === visitType)?._count
          ._all ?? 0,
    }));
    const fieldTeamsById = new Map(
      activeFieldTeams.map((team) => [team.id, team.name || team.code]),
    );
    const activeVisitsByTeam = activeFieldTeamCounts
      .map((entry) => ({
        label: fieldTeamsById.get(entry.teamId) ?? 'Unknown team',
        value: entry._count._all,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
    const activeFieldTeamCount = activeFieldTeamCounts.length;
    const totalSiteVisits = siteVisitStatusCounts.reduce(
      (total, entry) => total + entry._count._all,
      0,
    );
    const cancelledSiteVisits =
      siteVisitStatusCounts.find((entry) => entry.status === SiteVisitStatus.CANCELLED)
        ?._count._all ?? 0;
    const completionDenominator = Math.max(totalSiteVisits - cancelledSiteVisits, 0);
    const completionRate =
      completionDenominator === 0
        ? 0
        : Math.round((completedSiteVisitCount / completionDenominator) * 100);
    const healthCounts = siteVisitsForHealth.reduce(
      (counts, siteVisit) => {
        const healthStatus = calculateOperationalHealthStatus({
          status: siteVisit.status,
          validationStatus: siteVisit.validationStatus,
          startedAt: siteVisit.startedAt,
          lastActivityAt: siteVisit.updatedAt,
          now,
          overdueThresholdHours,
        });

        counts.set(healthStatus, (counts.get(healthStatus) ?? 0) + 1);

        return counts;
      },
      new Map<string, number>(),
    );
    const visitsByOperationalHealth = ['HEALTHY', 'WARNING', 'CRITICAL'].map(
      (status) => ({
        label: this.formatEnumLabel(status),
        value: healthCounts.get(status) ?? 0,
      }),
    );
    // Total assets by MAINHEAD. Keyed by mainhead id so same-named mainheads
    // don't merge; assets with no resolvable mainhead bucket under "Unassigned".
    const assetMainheadBuckets = new Map<
      string,
      { label: string; value: number }
    >();
    for (const asset of assetsForMainhead) {
      const visit =
        asset.inspections[0]?.siteVisit ?? asset.createdDuringVisit ?? null;
      const mainhead = visit?.mainheadRecord ?? null;
      const key = mainhead?.id ?? 'unassigned';
      const label = mainhead?.name?.trim() || 'Unassigned';
      const bucket = assetMainheadBuckets.get(key);

      if (bucket) {
        bucket.value += 1;
      } else {
        assetMainheadBuckets.set(key, { label, value: 1 });
      }
    }
    const assetsByMainhead = Array.from(assetMainheadBuckets.values()).sort(
      (left, right) =>
        right.value - left.value || left.label.localeCompare(right.label),
    );

    // Persona — the caller's org type + active capabilities decide which sections
    // the dashboard leads with. ADMIN/ASCURE always get the full overview.
    const capabilitySet = new Set(
      orgForPersona?.capabilities.map((row) => row.capability) ?? [],
    );
    const doesFieldWork =
      capabilitySet.has(OrganizationCapabilityType.SURVEY) ||
      capabilitySet.has(OrganizationCapabilityType.INSPECTION);
    const doesMaintenance =
      capabilitySet.has(OrganizationCapabilityType.MAINTENANCE) ||
      capabilitySet.has(OrganizationCapabilityType.REPAIR);
    const personaKind: 'OVERVIEW' | 'INSPECTION' | 'MAINTENANCE' = ctx.isAdmin
      ? 'OVERVIEW'
      : doesMaintenance && !doesFieldWork
        ? 'MAINTENANCE'
        : doesFieldWork
          ? 'INSPECTION'
          : 'OVERVIEW';
    const persona = {
      kind: personaKind,
      role: user.role,
      companyType: orgForPersona?.type ?? null,
      organizationName: orgForPersona?.name ?? null,
      isQa: ctx.isQa,
      doesFieldWork,
      doesMaintenance,
    };

    // Defects by maintenance category — null (legacy/untagged) folds into
    // SELENGGARAAN, matching the materialization default + the map/list.
    const categoryCountMap = new Map<MaintenanceCategory | null, number>(
      defectCategoryCounts.map((entry) => [
        entry.maintenanceCategory,
        entry._count._all,
      ]),
    );
    const defectsByCategory = [
      MaintenanceCategory.RENTIS,
      MaintenanceCategory.CAT_TIANG,
      MaintenanceCategory.SELENGGARAAN,
    ].map((category) => ({
      label: this.formatMaintenanceCategory(category),
      value:
        (categoryCountMap.get(category) ?? 0) +
        (category === MaintenanceCategory.SELENGGARAAN
          ? categoryCountMap.get(null) ?? 0
          : 0),
    }));

    // Defects by workflow status (derived from the status counts above).
    const defectsByStatus = [
      { label: 'Open', value: openDefects },
      { label: 'In Progress', value: inProgressDefects },
      { label: 'Monitoring', value: monitoringDefects },
      { label: 'Resolved', value: resolvedDefects },
      { label: 'Closed', value: closedDefects },
    ];

    // Daily inspection throughput — distinct assets submitted per reporting-day
    // across the rolling window, so an amend-resubmit counts a pole once/day.
    const offsetMs = this.getReportingOffsetMinutes() * 60 * 1000;
    const reportingDayStartMs = (date: Date): number => {
      const shifted = new Date(date.getTime() + offsetMs);
      return (
        Date.UTC(
          shifted.getUTCFullYear(),
          shifted.getUTCMonth(),
          shifted.getUTCDate(),
        ) - offsetMs
      );
    };
    const trendBuckets = new Map<number, Set<string>>();
    for (let dayIndex = 0; dayIndex < trendDays; dayIndex += 1) {
      const dayStartMs =
        reportingTodayStart.getTime() -
        (trendDays - 1 - dayIndex) * 24 * 60 * 60 * 1000;
      trendBuckets.set(dayStartMs, new Set<string>());
    }
    for (const inspection of trendInspections) {
      if (!inspection.submittedAt) {
        continue;
      }
      const bucket = trendBuckets.get(
        reportingDayStartMs(inspection.submittedAt),
      );
      if (bucket) {
        bucket.add(inspection.assetId);
      }
    }
    const dailyInspectionTrend = Array.from(trendBuckets.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([dayStartMs, assets]) => ({
        // Local calendar date (YYYY-MM-DD) of the reporting-day bucket.
        date: new Date(dayStartMs + offsetMs).toISOString().slice(0, 10),
        value: assets.size,
      }));

    // Distinct assets inspected so far TODAY — the same reporting-day bucket the
    // trend's last point uses, so the KPI and the chart can never disagree.
    const inspectedToday =
      trendBuckets.get(reportingTodayStart.getTime())?.size ?? 0;

    // --- Additive range-scoped derivations ---
    const inspectedThisPeriod = new Set(
      periodInspections.map((row) => row.assetId),
    ).size;
    const inspectedPrevPeriod = new Set(
      prevPeriodInspections.map((row) => row.assetId),
    ).size;

    // Defect intake vs. closure, bucketed per reporting-day across the range.
    const flowBuckets = new Map<number, { opened: number; closed: number }>();
    for (let dayIndex = 0; dayIndex < rangeDays; dayIndex += 1) {
      const dayStartMs =
        reportingTodayStart.getTime() - (rangeDays - 1 - dayIndex) * DAY_MS;
      flowBuckets.set(dayStartMs, { opened: 0, closed: 0 });
    }
    let closedInRange = 0;
    let closeMsTotal = 0;
    for (const defect of defectFlowRows) {
      if (defect.createdAt) {
        const bucket = flowBuckets.get(reportingDayStartMs(defect.createdAt));
        if (bucket) bucket.opened += 1;
      }
      const closeAt = defect.closedAt ?? defect.resolvedAt;
      if (closeAt) {
        const bucket = flowBuckets.get(reportingDayStartMs(closeAt));
        if (bucket) {
          bucket.closed += 1;
          if (defect.createdAt) {
            closeMsTotal += closeAt.getTime() - defect.createdAt.getTime();
            closedInRange += 1;
          }
        }
      }
    }
    const defectFlow = Array.from(flowBuckets.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([dayStartMs, counts]) => ({
        date: this.reportingDateLabel(dayStartMs),
        opened: counts.opened,
        closed: counts.closed,
      }));
    const totalOpenedInRange = defectFlow.reduce((sum, d) => sum + d.opened, 0);
    const totalClosedInRange = defectFlow.reduce((sum, d) => sum + d.closed, 0);
    const netBacklogChange = totalOpenedInRange - totalClosedInRange;
    const avgCloseHours =
      closedInRange > 0
        ? Math.round((closeMsTotal / closedInRange / 3_600_000) * 10) / 10
        : 0;
    // Honest, cheap delta baseline: openDefects one window ago = today's open
    // minus the net change over the window.
    const openDefectsPrev = openDefects - netBacklogChange;

    // Assets per substation.
    const substationNameById = new Map(
      substationNames.map((s) => [s.id, s.name?.trim() || s.code]),
    );
    const assetsBySubstation = assetSubstationCounts
      .map((entry) => ({
        label: entry.substationId
          ? substationNameById.get(entry.substationId) ?? 'Unknown substation'
          : 'Unassigned',
        value: entry._count._all,
      }))
      .sort(
        (left, right) =>
          right.value - left.value || left.label.localeCompare(right.label),
      );

    // SLA on-time % — on-track share among due-dated active defects, now and
    // as-of prevEnd (reconstructed from the same widened rows).
    const slaOnTimePctFor = (asOf: Date | null): number | null => {
      let onTrack = 0;
      let overdue = 0;
      for (const defect of defectsForSlaState) {
        if (!defect.dueDate) continue;
        if (asOf) {
          // "Active as of asOf": created before, not yet closed/resolved then.
          if (defect.createdAt >= asOf) continue;
          const closed = defect.closedAt && defect.closedAt < asOf;
          const resolved = defect.resolvedAt && defect.resolvedAt < asOf;
          if (closed || resolved) continue;
          if (defect.dueDate < asOf) overdue += 1;
          else onTrack += 1;
        } else {
          const state = this.calculateSlaState(defect.status, defect.dueDate, now);
          if (state === 'OVERDUE') overdue += 1;
          else if (state === 'ON_TRACK') onTrack += 1;
        }
      }
      const denominator = onTrack + overdue;
      return denominator === 0 ? null : Math.round((onTrack / denominator) * 100);
    };
    const slaOnTimePct = slaOnTimePctFor(null);
    const slaOnTimePctPrev = slaOnTimePctFor(prevEnd);

    return {
      range: {
        key: rangeKey,
        label: RANGE_LABELS[rangeKey],
        from: this.reportingDateLabel(rangeStart.getTime()),
        to: this.reportingDateLabel(
          reportingTodayStart.getTime(),
        ),
      },
      inspectedToday,
      inspectedThisPeriod,
      inspectedPrevPeriod,
      assetsInScope: totalAssets,
      assetsInScopePrev: assetsInScopePrevCount,
      openDefectsPrev,
      emergencyOpen: emergencyOpenCount,
      emergencyUnassigned: emergencyUnassignedCount,
      emergencyOverdue: emergencyOverdueCount,
      emergencyOverduePrev: emergencyOverduePrevCount,
      defectFlow,
      avgCloseHours,
      netBacklogChange,
      assetsBySubstation,
      slaOnTimePct,
      slaOnTimePctPrev,
      persona,
      defectsByCategory,
      defectsByStatus,
      dailyInspectionTrend,
      totalAssets,
      totalInspections,
      totalDefects,
      openDefects,
      inProgressDefects,
      monitoringDefects,
      resolvedDefects,
      closedDefects,
      criticalDefects: countsBySeverity.get(DefectSeverity.CRITICAL) ?? 0,
      overdueDefects: overdueDefectCount,
      criticalOverdueDefects: criticalOverdueDefectCount,
      defectsBySeverity,
      defectsByAssignee,
      defectsByTeam,
      defectsBySlaState,
      activeVisits: activeSiteVisitCount,
      completedVisits: completedSiteVisitCount,
      overdueVisits: overdueSiteVisitCount,
      completionRate,
      activeFieldTeams: activeFieldTeamCount,
      operationalOverdueThresholdHours: overdueThresholdHours,
      visitsByStatus,
      visitsByValidationStatus,
      visitsByType,
      activeVisitsByTeam,
      visitsByOperationalHealth,
      assetsByMainhead,
      activeMappedVisits: activeMappedVisitCount,
      latestVisitActivityAt:
        latestSiteVisitActivity._max.updatedAt?.toISOString() ?? null,
      operationalLastRefreshedAt: now.toISOString(),
      criticalOverdueAlerts: criticalOverdueItems.map((defect) => ({
        id: defect.id,
        assetCode: defect.inspectionItemResult.inspection.asset.assetCode,
        label: defect.inspectionItemResult.label,
        status: defect.status,
        severity: defect.severity,
        maintenanceCategory: defect.maintenanceCategory,
        dueDate: defect.dueDate?.toISOString() ?? null,
        assignedTo: this.formatAssignmentLabel(
          defect.assignedUser,
          defect.assignedTeam,
        ),
      })),
      recentDefects: recentDefectRows.map((defect) => {
        const slaState = this.calculateSlaState(
          defect.status,
          defect.dueDate,
          now,
        );

        return {
          id: defect.id,
          assetCode: defect.inspectionItemResult.inspection.asset.assetCode,
          label: defect.inspectionItemResult.label,
          status: defect.status,
          severity: defect.severity,
          maintenanceCategory: defect.maintenanceCategory,
          dueDate: defect.dueDate?.toISOString() ?? null,
          isOverdue: slaState === 'OVERDUE',
          slaState,
          assignedTo: this.formatAssignmentLabel(
            defect.assignedUser,
            defect.assignedTeam,
          ),
          createdAt: defect.inspectionItemResult.createdAt.toISOString(),
        };
      }),
    };
  }

  private formatMaintenanceCategory(category: MaintenanceCategory): string {
    switch (category) {
      case MaintenanceCategory.RENTIS:
        return 'Rentis';
      case MaintenanceCategory.CAT_TIANG:
        return 'Cat Tiang';
      case MaintenanceCategory.SELENGGARAAN:
        return 'Selenggaraan';
      default:
        return category;
    }
  }

  /**
   * Daily per-team activity (#7) — a Manager/Supervisor monitoring view of how
   * many poles each team submitted today. "Done" = an asset with a SUBMITTED
   * inspection, matching the contribution-ledger billing metric (ADR 0002 §5 /
   * site-visits.service.ts buildContributionSnapshot). Counts distinct assets per
   * team so re-submitting the same pole isn't double-counted.
   *
   * Scope is role-aware (NOT the narrower team-membership scope used by the main
   * dashboard reads): ADMIN sees every team, MANAGER their whole company, a
   * SUPERVISOR the teams they are assigned via TeamSupervisor — mirroring
   * site-visits.service.ts accessScope so the monitoring view spans the teams a
   * manager actually oversees, not just the ones they personally belong to.
   */
  async getDailyTeamActivity(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    const { start, end, dateLabel } = this.reportingDayBounds(new Date());

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: {
          gte: start,
          lt: end,
        },
        siteVisit: this.teamActivityVisitScope(user, ctx),
      },
      select: {
        assetId: true,
        siteVisit: {
          select: {
            teamId: true,
          },
        },
      },
    });

    // Distinct assets per team — an asset re-submitted (e.g. after an amend)
    // counts once, and a pole handed between teams credits each team that
    // submitted it.
    const assetsByTeam = new Map<string, Set<string>>();
    for (const row of inspections) {
      const teamId = row.siteVisit.teamId;
      let assets = assetsByTeam.get(teamId);
      if (!assets) {
        assets = new Set<string>();
        assetsByTeam.set(teamId, assets);
      }
      assets.add(row.assetId);
    }

    const teamIds = Array.from(assetsByTeam.keys());
    const teams =
      teamIds.length > 0
        ? await this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, name: true, code: true },
          })
        : [];
    const teamById = new Map(teams.map((team) => [team.id, team]));

    const teamRows = teamIds
      .map((teamId) => {
        const team = teamById.get(teamId);
        return {
          teamId,
          teamName:
            team?.name?.trim() || team?.code?.trim() || 'Unknown team',
          teamCode: team?.code ?? null,
          assetsInspectedToday: assetsByTeam.get(teamId)?.size ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.assetsInspectedToday - left.assetsInspectedToday ||
          left.teamName.localeCompare(right.teamName),
      );

    const totalAssetsInspectedToday = teamRows.reduce(
      (total, row) => total + row.assetsInspectedToday,
      0,
    );

    return {
      date: dateLabel,
      totalAssetsInspectedToday,
      activeTeamCount: teamRows.length,
      teams: teamRows,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Per-USER counterpart of {@link getDailyTeamActivity}: distinct assets each
   * person submitted today, for a manager to see individual output (the per-team
   * card rolls these up). Same reporting-day window + role-aware scope; grouped
   * by the inspecting user (Inspection.createdByUserId).
   */
  async getDailyUserActivity(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    const { start, end, dateLabel } = this.reportingDayBounds(new Date());

    const inspections = await this.prisma.inspection.findMany({
      where: {
        tenantId: user.tenantId,
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: { gte: start, lt: end },
        siteVisit: this.teamActivityVisitScope(user, ctx),
      },
      select: {
        assetId: true,
        createdByUserId: true,
        siteVisit: { select: { teamId: true } },
      },
    });

    // Distinct assets per inspecting user — a pole re-submitted (e.g. after an
    // amend) counts once.
    const assetsByUser = new Map<string, Set<string>>();
    const teamByUser = new Map<string, string>();
    for (const row of inspections) {
      const userId = row.createdByUserId;
      let assets = assetsByUser.get(userId);
      if (!assets) {
        assets = new Set<string>();
        assetsByUser.set(userId, assets);
      }
      assets.add(row.assetId);
      if (!teamByUser.has(userId)) {
        teamByUser.set(userId, row.siteVisit.teamId);
      }
    }

    const userIds = Array.from(assetsByUser.keys());
    const teamIds = Array.from(new Set(teamByUser.values()));
    const [users, teams] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, role: true },
          })
        : Promise.resolve([]),
      teamIds.length
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
    ]);
    const userById = new Map(users.map((row) => [row.id, row]));
    const teamById = new Map(teams.map((row) => [row.id, row]));

    const userRows = userIds
      .map((userId) => {
        const record = userById.get(userId);
        const team = teamById.get(teamByUser.get(userId) ?? '');
        return {
          userId,
          name: record?.name?.trim() || record?.email || 'Unknown user',
          email: record?.email ?? null,
          role: record?.role ?? null,
          teamName: team?.name?.trim() || team?.code?.trim() || null,
          assetsInspectedToday: assetsByUser.get(userId)?.size ?? 0,
        };
      })
      .sort(
        (left, right) =>
          right.assetsInspectedToday - left.assetsInspectedToday ||
          left.name.localeCompare(right.name),
      );

    const totalAssetsInspectedToday = userRows.reduce(
      (total, row) => total + row.assetsInspectedToday,
      0,
    );

    return {
      date: dateLabel,
      totalAssetsInspectedToday,
      activeUserCount: userRows.length,
      users: userRows,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Role-aware site-visit scope for the daily team activity monitoring view.
   * Mirrors site-visits.service.ts accessScope (ADR 0002 §3) rather than the
   * team-membership scope the main dashboard uses, so managers/supervisors see
   * across the teams they oversee.
   */
  private teamActivityVisitScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    return siteVisitOversightWhere(user, ctx);
  }

  /**
   * Start/end UTC instants for "today" in the tenant's reporting time zone, plus
   * the YYYY-MM-DD label of that day. Defaults to Malaysia (UTC+8, no DST) since
   * every target utility (TNB/SESB/SESCO/TM) is Malaysian; override with
   * REPORTING_TIME_ZONE_OFFSET_MINUTES for productization. submittedAt is stored
   * in UTC, so a fixed offset gives the correct local-day window regardless of
   * the server's own time zone.
   */
  private reportingDayBounds(now: Date): {
    start: Date;
    end: Date;
    dateLabel: string;
  } {
    const offsetMs = this.getReportingOffsetMinutes() * 60 * 1000;
    const shifted = new Date(now.getTime() + offsetMs);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    const startMs = Date.UTC(year, month, day) - offsetMs;

    return {
      start: new Date(startMs),
      end: new Date(startMs + 24 * 60 * 60 * 1000),
      dateLabel: `${year}-${String(month + 1).padStart(2, '0')}-${String(
        day,
      ).padStart(2, '0')}`,
    };
  }

  private getReportingOffsetMinutes(): number {
    const raw = this.configService.get<string>(
      'REPORTING_TIME_ZONE_OFFSET_MINUTES',
    );
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;

    return Number.isFinite(parsed) ? parsed : 8 * 60;
  }

  /** Number of reporting-days the range spans (inclusive of today). */
  private rangeDaysFor(
    rangeKey: DashboardRangeKey,
    reportingTodayStart: Date,
    now: Date,
  ): number {
    if (rangeKey === '7d') return 7;
    if (rangeKey === '30d') return 30;
    if (rangeKey === '90d') return 90;
    // ytd — whole reporting-days from Jan 1 (reporting TZ) to today, inclusive.
    const offsetMs = this.getReportingOffsetMinutes() * 60 * 1000;
    const shifted = new Date(now.getTime() + offsetMs);
    const jan1StartMs = Date.UTC(shifted.getUTCFullYear(), 0, 1) - offsetMs;
    const days =
      Math.floor(
        (reportingTodayStart.getTime() - jan1StartMs) / (24 * 60 * 60 * 1000),
      ) + 1;
    return Math.max(1, days);
  }

  private reportingDateLabel(dayStartMs: number): string {
    const offsetMs = this.getReportingOffsetMinutes() * 60 * 1000;
    return new Date(dayStartMs + offsetMs).toISOString().slice(0, 10);
  }

  private async ensureDefectsForAccessibleItems(
    user: RequestUser,
    ctx?: ScopeContext,
  ) {
    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: {
        isDefect: true,
        defect: {
          is: null,
        },
        inspection: {
          // Live defects exist only for SUBMITTED inspections (parity with
          // defects.service) — never materialize one from a draft / amended
          // inspection.
          completionStatus: InspectionCompletionStatus.SUBMITTED,
          ...this.accessibleInspectionWhere(user, ctx),
          // Foundation/baseline imports are historical observations — never
          // materialize live Defects from them (parity with defects.service,
          // which otherwise lets the dashboard surface them as claimable work).
          OR: [
            { reportingGroup: null },
            {
              reportingGroup: {
                not: { startsWith: APPSHEET_IMPORT_REPORTING_GROUP_PREFIX },
              },
            },
          ],
        },
      },
      select: {
        id: true,
        severity: true,
        isEmergency: true,
        maintenanceCategory: true,
      },
    });

    if (itemResults.length === 0) {
      return;
    }

    const now = new Date();

    await this.prisma.defect.createMany({
      data: itemResults.map((item) => buildInitialDefectData(item, now)),
      skipDuplicates: true,
    });
  }

  private calculateSlaState(
    status: DefectStatus,
    dueDate: Date | null,
    now = new Date(),
  ): DefectSlaState {
    if (status === DefectStatus.CLOSED || status === DefectStatus.RESOLVED) {
      return 'STOPPED';
    }

    if (!dueDate) {
      return 'NO_DUE_DATE';
    }

    if (ACTIVE_SLA_STATUSES.includes(status as (typeof ACTIVE_SLA_STATUSES)[number]) && dueDate.getTime() < now.getTime()) {
      return 'OVERDUE';
    }

    return 'ON_TRACK';
  }

  private formatSlaState(slaState: DefectSlaState) {
    return slaState
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private formatAssignmentLabel(
    assignedUser: { name: string | null; email?: string | null } | null,
    assignedTeam: { name: string | null; code?: string | null } | null,
  ) {
    const labels = [
      assignedUser?.name?.trim() || assignedUser?.email?.trim() || null,
      assignedTeam?.name?.trim() || assignedTeam?.code?.trim() || null,
    ].filter((label): label is string => Boolean(label));

    return labels.length > 0 ? labels.join(' / ') : 'Unassigned';
  }

  private accessibleAssetWhere(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.AssetWhereInput {
    // The Asset row carries no team/region/mainhead column, so scope is applied
    // transitively through the site visits that touch it — an asset is visible
    // if it has an inspection in a site visit the user may see, or it was
    // created during such a visit (mirrors AssetsService.loadMapAssets). ADMIN /
    // QA-admin see every asset in the tenant. This is the fix for the dashboard
    // "Total Assets" counting every team's poles regardless of the viewer's
    // scope.
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return { tenantId: user.tenantId };
    }

    const scopeWhere = siteVisitOversightWhere(user, ctx);

    return {
      tenantId: user.tenantId,
      OR: [
        { inspections: { some: { siteVisit: scopeWhere } } },
        { createdDuringVisit: scopeWhere },
      ],
    };
  }

  private accessibleDefectWhere(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.DefectWhereInput {
    const inspectionScope: Prisma.DefectWhereInput = {
      inspectionItemResult: {
        isDefect: true,
        inspection: this.accessibleInspectionWhere(user, ctx),
      },
    };

    // ADMIN already sees every in-tenant defect through the inspection scope.
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return inspectionScope;
    }

    // Mirror defects.service.defectAccessScope so the dashboard counts a
    // maintenance company's ROUTED pool (Defect.maintenanceOrganizationId), not
    // just defects on inspections it can see. Without this a maintenance company
    // (which typically never runs the inspection) saw ZERO defects here while the
    // Defects page listed its whole pool.
    const maintenanceOrgIds =
      ctx?.maintenanceOrgIds ??
      (user.organizationId ? [user.organizationId] : []);
    if (maintenanceOrgIds.length === 0) {
      return inspectionScope;
    }

    return {
      OR: [
        inspectionScope,
        {
          maintenanceOrganizationId: { in: maintenanceOrgIds },
          inspectionItemResult: {
            isDefect: true,
            inspection: { tenantId: user.tenantId },
          },
        },
      ],
    };
  }

  private accessibleInspectionWhere(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.InspectionWhereInput {
    return {
      tenantId: user.tenantId,
      ...this.inspectionAccessScope(user, ctx),
    };
  }

  private accessibleSiteVisitWhere(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    return {
      tenantId: user.tenantId,
      ...this.siteVisitAccessScope(user, ctx),
    };
  }

  /**
   * Inspection visibility for the dashboard reads. Delegates to the canonical
   * role-aware site-visit filter (common/authorization/site-visit-scope) so the
   * dashboard totals match every other surface: ADMIN sees the tenant, QA its
   * MAINHEADs, MANAGER its whole company, SUPERVISOR its supervised teams, and
   * everyone else their own teams. Previously this used a narrow own-team-
   * membership filter, so a MANAGER's dashboard under-counted (only their
   * personal teams, not their company).
   */
  private inspectionAccessScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.InspectionWhereInput {
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return {};
    }

    return {
      siteVisit: siteVisitOversightWhere(user, ctx),
    };
  }

  /**
   * Site visit visibility for the dashboard reads — the canonical role-aware
   * filter (see inspectionAccessScope).
   */
  private siteVisitAccessScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    return siteVisitOversightWhere(user, ctx);
  }

  /**
   * Team visibility for dashboard reference lists (e.g. the active-field-teams
   * label map). Mirrors the site-visit access matrix so a MANAGER's dashboard
   * only references their own company's teams, not every team in the tenant.
   */
  private teamAccessWhere(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.TeamWhereInput {
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return {};
    }

    if (ctx?.isQa) {
      return { mainheadId: { in: ctx.qaMainheadIds } };
    }

    const ownTeamMembership: Prisma.TeamWhereInput = {
      members: { some: { userId: user.id, isActive: true } },
    };

    if (user.role === UserRole.MANAGER && user.organizationId) {
      return { OR: [{ organizationId: user.organizationId }, ownTeamMembership] };
    }

    if (user.role === UserRole.SUPERVISOR) {
      return {
        OR: [
          { supervisors: { some: { supervisorUserId: user.id, isActive: true } } },
          ownTeamMembership,
        ],
      };
    }

    return ownTeamMembership;
  }

  private activeSiteVisitStatuses() {
    return [
      SiteVisitStatus.ACTIVE,
      SiteVisitStatus.OPEN,
      SiteVisitStatus.IN_PROGRESS,
    ];
  }

  private siteVisitStatusLabels() {
    return [
      SiteVisitStatus.ACTIVE,
      SiteVisitStatus.OPEN,
      SiteVisitStatus.IN_PROGRESS,
      SiteVisitStatus.COMPLETED,
      SiteVisitStatus.CANCELLED,
    ];
  }

  private siteVisitValidationLabels() {
    return [
      SiteVisitValidationStatus.PENDING,
      SiteVisitValidationStatus.VALIDATED,
      SiteVisitValidationStatus.WARNING,
      SiteVisitValidationStatus.FAILED,
    ];
  }

  private siteVisitTypeLabels() {
    return [
      SiteVisitType.DISCOVERY,
      SiteVisitType.REINSPECTION,
      SiteVisitType.SPECIAL,
      SiteVisitType.AUDIT,
    ];
  }

  private formatEnumLabel(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private getOverdueThresholdHours() {
    return parseOperationalOverdueThresholdHours(
      this.configService.get<string>('OPERATIONAL_VISIT_OVERDUE_HOURS') ??
        this.configService.get<string>('SITE_VISIT_OVERDUE_HOURS'),
    );
  }
}
