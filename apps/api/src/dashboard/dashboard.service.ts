import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DefectSeverity,
  DefectStatus,
  InspectionCompletionStatus,
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
import { siteVisitAccessWhere } from '../common/authorization/site-visit-scope';
import {
  calculateOperationalHealthStatus,
  parseOperationalOverdueThresholdHours,
} from '../common/operational-health';
import { PrismaService } from '../prisma/prisma.service';

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

  async getDashboard(user: RequestUser) {
    const ctx = await buildScopeContext(this.prisma, user);
    await this.ensureDefectsForAccessibleItems(user, ctx);

    const defectWhere = this.accessibleDefectWhere(user, ctx);
    const now = new Date();
    const overdueThresholdHours = this.getOverdueThresholdHours();
    const activeVisitCutoff = new Date(
      now.getTime() - overdueThresholdHours * 60 * 60 * 1000,
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

    const [
      totalAssets,
      totalInspections,
      defectStatusCounts,
      defectSeverityCounts,
      recentDefectItems,
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
      this.prisma.inspectionItemResult.findMany({
        where: {
          isDefect: true,
          defect: {
            isNot: null,
          },
          inspection: this.accessibleInspectionWhere(user, ctx),
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        select: {
          label: true,
          createdAt: true,
          defect: {
            select: {
              id: true,
              status: true,
              severity: true,
              dueDate: true,
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
            },
          },
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
    ]);

    const [assignedUsers, assignedTeams] = await Promise.all([
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

    return {
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
        dueDate: defect.dueDate?.toISOString() ?? null,
        assignedTo: this.formatAssignmentLabel(
          defect.assignedUser,
          defect.assignedTeam,
        ),
      })),
      recentDefects: recentDefectItems.flatMap((item) => {
        if (!item.defect) {
          return [];
        }

        const slaState = this.calculateSlaState(
          item.defect.status,
          item.defect.dueDate,
          now,
        );

        return {
          id: item.defect.id,
          assetCode: item.inspection.asset.assetCode,
          label: item.label,
          status: item.defect.status,
          severity: item.defect.severity,
          dueDate: item.defect.dueDate?.toISOString() ?? null,
          isOverdue: slaState === 'OVERDUE',
          slaState,
          assignedTo: this.formatAssignmentLabel(
            item.defect.assignedUser,
            item.defect.assignedTeam,
          ),
          createdAt: item.createdAt.toISOString(),
        };
      }),
    };
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
   * Role-aware site-visit scope for the daily team activity monitoring view.
   * Mirrors site-visits.service.ts accessScope (ADR 0002 §3) rather than the
   * team-membership scope the main dashboard uses, so managers/supervisors see
   * across the teams they oversee.
   */
  private teamActivityVisitScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.SiteVisitWhereInput {
    return siteVisitAccessWhere(user, ctx);
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
    // created during such a visit (mirrors AssetsService.listMapAssets). ADMIN /
    // QA-admin see every asset in the tenant. This is the fix for the dashboard
    // "Total Assets" counting every team's poles regardless of the viewer's
    // scope.
    if (user.role === UserRole.ADMIN || ctx?.isAdmin) {
      return { tenantId: user.tenantId };
    }

    const scopeWhere = siteVisitAccessWhere(user, ctx);

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
    return {
      inspectionItemResult: {
        isDefect: true,
        inspection: this.accessibleInspectionWhere(user, ctx),
      },
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
      siteVisit: siteVisitAccessWhere(user, ctx),
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
    return siteVisitAccessWhere(user, ctx);
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
