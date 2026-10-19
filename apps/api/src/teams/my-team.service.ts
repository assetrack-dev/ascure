import { Injectable } from '@nestjs/common';
import {
  InspectionCompletionStatus,
  SiteVisitStatus,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { taskStatus } from '../maintenance-packages/maintenance-tasks.service';
import type { TaskStatus } from '../maintenance-packages/dto/maintenance-tasks.dto';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Start of a Malaysia (UTC+8) calendar day, `daysAgo` days back. */
function myDayStart(daysAgo = 0) {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(new Date(`${today}T00:00:00+08:00`).getTime() - daysAgo * DAY_MS);
}

/** Surveys the crew may still be working: in the field, or sent back by the DC. */
const OPEN_LIFECYCLES: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.DALAM_RONDAAN,
  SurveyLifecycleStatus.PERLU_PINDAAN,
];
const OPEN_VISITS_LIMIT = 20;

/**
 * Plan §21 (R5) — the field crew's small read-only web view ("My team"):
 * their team(s) and teammates, the team's surveys still open (amendments the DC
 * asked for first, with the remark), poles inspected today / in 7 days, and —
 * for a technician — where the team's maintenance work stands. Own teams only,
 * whoever asks; nothing here can be changed.
 */
@Injectable()
export class MyTeamService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: RequestUser) {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: user.id, isActive: true, team: { isActive: true, tenantId: user.tenantId } },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            code: true,
            organization: { select: { name: true } },
            members: {
              where: { isActive: true, user: { isActive: true } },
              select: { user: { select: { id: true, name: true, role: true } } },
              orderBy: { user: { name: 'asc' } },
            },
            supervisors: {
              where: { isActive: true },
              select: { supervisor: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });
    const teamIds = memberships.map((row) => row.team.id);
    const todayStart = myDayStart(0);
    const weekStart = myDayStart(6);

    const [openVisits, submittedWeek, maintenance] = await Promise.all([
      this.prisma.siteVisit.findMany({
        where: {
          tenantId: user.tenantId,
          teamId: { in: teamIds },
          status: { not: SiteVisitStatus.CANCELLED },
          OR: [{ lifecycleStatus: { in: OPEN_LIFECYCLES } }, { lifecycleStatus: null, status: { not: SiteVisitStatus.COMPLETED } }],
        },
        orderBy: [{ amendmentRequestedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
        take: OPEN_VISITS_LIMIT,
        select: {
          id: true,
          teamId: true,
          pencawangName: true,
          pencawangCode: true,
          lifecycleStatus: true,
          startedAt: true,
          amendmentRemark: true,
          amendmentRequestedAt: true,
          substation: { select: { name: true } },
          _count: { select: { inspections: true } },
        },
      }),
      // Poles inspected (submitted) by the team in the last 7 days.
      this.prisma.inspection.findMany({
        where: {
          tenantId: user.tenantId,
          completionStatus: InspectionCompletionStatus.SUBMITTED,
          submittedAt: { gte: weekStart },
          siteVisit: { teamId: { in: teamIds } },
        },
        select: { assetId: true, createdByUserId: true, submittedAt: true },
      }),
      user.role === UserRole.TECHNICIAN && teamIds.length > 0 ? this.maintenanceCounts(user, teamIds) : null,
    ]);

    const poles = (rows: typeof submittedWeek) => new Set(rows.map((row) => row.assetId)).size;
    const today = submittedWeek.filter((row) => row.submittedAt && row.submittedAt >= todayStart);
    const mine = (rows: typeof submittedWeek) => rows.filter((row) => row.createdByUserId === user.id);

    return {
      teams: memberships.map(({ team }) => ({
        id: team.id,
        name: team.name,
        code: team.code,
        company: team.organization?.name ?? null,
        members: team.members.map(({ user: member }) => ({
          id: member.id,
          name: member.name,
          role: member.role,
          isMe: member.id === user.id,
        })),
        supervisors: team.supervisors.map(({ supervisor }) => supervisor.name),
      })),
      inspected: {
        today: { team: poles(today), mine: poles(mine(today)) },
        week: { team: poles(submittedWeek), mine: poles(mine(submittedWeek)) },
      },
      // Amendments the DC asked for come first (newest request first).
      openSurveys: openVisits
        .map((visit) => ({
          id: visit.id,
          teamId: visit.teamId,
          pencawang: visit.substation?.name ?? visit.pencawangName ?? visit.pencawangCode,
          lifecycleStatus: visit.lifecycleStatus,
          startedAt: visit.startedAt.toISOString(),
          poles: visit._count.inspections,
          amendment:
            visit.lifecycleStatus === SurveyLifecycleStatus.PERLU_PINDAAN
              ? { remark: visit.amendmentRemark, at: visit.amendmentRequestedAt?.toISOString() ?? null }
              : null,
        }))
        .sort((left, right) => Number(Boolean(right.amendment)) - Number(Boolean(left.amendment))),
      maintenance,
    };
  }

  /** A technician's routed Kejanggalan (own teams / own) by status; null when there are none. */
  private async maintenanceCounts(user: RequestUser, teamIds: string[]) {
    const defects = await this.prisma.defect.findMany({
      where: {
        maintenanceOrganizationId: user.organizationId ?? { not: null },
        inspectionItemResult: { isDefect: true, inspection: { tenantId: user.tenantId } },
        OR: [
          { assignedToUserId: user.id },
          { assignedUserId: user.id },
          { assignedToTeamId: { in: teamIds } },
          { assignedTeamId: { in: teamIds } },
        ],
      },
      select: { lifecycleStatus: true, status: true, resolutionOutcome: true, maintainedAt: true },
    });
    if (defects.length === 0) return null;
    const counts: Record<TaskStatus, number> = {
      TODO: 0,
      IN_PROGRESS: 0,
      SENT_BACK: 0,
      COMPLETED: 0,
      CANNOT_REPAIR: 0,
      VERIFIED: 0,
    };
    for (const defect of defects) counts[taskStatus(defect)] += 1;
    return { total: defects.length, counts };
  }
}
