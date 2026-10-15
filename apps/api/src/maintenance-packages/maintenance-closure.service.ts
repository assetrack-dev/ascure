import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectStatus,
  DefectTimelineEventType,
  OrganizationType,
  Prisma,
  ResolutionOutcome,
  UserRole,
} from '@prisma/client';
import { buildScopeContext } from '../common/authorization/scope-context';
import {
  isClientMaintenanceActor,
  resolveClientSupervisorCompanyIds,
} from '../common/authorization/client-maintenance-actor';
import {
  CANNOT_REPAIR_OUTCOMES,
  isCannotRepairOutcome,
  resolveMainContractorOrgIds,
} from '../common/authorization/maintenance-closure';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { effectiveLama } from './maintenance-work.service';
import {
  ReassignCannotRepairDto,
  RepairReasonDto,
  VerificationGroupsQueryDto,
  VerificationQueueQueryDto,
  VerificationTab,
  VerifyRepairDto,
} from './dto/maintenance-closure.dto';
import { REPAIR_EVIDENCE_WHERE } from './package-routing.util';

/** Submitted by the contractor, waiting for someone to sign it off. */
const SUBMITTED_LIFECYCLES: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.COMPLETED,
  DefectLifecycleStatus.VERIFICATION_PENDING,
];

const QUEUE_LIMIT = 200;
const GROUPS_PAGE_SIZE = 20;

