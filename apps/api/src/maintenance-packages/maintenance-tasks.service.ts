import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import {
  DefectLifecycleStatus,
  DefectStatus,
  MaintenanceCategory,
  Prisma,
  ResolutionOutcome,
  UserRole,
} from '@prisma/client';
import {
  CANNOT_REPAIR_OUTCOMES,
  isCannotRepairOutcome,
} from '../common/authorization/maintenance-closure';
import { resolveClientSupervisorCompanyIds } from '../common/authorization/client-maintenance-actor';
import { buildScopeContext } from '../common/authorization/scope-context';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  MaintenanceOverviewQueryDto,
  MaintenanceTaskGroupsQueryDto,
  MaintenanceTaskItemsQueryDto,
  MaintenanceTasksQueryDto,
  TASK_STATUSES,
  TaskStatus,
} from './dto/maintenance-tasks.dto';
import { RepairPeriodStatus } from './dto/repair-report.dto';
import { dayStart, nextDayStart, previousNoTiangLama } from './maintenance-closure.service';
import { effectiveLama } from './maintenance-work.service';
import { REPAIR_EVIDENCE_WHERE } from './package-routing.util';

const GROUPS_PAGE_SIZE = 20;
/** The Overview's chart: the chosen day and the 29 before it. */
const OVERVIEW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Malaysia is UTC+8 all year — a timestamp's calendar day there. */
const MY_OFFSET_MS = 8 * 60 * 60 * 1000;
const myDay = (at: Date) => new Date(at.getTime() + MY_OFFSET_MS).toISOString().slice(0, 10);
const OPEN_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'SENT_BACK'];

/** Plan §21 (R6): the three daily events of a repair. */
type DayCounts = { started: number; completed: number; verified: number };
const emptyDay = (): DayCounts => ({ started: 0, completed: 0, verified: 0 });
const emptyStatusCounts = () =>
  Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
/** One Pencawang + team group is opened at a time; this caps a freak group. */
const ITEMS_LIMIT = 500;
const SUBMITTED: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.COMPLETED,
  DefectLifecycleStatus.VERIFICATION_PENDING,
];
/** Sent back = TNB / the main contractor moved it from submitted or closed back to work. */
const SENT_BACK_FROM: DefectLifecycleStatus[] = [...SUBMITTED, DefectLifecycleStatus.CLOSED];
/** Order inside a group: what needs the crew first. */
const STATUS_ORDER: Record<TaskStatus, number> = {
  SENT_BACK: 0,
  IN_PROGRESS: 1,
  TODO: 2,
  COMPLETED: 3,
  CANNOT_REPAIR: 4,
  VERIFIED: 5,
};

/** Plan §21.2 #2: one company × work type line of TNB Performance. */
type PerformanceLane = {
  category: string;
  assigned: number;
  completed: number;
  verified: number;
  cannotRepair: number;
  sentBack: number;
  /** Sent back ÷ (verified + sent back) in the period; null when nothing was decided. */
  sentBackRate: number | null;
  daysToDone: number | null;
  daysToVerify: number | null;
  open: number;
  overduePencawang: number;
};

export type TnbPerformanceOptions = {
  from?: string;
  to?: string;
  organizationId?: string | null;
  category?: MaintenanceCategory | null;
};

/** Plan §21 (R7): a report period and what narrows it. */
export type RepairPeriodOptions = {
  from?: string | null;
  to?: string | null;
  status?: RepairPeriodStatus | null;
  organizationId?: string | null;
  teamId?: string | null;
  category?: MaintenanceCategory | null;
};

type TaskScope =
  | { kind: 'ADMIN' }
  /** A company's Manager (own company + subcontractor subtree) or Supervisor (own company). */
  | { kind: 'COMPANY'; organizationIds: string[] }
  /** A technician: work given to their team(s) or to them. */
  | { kind: 'CREW'; organizationId: string; userId: string; teamIds: string[] }
  /**
   * TNB (plan §21.2 #1–#2): the work on its org's Mainheads — the same rule as
   * Repair Verification (SiteVisit.mainheadId); a TNB Supervisor only its companies.
   */
  | { kind: 'TNB'; mainheadIds: string[]; companyIds: string[] | null };

/** JS twin of STATUS_SQL — keep the two in step. */
export function taskStatus(defect: {
  lifecycleStatus: DefectLifecycleStatus | null;
  status: DefectStatus;
  resolutionOutcome: ResolutionOutcome | null;
  maintainedAt: Date | null;
}): TaskStatus {
  const lifecycle = defect.lifecycleStatus;
  const closed = lifecycle === DefectLifecycleStatus.CLOSED || defect.status === DefectStatus.CLOSED;
  const submitted = lifecycle !== null && SUBMITTED.includes(lifecycle);
  if ((closed || submitted) && isCannotRepairOutcome(defect.resolutionOutcome)) return 'CANNOT_REPAIR';
  if (closed) return 'VERIFIED';
  if (submitted) return 'COMPLETED';
  if (lifecycle === DefectLifecycleStatus.IN_PROGRESS) {
    return defect.maintainedAt ? 'SENT_BACK' : 'IN_PROGRESS';
  }
  return 'TODO';
}

/** "Repair rejected by TNB: poles still overgrown" → "poles still overgrown". */
function reasonOf(comment: string | null) {
  if (!comment) return null;
  const at = comment.indexOf(': ');
  return at >= 0 ? comment.slice(at + 2).trim() || null : null;
}

/**
 * Plan §21.2 #4 — "My tasks": every routed Kejanggalan of the caller's company,
 * one folded row per Pencawang + team, laid out like Repair Verification but
 * covering the whole life of the work (to do → verified), sent-back work first.
 * Read-only: the work itself is done on mobile / Maintenance Packages.
 *
 * Who: ADMIN (every company), a contractor MANAGER (own company + subcontractor
 * subtree), SUPERVISOR (own company — view, as on the board, plan §15 J31),
 * TECHNICIAN (own team's / own work). TNB uses Repair Verification instead.
 */