/** Start of a Malaysia (UTC+8) day / start of the next one, for yyyy-mm-dd bounds. */
function dayStart(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00+08:00`);
}
function nextDayStart(value: string) {
  const start = dayStart(value);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

type ClosureActor =
  | { kind: 'ADMIN' }
  /** companyIds: a TNB Supervisor's companies (plan §19, N55); null = any company. */
  | { kind: 'TNB'; mainheadIds: string[]; canAct: boolean; companyIds: string[] | null }
  | { kind: 'MAIN_CONTRACTOR'; organizationIds: string[] };

/**
 * Closing the loop on a repaired Kejanggalan (docs/PLAN-maintenance-flow.md
 * §5.3, M1 step 3). Applies ONLY to Kejanggalan routed to a maintenance company
 * (Defect.maintenanceOrganizationId set) — the legacy unrouted flow keeps its
 * existing rules in DefectsService.
 *
 * Owner decisions (2026-09-26):
 *  - verify / reject a repair: TNB Foreman / Technician, the MAIN CONTRACTOR
 *    manager over the routed company, or ADMIN;
 *  - "cannot repair" outcomes: TNB (Foreman / Technician) or ADMIN only — close
 *    as not repairable, send back, or hand to another company;
 *  - re-open a closed Kejanggalan: TNB (Foreman / Technician) or ADMIN;
 *  - TNB Engineer: view only.
 */
@Injectable()
export class MaintenanceClosureService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveActor(user: RequestUser): Promise<ClosureActor> {
    if (user.role === UserRole.ADMIN) {
      return { kind: 'ADMIN' };
    }

    const ctx = await buildScopeContext(this.prisma, user);
    if (ctx.isClientViewer) {
      // A TNB Supervisor acts only on its assigned companies' work (fails closed).
      const supervisorCompanyIds = await resolveClientSupervisorCompanyIds(this.prisma, user);
      return {
        kind: 'TNB',
        mainheadIds: ctx.clientMainheadIds,
        canAct: supervisorCompanyIds !== null ? true : await isClientMaintenanceActor(this.prisma, user),
        companyIds: supervisorCompanyIds,
      };
    }

    const organizationIds = await resolveMainContractorOrgIds(this.prisma, user);
    if (organizationIds) {
      return { kind: 'MAIN_CONTRACTOR', organizationIds };
    }

    throw new ForbiddenException(
      'Repair verification is for TNB, the main contractor manager, or an admin.',
    );
  }

  /**
   * The queue grouped by Pencawang + company (plan §19, N54): light rows — no
   * photos — 20 per page; the page opens one group through getQueue. Same scope
   * and tab rules as getQueue (SQL mirror of scopeWhere + tabWhere).
   */
  async getGroups(user: RequestUser, query: VerificationGroupsQueryDto) {
    const actor = await this.resolveActor(user);
    const tab: VerificationTab = query.tab ?? 'PENDING';
    const page = query.page ?? 0;
    const cannotRepair = [...CANNOT_REPAIR_OUTCOMES].map((outcome) => outcome as string);

    const scopeSql =
      actor.kind === 'TNB'
        ? actor.companyIds
          ? Prisma.sql`AND sv."mainheadId" = ANY(${actor.mainheadIds}::uuid[])
              AND d."maintenanceOrganizationId" = ANY(${actor.companyIds}::uuid[])`
          : Prisma.sql`AND sv."mainheadId" = ANY(${actor.mainheadIds}::uuid[])`
        : actor.kind === 'MAIN_CONTRACTOR'
          ? Prisma.sql`AND d."maintenanceOrganizationId" = ANY(${actor.organizationIds}::uuid[])`
          : Prisma.empty;
    const tabSql =
      tab === 'CLOSED'
        ? Prisma.sql`AND d."lifecycleStatus" = 'CLOSED'`
        : tab === 'CANNOT_REPAIR'
          ? Prisma.sql`AND d."lifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING')
              AND d."resolutionOutcome"::text = ANY(${cannotRepair}::text[])`
          : Prisma.sql`AND d."lifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING')
              AND (d."resolutionOutcome" IS NULL OR NOT (d."resolutionOutcome"::text = ANY(${cannotRepair}::text[])))`;
    const dateColumn = tab === 'CLOSED' ? Prisma.sql`d."closedAt"` : Prisma.sql`d."maintainedAt"`;
    const filterSql = Prisma.join(
      [
        Prisma.sql`TRUE`,
        // One Pencawang's group (a notification deep link opens exactly it).
        query.siteVisitId
          ? Prisma.sql`sv."id" = ${query.siteVisitId}::uuid`
          : Prisma.sql`TRUE`,
        query.organizationId
          ? Prisma.sql`d."maintenanceOrganizationId" = ${query.organizationId}::uuid`
          : Prisma.sql`TRUE`,
        query.category
          ? Prisma.sql`d."maintenanceCategory"::text = ${query.category}`
          : Prisma.sql`TRUE`,
        query.from ? Prisma.sql`${dateColumn} >= ${dayStart(query.from)}` : Prisma.sql`TRUE`,
        query.to ? Prisma.sql`${dateColumn} < ${nextDayStart(query.to)}` : Prisma.sql`TRUE`,
        query.search
          ? Prisma.sql`(COALESCE(sv."pencawangName", st."name", '') ILIKE ${`%${query.search}%`}
              OR COALESCE(sv."pencawangCode", st."code", '') ILIKE ${`%${query.search}%`})`
          : Prisma.sql`TRUE`,
      ],
      ' AND ',
    );
    const fromSql = Prisma.sql`
      FROM "Defect" d
      JOIN "InspectionItemResult" r ON r."id" = d."inspectionItemResultId"
      JOIN "Inspection" i ON i."id" = r."inspectionId"
      JOIN "SiteVisit" sv ON sv."id" = i."siteVisitId"
      JOIN "Organization" o ON o."id" = d."maintenanceOrganizationId"
      LEFT JOIN "Mainhead" mh ON mh."id" = sv."mainheadId"
      -- The visit's name / code snapshot may be empty: fall back to the Pencawang.
      LEFT JOIN "Substation" st ON st."id" = sv."substationId"
      WHERE sv."tenantId" = ${user.tenantId}::uuid
        AND d."maintenanceOrganizationId" IS NOT NULL
        ${scopeSql}
        ${tabSql}
        AND ${filterSql}
    `;
    const order =
      tab === 'CLOSED' ? Prisma.sql`MAX(${dateColumn}) DESC NULLS LAST` : Prisma.sql`MIN(${dateColumn}) ASC NULLS LAST`;

    const [rows, companies] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          siteVisitId: string;
          pencawangName: string | null;
          pencawangCode: string | null;
          mainheadName: string | null;
          organizationId: string;
          organizationName: string;
          count: number;
          emergencies: number;
          categories: string[] | null;
          oldest: Date | null;
          latest: Date | null;
          total: number;
        }>
      >`
        SELECT
          sv."id" AS "siteVisitId",
          COALESCE(sv."pencawangName", st."name") AS "pencawangName",
          COALESCE(sv."pencawangCode", st."code") AS "pencawangCode",
          mh."name" AS "mainheadName",
          o."id" AS "organizationId",
          o."name" AS "organizationName",
          COUNT(*)::int AS "count",
          COUNT(*) FILTER (WHERE d."isEmergency")::int AS "emergencies",
          ARRAY_AGG(DISTINCT COALESCE(d."maintenanceCategory"::text, 'SELENGGARAAN')) AS "categories",
          MIN(${dateColumn}) AS "oldest",
          MAX(${dateColumn}) AS "latest",
          (COUNT(*) OVER ())::int AS "total"
        ${fromSql}
        GROUP BY sv."id", sv."pencawangName", sv."pencawangCode", st."name", st."code", mh."name", o."id", o."name"
        ORDER BY ${order}, COALESCE(sv."pencawangName", st."name") ASC
        LIMIT ${GROUPS_PAGE_SIZE} OFFSET ${page * GROUPS_PAGE_SIZE}
      `,
      // Companies with work on this tab (the company filter's options).
      this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT DISTINCT o."id" AS "id", o."name" AS "name"
        FROM "Defect" d
        JOIN "InspectionItemResult" r ON r."id" = d."inspectionItemResultId"
        JOIN "Inspection" i ON i."id" = r."inspectionId"
        JOIN "SiteVisit" sv ON sv."id" = i."siteVisitId"
        JOIN "Organization" o ON o."id" = d."maintenanceOrganizationId"
        WHERE sv."tenantId" = ${user.tenantId}::uuid
          AND d."maintenanceOrganizationId" IS NOT NULL
          ${scopeSql}
          ${tabSql}
        ORDER BY o."name" ASC
      `,
    ]);

    // Tab badges + what the viewer may do (the page no longer loads the whole
    // queue just for these).
    const scope = this.scopeWhere(user, actor);
    const [pending, cannotRepairCount] = await Promise.all([
      this.prisma.defect.count({
        where: {
          AND: [
            scope,
            {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              OR: [
                { resolutionOutcome: null },
                { resolutionOutcome: { notIn: [...CANNOT_REPAIR_OUTCOMES] } },
              ],
            },
          ],
        },
      }),
      this.prisma.defect.count({
        where: {
          AND: [
            scope,
            {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              resolutionOutcome: { in: [...CANNOT_REPAIR_OUTCOMES] },
            },
          ],
        },
      }),
    ]);

    return {
      actor: { kind: actor.kind, ...this.permissions(actor) },
      counts: { pending, cannotRepair: cannotRepairCount },
      tab,
      page,
      pageSize: GROUPS_PAGE_SIZE,
      totalGroups: rows[0]?.total ?? 0,
      companies,
      groups: rows.map((row) => ({
        siteVisitId: row.siteVisitId,
        pencawangName: row.pencawangName,
        pencawangCode: row.pencawangCode,
        mainhead: row.mainheadName,
        company: { id: row.organizationId, name: row.organizationName },
        count: row.count,
        emergencies: row.emergencies,
        categories: (row.categories ?? []).sort(),
        oldestAt: row.oldest?.toISOString() ?? null,
        latestAt: row.latest?.toISOString() ?? null,
      })),
    };
  }

  private permissions(actor: ClosureActor) {
    const tnbOrAdmin =
      actor.kind === 'ADMIN' || (actor.kind === 'TNB' && actor.canAct);
    return {
      canVerify: tnbOrAdmin || actor.kind === 'MAIN_CONTRACTOR',
      canDecideCannotRepair: tnbOrAdmin,
      canReopen: tnbOrAdmin,
    };
  }

  /** Routed Kejanggalan the actor may see. */
  private scopeWhere(user: RequestUser, actor: ClosureActor): Prisma.DefectWhereInput {
    const tenant: Prisma.DefectWhereInput = {
      maintenanceOrganizationId: { not: null },
      inspectionItemResult: {
        inspection: { siteVisit: { tenantId: user.tenantId } },
      },
    };
    if (actor.kind === 'TNB') {
      return {
        ...tenant,
        ...(actor.companyIds ? { maintenanceOrganizationId: { in: actor.companyIds } } : {}),
        inspectionItemResult: {
          inspection: {
            siteVisit: { tenantId: user.tenantId, mainheadId: { in: actor.mainheadIds } },
          },
        },
      };
    }
    if (actor.kind === 'MAIN_CONTRACTOR') {
      return { ...tenant, maintenanceOrganizationId: { in: actor.organizationIds } };
    }
    return tenant;
  }

  /** Plan §19 (N54): the optional narrowing shared by the queue and the groups. */
  private filterWhere(
    tab: VerificationTab,
    filters: Pick<VerificationQueueQueryDto, 'siteVisitId' | 'organizationId' | 'category' | 'from' | 'to'>,
  ): Prisma.DefectWhereInput[] {
    const where: Prisma.DefectWhereInput[] = [];
    if (filters.siteVisitId) {
      where.push({ inspectionItemResult: { inspection: { siteVisitId: filters.siteVisitId } } });
    }
    if (filters.organizationId) {
      where.push({ maintenanceOrganizationId: filters.organizationId });
    }
    if (filters.category) {
      where.push({ maintenanceCategory: filters.category });
    }
    if (filters.from || filters.to) {
      const range = {
        ...(filters.from ? { gte: dayStart(filters.from) } : {}),
        ...(filters.to ? { lt: nextDayStart(filters.to) } : {}),
      };
      where.push(tab === 'CLOSED' ? { closedAt: range } : { maintainedAt: range });
    }
    return where;
  }

  async getQueue(
    user: RequestUser,
    tab: VerificationTab = 'PENDING',
    filters: Pick<VerificationQueueQueryDto, 'siteVisitId' | 'organizationId' | 'category' | 'from' | 'to'> = {},
  ) {
    const actor = await this.resolveActor(user);
    const cannotRepair = [...CANNOT_REPAIR_OUTCOMES];

    const tabWhere: Prisma.DefectWhereInput =
      tab === 'CLOSED'
        ? { lifecycleStatus: DefectLifecycleStatus.CLOSED }
        : tab === 'CANNOT_REPAIR'
          ? {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              resolutionOutcome: { in: cannotRepair },
            }
          : {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              OR: [
                { resolutionOutcome: null },
                { resolutionOutcome: { notIn: cannotRepair } },
              ],
            };

    const where: Prisma.DefectWhereInput = {
      AND: [this.scopeWhere(user, actor), tabWhere, ...this.filterWhere(tab, filters)],
    };

    const [items, pending, cannotRepairCount] = await Promise.all([
      this.prisma.defect.findMany({
        where,
        orderBy: tab === 'CLOSED' ? { closedAt: 'desc' } : { maintainedAt: 'asc' },
        take: QUEUE_LIMIT,
        select: {
          id: true,
          severity: true,
          isEmergency: true,
          maintenanceCategory: true,
          lifecycleStatus: true,
          resolutionOutcome: true,
          maintenanceNotes: true,
          maintainedAt: true,
          closedAt: true,
          closureVerificationNotes: true,
          repairMethodNote: true,
          evidenceChangedAt: true,
          repairMethod: { select: { id: true, label: true } },
          maintainedByUser: { select: { id: true, name: true } },
          closureVerifiedByUser: { select: { id: true, name: true } },
          maintenanceOrganization: { select: { id: true, name: true } },
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
              latitude: true,
              longitude: true,
              timestamp: true,
              createdAt: true,
            },
          },
          inspectionItemResult: {
            select: {
              label: true,
              remark: true,
              source: true,
              createdAt: true,
              createdBy: { select: { id: true, name: true } },
              inspection: {
                select: {
                  asset: {
                    select: { id: true, assetCode: true, noTiangLama: true, name: true, latitude: true, longitude: true },
                  },
                  siteVisit: {
                    select: {
                      id: true,
                      pencawangName: true,
                      pencawangCode: true,
                      mainheadRecord: { select: { id: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.defect.count({
        where: {
          AND: [
            this.scopeWhere(user, actor),
            {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              OR: [{ resolutionOutcome: null }, { resolutionOutcome: { notIn: cannotRepair } }],
            },
          ],
        },
      }),
      this.prisma.defect.count({
        where: {
          AND: [
            this.scopeWhere(user, actor),
            {
              lifecycleStatus: { in: SUBMITTED_LIFECYCLES },
              resolutionOutcome: { in: cannotRepair },
            },
          ],
        },
      }),
    ]);

    // Plan §20 (P3): No Tiang Lama corrected by maintenance → show the old one too.
    const previousLama = await previousNoTiangLama(
      this.prisma,
      items.map((defect) => defect.inspectionItemResult.inspection.asset.id),
    );

    const permissions = this.permissions(actor);
    // Companies are only needed to hand a cannot-repair item elsewhere.
    const companies = permissions.canDecideCannotRepair
      ? await this.prisma.organization.findMany({
          where: {
            isActive: true,
            type: { in: [OrganizationType.MAIN_CONTRACTOR, OrganizationType.SUBCONTRACTOR] },
            OR: [{ tenantId: user.tenantId }, { tenantId: null }],
            ...(actor.kind === 'TNB' && actor.companyIds ? { id: { in: actor.companyIds } } : {}),
          },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        })
      : [];

    return {
      actor: { kind: actor.kind, ...permissions },
      companies,
      counts: { pending, cannotRepair: cannotRepairCount },
      tab,
      items: items.map((defect) => {
        const inspection = defect.inspectionItemResult.inspection;
        return {
          id: defect.id,
          label: defect.inspectionItemResult.label,
          remark: defect.inspectionItemResult.remark,
          // §13: added during maintenance, not in the survey — verify it on its photos.
          isNewFinding: defect.inspectionItemResult.source === 'MAINTENANCE_FINDING',
          addedBy:
            defect.inspectionItemResult.source === 'MAINTENANCE_FINDING'
              ? defect.inspectionItemResult.createdBy
              : null,
          addedAt:
            defect.inspectionItemResult.source === 'MAINTENANCE_FINDING'
              ? defect.inspectionItemResult.createdAt.toISOString()
              : null,
          severity: defect.severity,
          isEmergency: defect.isEmergency,
          category: defect.maintenanceCategory,
          lifecycleStatus: defect.lifecycleStatus,
          resolutionOutcome: defect.resolutionOutcome,
          cannotRepair: isCannotRepairOutcome(defect.resolutionOutcome),
          maintenanceNotes: defect.maintenanceNotes,
          maintainedAt: defect.maintainedAt?.toISOString() ?? null,
          maintainedBy: defect.maintainedByUser,
          closedAt: defect.closedAt?.toISOString() ?? null,
          closedBy: defect.closureVerifiedByUser,
          closureNotes: defect.closureVerificationNotes,
          company: defect.maintenanceOrganization,
          asset: {
            id: inspection.asset.id,
            assetCode: inspection.asset.assetCode,
            noTiangLama: effectiveLama(inspection.asset),
            latitude: inspection.asset.latitude,
            longitude: inspection.asset.longitude,
          },
          noTiangLamaPrevious: previousLama.get(inspection.asset.id) ?? null,
          // Plan §20 (P2): the kind of repair done.
          repairMethod: defect.repairMethod
            ? { id: defect.repairMethod.id, label: defect.repairMethod.label, note: defect.repairMethodNote }
            : null,
          // Plan §20 (P1): the crew changed photos after submitting — look again.
          photosChangedAfterSubmission: Boolean(
            defect.maintainedAt &&
              defect.evidenceChangedAt &&
              defect.evidenceChangedAt > defect.maintainedAt &&
              defect.lifecycleStatus !== 'CLOSED',
          ),
          siteVisitId: inspection.siteVisit.id,
          pencawangName: inspection.siteVisit.pencawangName,
          pencawangCode: inspection.siteVisit.pencawangCode,
          mainhead: inspection.siteVisit.mainheadRecord,
          evidence: defect.evidenceImages.map((image) => ({
            id: image.id,
            evidenceType: image.evidenceType,
            filename: image.fileName,
            path: image.storageKey,
            url: image.url,
            note: image.note,
            latitude: image.latitude,
            longitude: image.longitude,
            timestamp: image.timestamp?.toISOString() ?? null,
            createdAt: image.createdAt.toISOString(),
          })),
        };
      }),
    };
  }

  private async loadDefect(user: RequestUser, actor: ClosureActor, defectId: string) {
    const defect = await this.prisma.defect.findFirst({
      where: { AND: [{ id: defectId }, this.scopeWhere(user, actor)] },
      select: {
        id: true,
        status: true,
        lifecycleStatus: true,
        resolutionOutcome: true,
        maintenanceOrganizationId: true,
      },
    });
    if (!defect) {
      throw new NotFoundException('Kejanggalan not found.');
    }
    return defect;
  }

  private assertSubmitted(lifecycleStatus: DefectLifecycleStatus | null) {
    if (!lifecycleStatus || !SUBMITTED_LIFECYCLES.includes(lifecycleStatus)) {
      throw new BadRequestException(
        'Only a repair the contractor has submitted can be verified or rejected.',
      );
    }
  }

  /** Verify decides BOTH a repair and a cannot-repair (= close as not repairable). */
  private assertCanDecide(
    actor: ClosureActor,
    outcome: ResolutionOutcome | null,
  ) {
    const permissions = this.permissions(actor);
    if (isCannotRepairOutcome(outcome)) {
      if (!permissions.canDecideCannotRepair) {
        throw new ForbiddenException(
          'Only a TNB Foreman or Technician (or an admin) can decide a cannot-repair item.',
        );
      }
      return;
    }
    if (!permissions.canVerify) {
      throw new ForbiddenException(
        'Only a TNB Foreman or Technician, the main contractor manager, or an admin can verify repairs.',
      );
    }
  }

  async verify(user: RequestUser, defectId: string, dto: VerifyRepairDto) {
    const actor = await this.resolveActor(user);
    const defect = await this.loadDefect(user, actor, defectId);
    this.assertSubmitted(defect.lifecycleStatus);
    this.assertCanDecide(actor, defect.resolutionOutcome);

    const now = new Date();
    const outcome = defect.resolutionOutcome ?? ResolutionOutcome.RESOLVED;
    const notes = dto.notes || null;
    const cannotRepair = isCannotRepairOutcome(defect.resolutionOutcome);

    await this.guardedWrite(
      defect.id,
      SUBMITTED_LIFECYCLES,
      {
        lifecycleStatus: DefectLifecycleStatus.CLOSED,
        status: DefectStatus.CLOSED,
        resolutionOutcome: outcome,
        resolvedAt: now,
        closedAt: now,
        closureVerifiedByUserId: user.id,
        closureVerifiedAt: now,
        closureVerificationNotes: notes,
        closureRemarks: notes,
      },
      {
        type: DefectTimelineEventType.CLOSURE_VERIFIED,
        fromLifecycleStatus: defect.lifecycleStatus,
        toLifecycleStatus: DefectLifecycleStatus.CLOSED,
        fromStatus: defect.status,
        toStatus: DefectStatus.CLOSED,
        comment: `${cannotRepair ? 'Closed as not repairable' : 'Repair verified'} by ${this.actorLabel(actor)}${notes ? `: ${notes}` : '.'}`,
      },
      user.id,
      now,
    );

    return { id: defect.id, lifecycleStatus: DefectLifecycleStatus.CLOSED };
  }

  /** Send the repair back to the same crew (assignment and photos kept). */
  async reject(user: RequestUser, defectId: string, dto: RepairReasonDto) {
    const actor = await this.resolveActor(user);
    const defect = await this.loadDefect(user, actor, defectId);
    this.assertSubmitted(defect.lifecycleStatus);
    this.assertCanDecide(actor, defect.resolutionOutcome);

    const now = new Date();
    await this.guardedWrite(
      defect.id,
      SUBMITTED_LIFECYCLES,
      this.backToWorkData(),
      {
        type: DefectTimelineEventType.STATUS_CHANGED,
        fromLifecycleStatus: defect.lifecycleStatus,
        toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
        fromStatus: defect.status,
        toStatus: DefectStatus.IN_PROGRESS,
        comment: `Repair rejected by ${this.actorLabel(actor)}: ${dto.reason}`,
      },
      user.id,
      now,
    );

    return { id: defect.id, lifecycleStatus: DefectLifecycleStatus.IN_PROGRESS };
  }

  /** TNB re-opens a closed Kejanggalan; it returns to the same crew. */
  async reopen(user: RequestUser, defectId: string, dto: RepairReasonDto) {
    const actor = await this.resolveActor(user);
    if (!this.permissions(actor).canReopen) {
      throw new ForbiddenException(
        'Only a TNB Foreman or Technician (or an admin) can re-open a Kejanggalan.',
      );
    }
    const defect = await this.loadDefect(user, actor, defectId);
    if (defect.lifecycleStatus !== DefectLifecycleStatus.CLOSED) {
      throw new BadRequestException('Only a closed Kejanggalan can be re-opened.');
    }

    const now = new Date();
    await this.guardedWrite(
      defect.id,
      [DefectLifecycleStatus.CLOSED],
      {
        ...this.backToWorkData(),
        closedAt: null,
        closureVerifiedByUserId: null,
        closureVerifiedAt: null,
        closureVerificationNotes: null,
        closureRemarks: null,
      },
      {
        type: DefectTimelineEventType.STATUS_CHANGED,
        fromLifecycleStatus: DefectLifecycleStatus.CLOSED,
        toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
        fromStatus: defect.status,
        toStatus: DefectStatus.IN_PROGRESS,
        comment: `Re-opened by ${this.actorLabel(actor)}: ${dto.reason}`,
      },
      user.id,
      now,
    );

    return { id: defect.id, lifecycleStatus: DefectLifecycleStatus.IN_PROGRESS };
  }

  /** TNB hands a cannot-repair item to another company (photos stay attached). */
  async reassignCannotRepair(
    user: RequestUser,
    defectId: string,
    dto: ReassignCannotRepairDto,
  ) {
    const actor = await this.resolveActor(user);
    if (!this.permissions(actor).canDecideCannotRepair) {
      throw new ForbiddenException(
        'Only a TNB Foreman or Technician (or an admin) can decide a cannot-repair item.',
      );
    }
    const defect = await this.loadDefect(user, actor, defectId);
    this.assertSubmitted(defect.lifecycleStatus);
    if (!isCannotRepairOutcome(defect.resolutionOutcome)) {
      throw new BadRequestException(
        'Only a cannot-repair item can be handed to another company here.',
      );
    }
    if (defect.maintenanceOrganizationId === dto.maintenanceOrganizationId) {
      throw new BadRequestException('This Kejanggalan is already with that company.');
    }

    const company = await this.prisma.organization.findUnique({
      where: { id: dto.maintenanceOrganizationId },
      select: { id: true, name: true, type: true, isActive: true, tenantId: true },
    });
    if (
      !company ||
      !company.isActive ||
      (company.tenantId !== null && company.tenantId !== user.tenantId) ||
      (company.type !== OrganizationType.MAIN_CONTRACTOR &&
        company.type !== OrganizationType.SUBCONTRACTOR)
    ) {
      throw new NotFoundException('Maintenance company not found or inactive.');
    }
    if (actor.kind === 'TNB' && actor.companyIds && !actor.companyIds.includes(company.id)) {
      throw new ForbiddenException('You can only hand this to a company you supervise.');
    }

    const now = new Date();
    await this.guardedWrite(
      defect.id,
      SUBMITTED_LIFECYCLES,
      {
        maintenanceOrganizationId: company.id,
        assignedUserId: null,
        assignedToUserId: null,
        assignedTeamId: null,
        assignedToTeamId: null,
        assignedAt: null,
        lifecycleStatus: DefectLifecycleStatus.VERIFIED,
        status: DefectStatus.OPEN,
        resolutionOutcome: null,
        resolvedAt: null,
        maintainedByUserId: null,
        maintainedAt: null,
        dueDate: null,
      },
      {
        type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
        fromLifecycleStatus: defect.lifecycleStatus,
        toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
        fromStatus: defect.status,
        toStatus: DefectStatus.OPEN,
        comment: `Cannot-repair item handed to ${company.name} by ${this.actorLabel(actor)}: ${dto.reason}`,
      },
      user.id,
      now,
    );

    return { id: defect.id, maintenanceOrganizationId: company.id };
  }

  private backToWorkData(): Prisma.DefectUncheckedUpdateManyInput {
    return {
      lifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
      status: DefectStatus.IN_PROGRESS,
      resolutionOutcome: null,
      resolvedAt: null,
    };
  }

  private actorLabel(actor: ClosureActor) {
    if (actor.kind === 'TNB') return 'TNB';
    if (actor.kind === 'MAIN_CONTRACTOR') return 'the main contractor';
    return 'admin';
  }

  /**
   * Single-winner transition: the write lands only while the Kejanggalan is
   * still in `fromLifecycles`, so two verifiers acting at once can't both win.
   */
  private async guardedWrite(
    defectId: string,
    fromLifecycles: DefectLifecycleStatus[],
    data: Prisma.DefectUncheckedUpdateManyInput,
    timeline: Omit<
      Prisma.DefectTimelineEntryUncheckedCreateInput,
      'id' | 'defectId' | 'createdByUserId' | 'createdAt'
    >,
    userId: string,
    now: Date,
  ) {
    const written = await this.prisma.$transaction(async (tx) => {
      const result = await tx.defect.updateMany({
        where: { id: defectId, lifecycleStatus: { in: fromLifecycles } },
        data,
      });
      if (result.count === 0) {
        return false;
      }
      await tx.defectTimelineEntry.create({
        data: {
          ...timeline,
          id: randomUUID(),
          defectId,
          createdByUserId: userId,
          createdAt: now,
        },
      });
      return true;
    });

    if (!written) {
      throw new ConflictException(
        'This Kejanggalan just changed state — refresh and try again.',
      );
    }
  }
}

/**
 * Plan §20 (P3): for each pole whose No Tiang Lama a maintenance crew
 * corrected, the value it had BEFORE the first such correction — so reports
 * can say "Lama: X (dahulu: Y)".
 */
export async function previousNoTiangLama(
  prisma: PrismaService,
  assetIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();
  const rows = await prisma.assetChangeLog.findMany({
    where: { assetId: { in: ids }, field: 'noTiangLama', source: 'MAINTENANCE' },
    orderBy: { createdAt: 'asc' },
    select: { assetId: true, oldValue: true },
  });
  const previous = new Map<string, string | null>();
  for (const row of rows) {
    if (!previous.has(row.assetId)) previous.set(row.assetId, row.oldValue);
  }
  return previous;
}