@Injectable()
export class MaintenanceTasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveScope(user: RequestUser): Promise<TaskScope> {
    if (user.role === UserRole.ADMIN) return { kind: 'ADMIN' };
    const forbidden = new ForbiddenException(
      'My tasks is for a maintenance company’s managers, supervisors and crews.',
    );
    if (!user.organizationId) throw forbidden;

    const ctx = await buildScopeContext(this.prisma, user);
    if (ctx.isClientViewer) throw forbidden;

    if (user.role === UserRole.MANAGER) {
      return {
        kind: 'COMPANY',
        organizationIds: ctx.maintenanceOrgIds.length > 0 ? ctx.maintenanceOrgIds : [user.organizationId],
      };
    }
    if (user.role === UserRole.SUPERVISOR) {
      return { kind: 'COMPANY', organizationIds: [user.organizationId] };
    }
    if (user.role === UserRole.TECHNICIAN) {
      const memberships = await this.prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      });
      return {
        kind: 'CREW',
        organizationId: user.organizationId,
        userId: user.id,
        teamIds: [...new Set(memberships.map((row) => row.teamId))],
      };
    }
    throw forbidden;
  }

  /* ── SQL (the groups) ─────────────────────────────────────────────────── */

  private statusSql() {
    const cannot = [...CANNOT_REPAIR_OUTCOMES].map((outcome) => outcome as string);
    return Prisma.sql`CASE
      WHEN (d."lifecycleStatus" IN ('CLOSED', 'COMPLETED', 'VERIFICATION_PENDING') OR d."status" = 'CLOSED')
        AND d."resolutionOutcome"::text = ANY(${cannot}::text[]) THEN 'CANNOT_REPAIR'
      WHEN d."lifecycleStatus" = 'CLOSED' OR d."status" = 'CLOSED' THEN 'VERIFIED'
      WHEN d."lifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING') THEN 'COMPLETED'
      WHEN d."lifecycleStatus" = 'IN_PROGRESS' AND d."maintainedAt" IS NOT NULL THEN 'SENT_BACK'
      WHEN d."lifecycleStatus" = 'IN_PROGRESS' THEN 'IN_PROGRESS'
      ELSE 'TODO'
    END`;
  }

  private scopeSql(scope: TaskScope) {
    if (scope.kind === 'COMPANY') {
      return Prisma.sql`AND d."maintenanceOrganizationId" = ANY(${scope.organizationIds}::uuid[])`;
    }
    if (scope.kind === 'TNB') {
      return scope.companyIds
        ? Prisma.sql`AND sv."mainheadId" = ANY(${scope.mainheadIds}::uuid[])
            AND d."maintenanceOrganizationId" = ANY(${scope.companyIds}::uuid[])`
        : Prisma.sql`AND sv."mainheadId" = ANY(${scope.mainheadIds}::uuid[])`;
    }
    if (scope.kind === 'CREW') {
      return Prisma.sql`AND d."maintenanceOrganizationId" = ${scope.organizationId}::uuid
        AND (d."assignedToUserId" = ${scope.userId}::uuid
          OR d."assignedUserId" = ${scope.userId}::uuid
          OR d."assignedToTeamId" = ANY(${scope.teamIds}::uuid[])
          OR d."assignedTeamId" = ANY(${scope.teamIds}::uuid[]))`;
    }
    return Prisma.empty;
  }

  /** Every filter except status (status narrows groups, not their counts). */
  private filterSql(query: MaintenanceTasksQueryDto & { siteVisitId?: string }) {
    const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.siteVisitId) parts.push(Prisma.sql`sv."id" = ${query.siteVisitId}::uuid`);
    if (query.organizationId) {
      parts.push(Prisma.sql`d."maintenanceOrganizationId" = ${query.organizationId}::uuid`);
    }
    if (query.teamId === 'NONE') {
      parts.push(Prisma.sql`COALESCE(d."assignedToTeamId", d."assignedTeamId") IS NULL`);
    } else if (query.teamId) {
      parts.push(Prisma.sql`COALESCE(d."assignedToTeamId", d."assignedTeamId") = ${query.teamId}::uuid`);
    }
    if (query.category) {
      parts.push(Prisma.sql`COALESCE(d."maintenanceCategory"::text, 'SELENGGARAAN') = ${query.category}`);
    }
    if (query.from || query.to) {
      const inRange = (column: Prisma.Sql) =>
        Prisma.join(
          [
            Prisma.sql`${column} IS NOT NULL`,
            query.from ? Prisma.sql`${column} >= ${dayStart(query.from)}` : Prisma.sql`TRUE`,
            query.to ? Prisma.sql`${column} < ${nextDayStart(query.to)}` : Prisma.sql`TRUE`,
          ],
          ' AND ',
        );
      parts.push(
        Prisma.sql`((${inRange(Prisma.sql`d."maintainedAt"`)}) OR (${inRange(Prisma.sql`d."closureVerifiedAt"`)}))`,
      );
    }
    if (query.search) {
      const like = `%${query.search}%`;
      parts.push(Prisma.sql`(COALESCE(sv."pencawangName", st."name", '') ILIKE ${like}
        OR COALESCE(sv."pencawangCode", st."code", '') ILIKE ${like})`);
    }
    return Prisma.join(parts, ' AND ');
  }

  /** One row per routed Kejanggalan in scope, with its task status. */
  private tasksCte(user: RequestUser, scope: TaskScope, filters: Prisma.Sql, withTimes = false) {
    // R6: In progress = the first repair photo; Completed on site = Mark done;
    // Verified = sign-off. Only the Overview needs them.
    const times = withTimes
      ? Prisma.sql`
          d."assignedAt" AS "assignedAt",
          d."maintainedAt" AS "doneAt",
          d."closureVerifiedAt" AS "verifiedAt",
          -- The target TNB set: the work type's package, else the whole Pencawang's.
          COALESCE(d."dueDate", pc."dueDate", pw."dueDate") AS "dueDate",
          (SELECT MIN(e."createdAt") FROM "DefectEvidenceImage" e
            WHERE e."defectId" = d."id" AND e."evidenceType" IN ('BEFORE', 'DURING', 'AFTER')) AS "startedAt",`
      : Prisma.empty;
    const packageJoins = withTimes
      ? Prisma.sql`
        LEFT JOIN "MaintenancePackage" pc ON pc."siteVisitId" = sv."id"
          AND pc."maintenanceOrganizationId" = d."maintenanceOrganizationId"
          AND pc."category"::text = COALESCE(d."maintenanceCategory"::text, 'SELENGGARAAN')
        LEFT JOIN "MaintenancePackage" pw ON pw."siteVisitId" = sv."id"
          AND pw."maintenanceOrganizationId" = d."maintenanceOrganizationId"
          AND pw."category" IS NULL`
      : Prisma.empty;
    return Prisma.sql`
      WITH tasks AS (
        SELECT
          ${times}
          d."id",
          d."isEmergency",
          COALESCE(d."maintenanceCategory"::text, 'SELENGGARAAN') AS "category",
          ${this.statusSql()} AS "status",
          GREATEST(d."assignedAt", d."maintainedAt", d."closureVerifiedAt") AS "activityAt",
          sv."id" AS "siteVisitId",
          COALESCE(sv."pencawangName", st."name") AS "pencawangName",
          COALESCE(sv."pencawangCode", st."code") AS "pencawangCode",
          mh."name" AS "mainheadName",
          o."id" AS "organizationId",
          o."name" AS "organizationName",
          t."id" AS "teamId",
          t."name" AS "teamName"
        FROM "Defect" d
        JOIN "InspectionItemResult" r ON r."id" = d."inspectionItemResultId"
        JOIN "Inspection" i ON i."id" = r."inspectionId"
        JOIN "SiteVisit" sv ON sv."id" = i."siteVisitId"
        JOIN "Organization" o ON o."id" = d."maintenanceOrganizationId"
        LEFT JOIN "Team" t ON t."id" = COALESCE(d."assignedToTeamId", d."assignedTeamId")
        LEFT JOIN "Mainhead" mh ON mh."id" = sv."mainheadId"
        -- The visit's name / code snapshot may be empty: fall back to the Pencawang.
        LEFT JOIN "Substation" st ON st."id" = sv."substationId"
        ${packageJoins}
        WHERE sv."tenantId" = ${user.tenantId}::uuid
          AND d."maintenanceOrganizationId" IS NOT NULL
          AND r."isDefect" = TRUE
          ${this.scopeSql(scope)}
          AND ${filters}
      )`;
  }

  async getGroups(user: RequestUser, query: MaintenanceTaskGroupsQueryDto) {
    const scope = await this.resolveScope(user);
    const page = query.page ?? 0;
    const tasks = this.tasksCte(user, scope, this.filterSql(query));
    const count = (status: TaskStatus) => Prisma.sql`COUNT(*) FILTER (WHERE "status" = ${status})::int`;
    const having = query.status ? Prisma.sql`HAVING ${count(query.status)} > 0` : Prisma.empty;

    const [rows, statusCounts, options] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          siteVisitId: string;
          pencawangName: string | null;
          pencawangCode: string | null;
          mainheadName: string | null;
          organizationId: string;
          organizationName: string;
          teamId: string | null;
          teamName: string | null;
          todo: number;
          inProgress: number;
          sentBack: number;
          completed: number;
          cannotRepair: number;
          verified: number;
          count: number;
          emergencies: number;
          categories: string[] | null;
          activityAt: Date | null;
          total: number;
        }>
      >`
        ${tasks}
        SELECT
          "siteVisitId", "pencawangName", "pencawangCode", "mainheadName",
          "organizationId", "organizationName", "teamId", "teamName",
          ${count('TODO')} AS "todo",
          ${count('IN_PROGRESS')} AS "inProgress",
          ${count('SENT_BACK')} AS "sentBack",
          ${count('COMPLETED')} AS "completed",
          ${count('CANNOT_REPAIR')} AS "cannotRepair",
          ${count('VERIFIED')} AS "verified",
          COUNT(*)::int AS "count",
          COUNT(*) FILTER (WHERE "isEmergency")::int AS "emergencies",
          ARRAY_AGG(DISTINCT "category") AS "categories",
          MAX("activityAt") AS "activityAt",
          (COUNT(*) OVER ())::int AS "total"
        FROM tasks
        GROUP BY "siteVisitId", "pencawangName", "pencawangCode", "mainheadName",
          "organizationId", "organizationName", "teamId", "teamName"
        ${having}
        ORDER BY
          (${count('SENT_BACK')} > 0) DESC,
          (COUNT(*) FILTER (WHERE "status" IN ('TODO', 'IN_PROGRESS')) > 0) DESC,
          "pencawangName" ASC NULLS LAST,
          "teamName" ASC NULLS FIRST
        LIMIT ${GROUPS_PAGE_SIZE} OFFSET ${page * GROUPS_PAGE_SIZE}
      `,
      // Status chip counts: every filter but the status itself.
      this.prisma.$queryRaw<Array<{ status: TaskStatus; count: number }>>`
        ${tasks}
        SELECT "status", COUNT(*)::int AS "count" FROM tasks GROUP BY "status"
      `,
      // Filter options: the whole scope, whatever is filtered.
      this.prisma.$queryRaw<
        Array<{ organizationId: string; organizationName: string; teamId: string | null; teamName: string | null }>
      >`
        ${this.tasksCte(user, scope, Prisma.sql`TRUE`)}
        SELECT DISTINCT "organizationId", "organizationName", "teamId", "teamName" FROM tasks
      `,
    ]);

    const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
    for (const row of statusCounts) counts[row.status] = row.count;

    const companies = new Map<string, string>();
    const teams = new Map<string, { id: string; name: string; organizationId: string }>();
    let hasNoTeam = false;
    for (const option of options) {
      companies.set(option.organizationId, option.organizationName);
      if (option.teamId && option.teamName) {
        teams.set(option.teamId, {
          id: option.teamId,
          name: option.teamName,
          organizationId: option.organizationId,
        });
      } else {
        hasNoTeam = true;
      }
    }

    return {
      scope: scope.kind,
      counts,
      page,
      pageSize: GROUPS_PAGE_SIZE,
      totalGroups: rows[0]?.total ?? 0,
      companies: [...companies.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      teams: [...teams.values()].sort((left, right) => left.name.localeCompare(right.name)),
      hasNoTeam,
      groups: rows.map((row) => ({
        siteVisitId: row.siteVisitId,
        pencawangName: row.pencawangName,
        pencawangCode: row.pencawangCode,
        mainhead: row.mainheadName,
        company: { id: row.organizationId, name: row.organizationName },
        team: row.teamId ? { id: row.teamId, name: row.teamName ?? '' } : null,
        counts: {
          TODO: row.todo,
          IN_PROGRESS: row.inProgress,
          SENT_BACK: row.sentBack,
          COMPLETED: row.completed,
          CANNOT_REPAIR: row.cannotRepair,
          VERIFIED: row.verified,
        } satisfies Record<TaskStatus, number>,
        count: row.count,
        emergencies: row.emergencies,
        categories: (row.categories ?? []).sort(),
        activityAt: row.activityAt?.toISOString() ?? null,
      })),
    };
  }

  /* ── the company Overview ─────────────────────────────────────────────── */

  /**
   * Plan §21.2 #3 (R6). Where the company's work stands today, and the last 30
   * days of the three repair events: In progress (first repair photo),
   * Completed on site (Mark done) and Verified (sign-off) — in total, per work
   * type and per team. Same scope as My tasks; `organizationId` narrows a main
   * contractor (or Admin) to one company.
   */
  async getOverview(user: RequestUser, query: MaintenanceOverviewQueryDto) {
    const scope = await this.resolveScope(user);
    const date = query.date?.slice(0, 10) ?? myDay(new Date());
    const dayFrom = dayStart(date);
    const end = nextDayStart(date);
    const start = new Date(dayFrom.getTime() - (OVERVIEW_DAYS - 1) * DAY_MS);
    const weekStart = new Date(dayFrom.getTime() - 6 * DAY_MS);
    const narrowed = query.organizationId
      ? Prisma.sql`d."maintenanceOrganizationId" = ${query.organizationId}::uuid`
      : Prisma.sql`TRUE`;
    const tasks = this.tasksCte(user, scope, narrowed, true);
    const event = (kind: string, column: string) => Prisma.sql`
      SELECT "organizationId", "teamId", ${kind}::text AS "kind", ${Prisma.raw(`"${column}"`)} AS "at" FROM tasks
      WHERE ${Prisma.raw(`"${column}"`)} >= ${start} AND ${Prisma.raw(`"${column}"`)} < ${end}`;

    const [breakdown, events, options] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          organizationId: string;
          organizationName: string;
          teamId: string | null;
          teamName: string | null;
          category: string;
          status: TaskStatus;
          count: number;
          overdue: number;
          pencawang: string[];
        }>
      >`
        ${tasks}
        SELECT "organizationId", "organizationName", "teamId", "teamName", "category", "status",
          COUNT(*)::int AS "count",
          COUNT(*) FILTER (
            WHERE "dueDate" < ${dayFrom} AND "status" IN ('TODO', 'IN_PROGRESS', 'SENT_BACK')
          )::int AS "overdue",
          ARRAY_AGG(DISTINCT "siteVisitId"::text) AS "pencawang"
        FROM tasks
        GROUP BY "organizationId", "organizationName", "teamId", "teamName", "category", "status"
      `,
      this.prisma.$queryRaw<
        Array<{ organizationId: string; teamId: string | null; kind: keyof DayCounts; at: Date }>
      >`
        ${tasks}
        ${event('started', 'startedAt')}
        UNION ALL ${event('completed', 'doneAt')}
        UNION ALL ${event('verified', 'verifiedAt')}
      `,
      // The company picker: the whole scope, whatever is narrowed.
      this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
        ${this.tasksCte(user, scope, Prisma.sql`TRUE`)}
        SELECT DISTINCT "organizationId" AS "id", "organizationName" AS "name" FROM tasks
        ORDER BY "organizationName" ASC
      `,
    ]);

    // Day series: the chosen day and the 29 before it, zero-filled.
    const series = Array.from({ length: OVERVIEW_DAYS }, (_, index) => ({
      date: myDay(new Date(start.getTime() + index * DAY_MS)),
      ...emptyDay(),
    }));
    const seriesByDate = new Map(series.map((point) => [point.date, point]));

    type TeamRow = {
      team: { id: string; name: string } | null;
      company: { id: string; name: string };
      counts: Record<TaskStatus, number>;
      total: number;
      overdue: number;
      openPencawang: Set<string>;
      today: DayCounts;
      week: DayCounts;
    };
    const teams = new Map<string, TeamRow>();
    const teamKey = (organizationId: string, teamId: string | null) => `${organizationId}|${teamId ?? 'NONE'}`;
    const totals = { ...emptyStatusCounts(), total: 0, overdue: 0, noTeam: 0 };
    const byWorkType = new Map<string, { counts: Record<TaskStatus, number>; total: number }>();

    for (const row of breakdown) {
      const key = teamKey(row.organizationId, row.teamId);
      const team =
        teams.get(key) ??
        teams
          .set(key, {
            team: row.teamId ? { id: row.teamId, name: row.teamName ?? '' } : null,
            company: { id: row.organizationId, name: row.organizationName },
            counts: emptyStatusCounts(),
            total: 0,
            overdue: 0,
            openPencawang: new Set(),
            today: emptyDay(),
            week: emptyDay(),
          })
          .get(key)!;
      team.counts[row.status] += row.count;
      team.total += row.count;
      team.overdue += row.overdue;
      if (OPEN_STATUSES.includes(row.status)) {
        for (const id of row.pencawang) team.openPencawang.add(id);
        if (!row.teamId) totals.noTeam += row.count;
      }

      totals[row.status] += row.count;
      totals.total += row.count;
      totals.overdue += row.overdue;

      const workType =
        byWorkType.get(row.category) ??
        byWorkType.set(row.category, { counts: emptyStatusCounts(), total: 0 }).get(row.category)!;
      workType.counts[row.status] += row.count;
      workType.total += row.count;
    }

    for (const row of events) {
      const day = myDay(row.at);
      const point = seriesByDate.get(day);
      if (point) point[row.kind] += 1;
      const team = teams.get(teamKey(row.organizationId, row.teamId));
      if (!team) continue;
      if (day === date) team.today[row.kind] += 1;
      if (row.at >= weekStart) team.week[row.kind] += 1;
    }

    const week = emptyDay();
    for (const point of series.slice(-7)) {
      week.started += point.started;
      week.completed += point.completed;
      week.verified += point.verified;
    }
    const today = series[series.length - 1];
    const categoryOrder = ['RENTIS', 'CAT_TIANG', 'SELENGGARAAN'];

    return {
      scope: scope.kind,
      date,
      days: OVERVIEW_DAYS,
      companies: options,
      totals,
      today: { started: today.started, completed: today.completed, verified: today.verified },
      week,
      series,
      byWorkType: [...byWorkType.entries()]
        .map(([category, value]) => ({ category, ...value }))
        .sort((left, right) => categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category)),
      teams: [...teams.values()]
        .map(({ openPencawang, ...team }) => ({ ...team, openPencawang: openPencawang.size }))
        .sort((left, right) => {
          const open = (row: { counts: Record<TaskStatus, number> }) =>
            OPEN_STATUSES.reduce((sum, status) => sum + row.counts[status], 0);
          return open(right) - open(left) || (left.team?.name ?? '').localeCompare(right.team?.name ?? '');
        }),
    };
  }

  /* ── TNB: Today + Performance (plan §21.2 #1–#2) ──────────────────────── */

  /** TNB (any rank) and ADMIN. A TNB Supervisor sees only its companies. */
  private async resolveTnbScope(user: RequestUser): Promise<TaskScope> {
    if (user.role === UserRole.ADMIN) return { kind: 'ADMIN' };
    const ctx = await buildScopeContext(this.prisma, user);
    if (!ctx.isClientViewer) {
      throw new ForbiddenException('These pages are for TNB.');
    }
    return {
      kind: 'TNB',
      mainheadIds: ctx.clientMainheadIds,
      companyIds: await resolveClientSupervisorCompanyIds(this.prisma, user),
    };
  }

  /**
   * Plan §21.2 #1 — TNB Today: what each contractor company did on a day
   * (default today) in the three R6 states, per work type, with each work
   * type's running % verified; plus the 30-day series across all companies.
   */
  async getTnbToday(user: RequestUser, query: MaintenanceOverviewQueryDto) {
    const scope = await this.resolveTnbScope(user);
    const date = query.date?.slice(0, 10) ?? myDay(new Date());
    const end = nextDayStart(date);
    const start = new Date(dayStart(date).getTime() - (OVERVIEW_DAYS - 1) * DAY_MS);
    const narrowed = query.organizationId
      ? Prisma.sql`d."maintenanceOrganizationId" = ${query.organizationId}::uuid`
      : Prisma.sql`TRUE`;
    const tasks = this.tasksCte(user, scope, narrowed, true);
    const event = (kind: string, column: string) => Prisma.sql`
      SELECT "organizationId", "category", ${kind}::text AS "kind", ${Prisma.raw(`"${column}"`)} AS "at" FROM tasks
      WHERE ${Prisma.raw(`"${column}"`)} >= ${start} AND ${Prisma.raw(`"${column}"`)} < ${end}`;

    const [breakdown, events] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ organizationId: string; organizationName: string; category: string; status: TaskStatus; count: number }>
      >`
        ${tasks}
        SELECT "organizationId", "organizationName", "category", "status", COUNT(*)::int AS "count"
        FROM tasks
        GROUP BY "organizationId", "organizationName", "category", "status"
      `,
      this.prisma.$queryRaw<Array<{ organizationId: string; category: string; kind: keyof DayCounts; at: Date }>>`
        ${tasks}
        ${event('started', 'startedAt')}
        UNION ALL ${event('completed', 'doneAt')}
        UNION ALL ${event('verified', 'verifiedAt')}
      `,
    ]);

    const series = Array.from({ length: OVERVIEW_DAYS }, (_, index) => ({
      date: myDay(new Date(start.getTime() + index * DAY_MS)),
      ...emptyDay(),
    }));
    const seriesByDate = new Map(series.map((point) => [point.date, point]));

    type Lane = { category: string; counts: Record<TaskStatus, number>; total: number; today: DayCounts };
    type Company = { company: { id: string; name: string }; today: DayCounts; total: number; verified: number; lanes: Map<string, Lane> };
    const companies = new Map<string, Company>();
    const laneOf = (organizationId: string, organizationName: string, category: string) => {
      const company =
        companies.get(organizationId) ??
        companies
          .set(organizationId, {
            company: { id: organizationId, name: organizationName },
            today: emptyDay(),
            total: 0,
            verified: 0,
            lanes: new Map(),
          })
          .get(organizationId)!;
      const lane =
        company.lanes.get(category) ??
        company.lanes.set(category, { category, counts: emptyStatusCounts(), total: 0, today: emptyDay() }).get(category)!;
      return { company, lane };
    };
    const names = new Map<string, string>();
    for (const row of breakdown) {
      names.set(row.organizationId, row.organizationName);
      const { company, lane } = laneOf(row.organizationId, row.organizationName, row.category);
      lane.counts[row.status] += row.count;
      lane.total += row.count;
      company.total += row.count;
      if (row.status === 'VERIFIED') company.verified += row.count;
    }
    for (const row of events) {
      const day = myDay(row.at);
      const point = seriesByDate.get(day);
      if (point) point[row.kind] += 1;
      if (day !== date) continue;
      const { company, lane } = laneOf(row.organizationId, names.get(row.organizationId) ?? '', row.category);
      company.today[row.kind] += 1;
      lane.today[row.kind] += 1;
    }

    const categoryOrder = ['RENTIS', 'CAT_TIANG', 'SELENGGARAAN'];
    const today = series[series.length - 1];
    return {
      scope: scope.kind,
      date,
      days: OVERVIEW_DAYS,
      today: { started: today.started, completed: today.completed, verified: today.verified },
      series,
      companies: [...companies.values()]
        .map((company) => ({
          company: company.company,
          today: company.today,
          total: company.total,
          verified: company.verified,
          lanes: [...company.lanes.values()].sort(
            (left, right) => categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category),
          ),
        }))
        .sort((left, right) => left.company.name.localeCompare(right.company.name)),
    };
  }

  /**
   * Plan §21.2 #2 — TNB Performance: per company × work type over a period:
   * given (assigned), completed on site, verified, sent back (+ rate of the
   * decided submissions), cannot repair, average days given → done and
   * done → verified; plus where it stands now (open, overdue Pencawang).
   */
  async getTnbPerformance(user: RequestUser, query: TnbPerformanceOptions) {
    if (!query.from || !query.to || query.from > query.to) {
      throw new BadRequestException('Pick a from date on or before the to date.');
    }
    const scope = await this.resolveTnbScope(user);
    const start = dayStart(query.from);
    const end = nextDayStart(query.to);
    const today = dayStart(myDay(new Date()));
    const narrowed = this.filterSql({
      organizationId: query.organizationId ?? undefined,
      category: query.category ?? undefined,
    });
    const inRange = (column: string) =>
      Prisma.sql`${Prisma.raw(`t."${column}"`)} >= ${start} AND ${Prisma.raw(`t."${column}"`)} < ${end}`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        organizationId: string;
        organizationName: string;
        /** null = the company's total row (GROUPING SETS). */
        category: string | null;
        assigned: number;
        completed: number;
        verified: number;
        cannotRepair: number;
        sentBack: number;
        daysToDone: number | null;
        daysToVerify: number | null;
        open: number;
        overduePencawang: number;
      }>
    >`
      ${this.tasksCte(user, scope, narrowed, true)},
      sent AS (
        SELECT e."defectId", COUNT(*)::int AS "count"
        FROM "DefectTimelineEntry" e
        WHERE e."toLifecycleStatus" = 'IN_PROGRESS'
          AND e."fromLifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING', 'CLOSED')
          AND e."createdAt" >= ${start} AND e."createdAt" < ${end}
        GROUP BY e."defectId"
      )
      SELECT
        t."organizationId", t."organizationName", t."category",
        COUNT(*) FILTER (WHERE ${inRange('assignedAt')})::int AS "assigned",
        COUNT(*) FILTER (WHERE ${inRange('doneAt')})::int AS "completed",
        COUNT(*) FILTER (WHERE ${inRange('verifiedAt')} AND t."status" = 'VERIFIED')::int AS "verified",
        COUNT(*) FILTER (WHERE ${inRange('doneAt')} AND t."status" = 'CANNOT_REPAIR')::int AS "cannotRepair",
        COALESCE(SUM(s."count"), 0)::int AS "sentBack",
        AVG(EXTRACT(EPOCH FROM (t."doneAt" - t."assignedAt")) / 86400)
          FILTER (WHERE ${inRange('doneAt')} AND t."assignedAt" IS NOT NULL AND t."doneAt" >= t."assignedAt")::float AS "daysToDone",
        AVG(EXTRACT(EPOCH FROM (t."verifiedAt" - t."doneAt")) / 86400)
          FILTER (WHERE ${inRange('verifiedAt')} AND t."doneAt" IS NOT NULL AND t."verifiedAt" >= t."doneAt")::float AS "daysToVerify",
        COUNT(*) FILTER (WHERE t."status" IN ('TODO', 'IN_PROGRESS', 'SENT_BACK'))::int AS "open",
        COUNT(DISTINCT t."siteVisitId") FILTER (
          WHERE t."status" IN ('TODO', 'IN_PROGRESS', 'SENT_BACK') AND t."dueDate" < ${today}
        )::int AS "overduePencawang"
      FROM tasks t
      LEFT JOIN sent s ON s."defectId" = t."id"
      -- Per work type AND per company: the totals count each Pencawang once and
      -- average over every Kejanggalan, not over the work-type rows.
      GROUP BY GROUPING SETS (
        (t."organizationId", t."organizationName", t."category"),
        (t."organizationId", t."organizationName")
      )
      ORDER BY t."organizationName" ASC
    `;

    const categoryOrder = ['RENTIS', 'CAT_TIANG', 'SELENGGARAAN'];
    const round = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
    const companies = new Map<
      string,
      { company: { id: string; name: string }; lanes: PerformanceLane[]; total: PerformanceLane | null }
    >();
    for (const row of rows) {
      const lane: PerformanceLane = {
        category: row.category ?? 'ALL',
        assigned: row.assigned,
        completed: row.completed,
        verified: row.verified,
        cannotRepair: row.cannotRepair,
        sentBack: row.sentBack,
        sentBackRate: row.verified + row.sentBack > 0 ? row.sentBack / (row.verified + row.sentBack) : null,
        daysToDone: round(row.daysToDone),
        daysToVerify: round(row.daysToVerify),
        open: row.open,
        overduePencawang: row.overduePencawang,
      };
      const entry =
        companies.get(row.organizationId) ??
        companies
          .set(row.organizationId, {
            company: { id: row.organizationId, name: row.organizationName },
            lanes: [],
            total: null,
          })
          .get(row.organizationId)!;
      if (row.category === null) entry.total = lane;
      else entry.lanes.push(lane);
    }

    return {
      scope: scope.kind,
      from: query.from,
      to: query.to,
      companies: [...companies.values()].map((entry) => ({
        company: entry.company,
        total: entry.total!,
        lanes: entry.lanes.sort(
          (left, right) => categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category),
        ),
      })),
    };
  }

  /** Plan §21.2 #2: the Performance table as Excel (one row per company × work type). */
  async tnbPerformanceWorkbook(user: RequestUser, query: TnbPerformanceOptions): Promise<Buffer> {
    const result = await this.getTnbPerformance(user, query);
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Prestasi');
    const label: Record<string, string> = {
      ALL: 'Semua',
      RENTIS: 'Rentis',
      CAT_TIANG: 'Cat tiang',
      SELENGGARAAN: 'Selenggaraan',
    };
    sheet.columns = [30, 14, 12, 16, 12, 12, 14, 14, 16, 16, 12, 16].map((width) => ({ width }));
    sheet.addRow([`Prestasi syarikat penyelenggaraan - ${query.from} hingga ${query.to}`]).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow([
      'Syarikat',
      'Jenis kerja',
      'Diberi',
      'Siap di tapak',
      'Disahkan',
      'Dihantar balik',
      '% dihantar balik',
      'Tidak dapat dibaiki',
      'Purata hari ke siap',
      'Purata hari ke sah',
      'Masih dibuka',
      'Pencawang lewat',
    ]).font = { bold: true };
    for (const entry of result.companies) {
      for (const lane of [...entry.lanes, entry.total]) {
        const row = sheet.addRow([
          entry.company.name,
          label[lane.category] ?? lane.category,
          lane.assigned,
          lane.completed,
          lane.verified,
          lane.sentBack,
          lane.sentBackRate,
          lane.cannotRepair,
          lane.daysToDone,
          lane.daysToVerify,
          lane.open,
          lane.overduePencawang,
        ]);
        row.getCell(7).numFmt = '0%';
        if (lane.category === 'ALL') row.font = { bold: true };
      }
    }
    sheet.views = [{ state: 'frozen', ySplit: 3 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /* ── Reports by date (plan §21.2 #5, R7) ──────────────────────────────── */

  /**
   * The Pencawang (per company) holding Kejanggalan of a period in the chosen
   * status: VERIFIED = signed off in the range (claimable), COMPLETED = marked
   * done in the range and not yet verified, BOTH = either. Same scope as My
   * tasks. Drives the preview on the Reports page and the by-date ZIP.
   */
  async periodTargets(user: RequestUser, options: RepairPeriodOptions) {
    if (!options.from || !options.to) {
      throw new BadRequestException('Pick a from and a to date.');
    }
    if (options.from > options.to) {
      throw new BadRequestException('The from date is after the to date.');
    }
    const scope = await this.resolveScope(user);
    const start = dayStart(options.from);
    const end = nextDayStart(options.to);
    const status = options.status ?? 'VERIFIED';
    const verified = Prisma.sql`("verifiedAt" >= ${start} AND "verifiedAt" < ${end})`;
    const completed = Prisma.sql`("doneAt" >= ${start} AND "doneAt" < ${end}
      AND "verifiedAt" IS NULL AND "status" IN ('COMPLETED', 'CANNOT_REPAIR'))`;
    const inPeriod =
      status === 'VERIFIED' ? verified : status === 'COMPLETED' ? completed : Prisma.sql`(${verified} OR ${completed})`;
    const filters = this.filterSql({
      organizationId: options.organizationId ?? undefined,
      teamId: options.teamId ?? undefined,
      category: options.category ?? undefined,
    });

    const rows = await this.prisma.$queryRaw<
      Array<{
        siteVisitId: string;
        pencawangName: string | null;
        pencawangCode: string | null;
        organizationId: string;
        organizationName: string;
        count: number;
      }>
    >`
      ${this.tasksCte(user, scope, filters, true)}
      SELECT "siteVisitId", "pencawangName", "pencawangCode", "organizationId", "organizationName",
        COUNT(*)::int AS "count"
      FROM tasks
      WHERE ${inPeriod}
      GROUP BY "siteVisitId", "pencawangName", "pencawangCode", "organizationId", "organizationName"
      ORDER BY "organizationName" ASC, "pencawangName" ASC NULLS LAST
    `;
    return {
      status,
      from: options.from,
      to: options.to,
      pencawang: new Set(rows.map((row) => row.siteVisitId)).size,
      kejanggalan: rows.reduce((sum, row) => sum + row.count, 0),
      targets: rows.map((row) => ({
        siteVisitId: row.siteVisitId,
        pencawangName: row.pencawangName ?? row.pencawangCode,
        company: { id: row.organizationId, name: row.organizationName },
        count: row.count,
      })),
    };
  }

  /* ── one group's Kejanggalan ──────────────────────────────────────────── */

  private scopeWhere(user: RequestUser, scope: TaskScope): Prisma.DefectWhereInput {
    const base: Prisma.DefectWhereInput = {
      maintenanceOrganizationId: { not: null },
      inspectionItemResult: { isDefect: true, inspection: { siteVisit: { tenantId: user.tenantId } } },
    };
    if (scope.kind === 'TNB') {
      return {
        AND: [
          base,
          { inspectionItemResult: { inspection: { siteVisit: { mainheadId: { in: scope.mainheadIds } } } } },
          ...(scope.companyIds ? [{ maintenanceOrganizationId: { in: scope.companyIds } }] : []),
        ],
      };
    }
    if (scope.kind === 'COMPANY') {
      return { AND: [base, { maintenanceOrganizationId: { in: scope.organizationIds } }] };
    }
    if (scope.kind === 'CREW') {
      return {
        AND: [
          base,
          { maintenanceOrganizationId: scope.organizationId },
          {
            OR: [
              { assignedToUserId: scope.userId },
              { assignedUserId: scope.userId },
              ...(scope.teamIds.length > 0
                ? [{ assignedToTeamId: { in: scope.teamIds } }, { assignedTeamId: { in: scope.teamIds } }]
                : []),
            ],
          },
        ],
      };
    }
    return base;
  }

  private itemFilters(query: MaintenanceTaskItemsQueryDto): Prisma.DefectWhereInput[] {
    const where: Prisma.DefectWhereInput[] = [
      { inspectionItemResult: { inspection: { siteVisitId: query.siteVisitId } } },
    ];
    if (query.organizationId) where.push({ maintenanceOrganizationId: query.organizationId });
    if (query.teamId === 'NONE') {
      where.push({ assignedToTeamId: null, assignedTeamId: null });
    } else if (query.teamId) {
      where.push({
        OR: [
          { assignedToTeamId: query.teamId },
          { assignedToTeamId: null, assignedTeamId: query.teamId },
        ],
      });
    }
    if (query.category) {
      // Legacy rows without a work type count as Selenggaraan (same as the board).
      where.push(
        query.category === MaintenanceCategory.SELENGGARAAN
          ? { OR: [{ maintenanceCategory: query.category }, { maintenanceCategory: null }] }
          : { maintenanceCategory: query.category },
      );
    }
    if (query.from || query.to) {
      const range = {
        ...(query.from ? { gte: dayStart(query.from) } : {}),
        ...(query.to ? { lt: nextDayStart(query.to) } : {}),
      };
      where.push({ OR: [{ maintainedAt: range }, { closureVerifiedAt: range }] });
    }
    return where;
  }

  async getItems(user: RequestUser, query: MaintenanceTaskItemsQueryDto) {
    const scope = await this.resolveScope(user);
    const defects = await this.prisma.defect.findMany({
      where: { AND: [this.scopeWhere(user, scope), ...this.itemFilters(query)] },
      take: ITEMS_LIMIT + 1,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        resolutionOutcome: true,
        severity: true,
        isEmergency: true,
        maintenanceCategory: true,
        maintenanceNotes: true,
        assignedAt: true,
        dueDate: true,
        maintainedAt: true,
        closureVerifiedAt: true,
        closureVerificationNotes: true,
        repairMethodNote: true,
        repairMethod: { select: { id: true, label: true } },
        maintainedByUser: { select: { id: true, name: true } },
        closureVerifiedByUser: { select: { id: true, name: true } },
        maintenanceOrganization: { select: { id: true, name: true } },
        assignedToTeam: { select: { id: true, name: true } },
        assignedTeam: { select: { id: true, name: true } },
        evidenceImages: {
          where: REPAIR_EVIDENCE_WHERE,
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            evidenceType: true,
            fileName: true,
            storageKey: true,
            url: true,
            note: true,
            timestamp: true,
            createdAt: true,
          },
        },
        // The latest send-back (reject / re-open) — its reason is what the crew must fix.
        timelineEntries: {
          where: {
            toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
            fromLifecycleStatus: { in: SENT_BACK_FROM },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { comment: true, createdAt: true, createdBy: { select: { id: true, name: true } } },
        },
        inspectionItemResult: {
          select: {
            label: true,
            remark: true,
            source: true,
            inspection: {
              select: {
                asset: { select: { id: true, assetCode: true, noTiangLama: true, name: true } },
              },
            },
          },
        },
      },
    });

    const truncated = defects.length > ITEMS_LIMIT;
    const kept = defects.slice(0, ITEMS_LIMIT);
    const [previousLama, packages] = await Promise.all([
      previousNoTiangLama(
        this.prisma,
        kept.map((defect) => defect.inspectionItemResult.inspection.asset.id),
      ),
      // Targets live on the Pencawang's packages (per work type, or whole).
      this.prisma.maintenancePackage.findMany({
        where: { siteVisitId: query.siteVisitId },
        select: { category: true, maintenanceOrganizationId: true, dueDate: true },
      }),
    ]);
    const targetOf = (defect: (typeof kept)[number]) => {
      const category = defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN;
      const own = packages.filter((pkg) => pkg.maintenanceOrganizationId === defect.maintenanceOrganization?.id);
      return (
        defect.dueDate ??
        own.find((pkg) => pkg.category === category)?.dueDate ??
        own.find((pkg) => pkg.category === null)?.dueDate ??
        null
      );
    };

    const items = kept
      .map((defect) => {
        const status = taskStatus(defect);
        const asset = defect.inspectionItemResult.inspection.asset;
        const sentBack = status === 'SENT_BACK' ? defect.timelineEntries[0] : undefined;
        return {
          id: defect.id,
          status,
          label: defect.inspectionItemResult.label,
          remark: defect.inspectionItemResult.remark,
          isNewFinding: defect.inspectionItemResult.source === 'MAINTENANCE_FINDING',
          severity: defect.severity,
          isEmergency: defect.isEmergency,
          category: defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN,
          company: defect.maintenanceOrganization,
          team: defect.assignedToTeam ?? defect.assignedTeam ?? null,
          assignedAt: defect.assignedAt?.toISOString() ?? null,
          dueDate: targetOf(defect)?.toISOString() ?? null,
          maintainedAt: defect.maintainedAt?.toISOString() ?? null,
          maintainedBy: defect.maintainedByUser,
          maintenanceNotes: defect.maintenanceNotes,
          resolutionOutcome: defect.resolutionOutcome,
          repairMethod: defect.repairMethod
            ? { id: defect.repairMethod.id, label: defect.repairMethod.label, note: defect.repairMethodNote }
            : null,
          verifiedAt: defect.closureVerifiedAt?.toISOString() ?? null,
          verifiedBy: defect.closureVerifiedByUser,
          verificationNotes: defect.closureVerificationNotes,
          sentBack: sentBack
            ? {
                at: sentBack.createdAt.toISOString(),
                by: sentBack.createdBy,
                reason: reasonOf(sentBack.comment),
                comment: sentBack.comment,
              }
            : null,
          asset: {
            id: asset.id,
            assetCode: asset.assetCode,
            noTiangLama: effectiveLama(asset),
            noTiangLamaPrevious: previousLama.get(asset.id) ?? null,
          },
          evidence: defect.evidenceImages.map((image) => ({
            id: image.id,
            evidenceType: image.evidenceType,
            filename: image.fileName,
            path: image.storageKey,
            url: image.url,
            note: image.note,
            timestamp: image.timestamp?.toISOString() ?? null,
            createdAt: image.createdAt.toISOString(),
          })),
        };
      })
      .filter((item) => !query.status || item.status === query.status)
      .sort(
        (left, right) =>
          STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
          (left.asset.noTiangLama ?? left.asset.assetCode).localeCompare(
            right.asset.noTiangLama ?? right.asset.assetCode,
            undefined,
            { numeric: true },
          ),
      );

    return { scope: scope.kind, truncated, items };
  }
}
