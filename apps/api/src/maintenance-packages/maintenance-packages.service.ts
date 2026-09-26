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
  MaintenanceCategory,
  OrganizationType,
  Prisma,
  SurveyLifecycleStatus,
  UserRole,
} from '@prisma/client';
import { buildScopeContext } from '../common/authorization/scope-context';
import { isClientMaintenanceActor } from '../common/authorization/client-maintenance-actor';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignEmergencyDto,
  AssignMaintenancePackageDto,
} from './dto/assign-maintenance-package.dto';
import {
  applyPackageRouting,
  RELEASED_DEFECT_WHERE,
} from './package-routing.util';

/** A PE becomes assignable once its survey report is final (owner decision B4). */
const ASSIGNABLE_VISIT_STATUSES: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.LAPORAN_SELESAI,
  SurveyLifecycleStatus.ARKIB,
];

const CATEGORY_ORDER: MaintenanceCategory[] = [
  MaintenanceCategory.RENTIS,
  MaintenanceCategory.CAT_TIANG,
  MaintenanceCategory.SELENGGARAAN,
];

const CONTRACTOR_TYPES: OrganizationType[] = [
  OrganizationType.MAIN_CONTRACTOR,
  OrganizationType.SUBCONTRACTOR,
];

/** SQL twin of the "finished" rule in package-routing.util. */
const FINISHED_SQL = Prisma.sql`(
  d."lifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING', 'CLOSED')
  OR d."status" IN ('RESOLVED', 'CLOSED')
)`;

const NOT_FINISHED_WHERE: Prisma.DefectWhereInput = {
  status: { notIn: [DefectStatus.RESOLVED, DefectStatus.CLOSED] },
  OR: [
    { lifecycleStatus: null },
    {
      lifecycleStatus: {
        notIn: [
          DefectLifecycleStatus.COMPLETED,
          DefectLifecycleStatus.VERIFICATION_PENDING,
          DefectLifecycleStatus.CLOSED,
        ],
      },
    },
  ],
};

type ActorScope = {
  /** null = tenant-wide (ADMIN). An empty list means "sees nothing". */
  mainheadIds: string[] | null;
  canAssign: boolean;
};

type LaneRow = {
  siteVisitId: string;
  category: MaintenanceCategory;
  total: number;
  finished: number;
  unrouted: number;
};

/**
 * TNB's maintenance-package board (docs/PLAN-maintenance-flow.md §5, M1 step 2):
 * every surveyed PE whose report is final, its Kejanggalan by work type, and the
 * company each part is assigned to — plus the unrouted emergency queue.
 *
 * Who: ADMIN (tenant-wide) and TNB users (their organization's Mainheads). Every
 * TNB rank may VIEW; only FOREMAN / TECHNICIAN (and ADMIN) may assign.
 */
@Injectable()
export class MaintenancePackagesService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveActor(user: RequestUser): Promise<ActorScope> {
    if (user.role === UserRole.ADMIN) {
      return { mainheadIds: null, canAssign: true };
    }

    const ctx = await buildScopeContext(this.prisma, user);
    if (!ctx.isClientViewer) {
      throw new ForbiddenException(
        'Maintenance packages are managed by TNB and ASCURE admins.',
      );
    }

    return {
      mainheadIds: ctx.clientMainheadIds,
      canAssign: await isClientMaintenanceActor(this.prisma, user),
    };
  }

  private async resolveAssigner(user: RequestUser): Promise<ActorScope> {
    const actor = await this.resolveActor(user);
    if (!actor.canAssign) {
      throw new ForbiddenException(
        'Only a TNB Foreman or Technician (or an admin) can assign maintenance packages.',
      );
    }
    return actor;
  }

  private inScope(actor: ActorScope, mainheadId: string | null): boolean {
    if (actor.mainheadIds === null) {
      return true;
    }
    return mainheadId !== null && actor.mainheadIds.includes(mainheadId);
  }

  async getBoard(user: RequestUser) {
    const actor = await this.resolveActor(user);
    const companies = await this.listCompanies(user.tenantId);

    if (actor.mainheadIds !== null && actor.mainheadIds.length === 0) {
      return { canAssign: actor.canAssign, companies, emergencies: [], pencawangs: [] };
    }

    const scopeSql =
      actor.mainheadIds === null
        ? Prisma.empty
        : Prisma.sql`AND sv."mainheadId" = ANY(${actor.mainheadIds}::uuid[])`;
    const fromSql = Prisma.sql`
      FROM "Defect" d
      JOIN "InspectionItemResult" r ON r."id" = d."inspectionItemResultId"
      JOIN "Inspection" i ON i."id" = r."inspectionId"
      JOIN "SiteVisit" sv ON sv."id" = i."siteVisitId"
      WHERE sv."tenantId" = ${user.tenantId}::uuid
        AND sv."lifecycleStatus" IN ('LAPORAN_SELESAI', 'ARKIB')
        AND r."isDefect" = TRUE
        AND (d."lifecycleStatus" IS NULL OR d."lifecycleStatus" NOT IN ('DETECTED', 'REJECTED'))
        AND (i."completionStatus" = 'SUBMITTED' OR d."isEmergency" = TRUE)
        ${scopeSql}
    `;

    const [laneRows, poleRows] = await Promise.all([
      this.prisma.$queryRaw<LaneRow[]>`
        SELECT
          i."siteVisitId" AS "siteVisitId",
          COALESCE(d."maintenanceCategory"::text, 'SELENGGARAAN') AS "category",
          COUNT(*)::int AS "total",
          COUNT(*) FILTER (WHERE ${FINISHED_SQL})::int AS "finished",
          COUNT(*) FILTER (
            WHERE d."maintenanceOrganizationId" IS NULL AND NOT ${FINISHED_SQL}
          )::int AS "unrouted"
        ${fromSql}
        GROUP BY 1, 2
      `,
      this.prisma.$queryRaw<{ siteVisitId: string; poles: number }[]>`
        SELECT i."siteVisitId" AS "siteVisitId", COUNT(DISTINCT i."assetId")::int AS "poles"
        ${fromSql}
        GROUP BY 1
      `,
    ]);

    const visitIds = [...new Set(laneRows.map((row) => row.siteVisitId))];
    const [visits, emergencies] = await Promise.all([
      visitIds.length === 0
        ? Promise.resolve([])
        : this.prisma.siteVisit.findMany({
            where: { id: { in: visitIds } },
            select: {
              id: true,
              pencawangName: true,
              pencawangCode: true,
              cycleNumber: true,
              operationalScope: true,
              lifecycleStatus: true,
              laporanSelesaiAt: true,
              substation: { select: { id: true, name: true, code: true } },
              mainheadRecord: {
                select: { id: true, name: true, maintenanceOrganizationId: true },
              },
              maintenancePackages: {
                select: {
                  id: true,
                  category: true,
                  dueDate: true,
                  notes: true,
                  assignedAt: true,
                  maintenanceOrganization: { select: { id: true, name: true } },
                  assignedBy: { select: { id: true, name: true } },
                },
              },
            },
          }),
      this.listUnroutedEmergencies(user, actor),
    ]);

    const polesByVisit = new Map(poleRows.map((row) => [row.siteVisitId, row.poles]));
    const lanesByVisit = new Map<string, LaneRow[]>();
    for (const row of laneRows) {
      const rows = lanesByVisit.get(row.siteVisitId) ?? [];
      rows.push(row);
      lanesByVisit.set(row.siteVisitId, rows);
    }

    const pencawangs = visits
      .map((visit) => {
        const rows = lanesByVisit.get(visit.id) ?? [];
        const whole = visit.maintenancePackages.find((pkg) => pkg.category === null);
        const lanes = CATEGORY_ORDER.map((category) => {
          const row = rows.find((candidate) => candidate.category === category);
          const pkg =
            visit.maintenancePackages.find((candidate) => candidate.category === category) ??
            whole ??
            null;
          return {
            category,
            total: row?.total ?? 0,
            open: (row?.total ?? 0) - (row?.finished ?? 0),
            finished: row?.finished ?? 0,
            organization: pkg?.maintenanceOrganization ?? null,
          };
        });
        const total = rows.reduce((sum, row) => sum + row.total, 0);
        const finished = rows.reduce((sum, row) => sum + row.finished, 0);
        const unrouted = rows.reduce((sum, row) => sum + row.unrouted, 0);

        return {
          siteVisitId: visit.id,
          pencawangName: visit.pencawangName ?? visit.substation?.name ?? null,
          pencawangCode: visit.pencawangCode ?? visit.substation?.code ?? null,
          substationId: visit.substation?.id ?? null,
          mainhead: visit.mainheadRecord
            ? { id: visit.mainheadRecord.id, name: visit.mainheadRecord.name }
            : null,
          cycleNumber: visit.cycleNumber,
          operationalScope: visit.operationalScope,
          lifecycleStatus: visit.lifecycleStatus,
          laporanSelesaiAt: visit.laporanSelesaiAt?.toISOString() ?? null,
          suggestedOrganizationId:
            visit.mainheadRecord?.maintenanceOrganizationId ?? null,
          poleCount: polesByVisit.get(visit.id) ?? 0,
          totals: { total, open: total - finished, finished, unrouted },
          lanes,
          packages: visit.maintenancePackages
            .map((pkg) => ({
              id: pkg.id,
              category: pkg.category,
              organization: pkg.maintenanceOrganization,
              dueDate: pkg.dueDate?.toISOString() ?? null,
              notes: pkg.notes,
              assignedAt: pkg.assignedAt.toISOString(),
              assignedBy: pkg.assignedBy,
            }))
            .sort(
              (left, right) =>
                (left.category ? CATEGORY_ORDER.indexOf(left.category) : -1) -
                (right.category ? CATEGORY_ORDER.indexOf(right.category) : -1),
            ),
        };
      })
      .sort(
        (left, right) =>
          (right.laporanSelesaiAt ?? '').localeCompare(left.laporanSelesaiAt ?? ''),
      );

    return { canAssign: actor.canAssign, companies, emergencies, pencawangs };
  }

  private async listCompanies(tenantId: string) {
    return this.prisma.organization.findMany({
      where: {
        isActive: true,
        type: { in: CONTRACTOR_TYPES },
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true, name: true, code: true, type: true, parentOrganizationId: true },
      orderBy: { name: 'asc' },
    });
  }

  private async listUnroutedEmergencies(user: RequestUser, actor: ActorScope) {
    const rows = await this.prisma.defect.findMany({
      where: {
        isEmergency: true,
        maintenanceOrganizationId: null,
        AND: [RELEASED_DEFECT_WHERE, NOT_FINISHED_WHERE],
        inspectionItemResult: {
          isDefect: true,
          inspection: {
            siteVisit: {
              tenantId: user.tenantId,
              ...(actor.mainheadIds === null
                ? {}
                : { mainheadId: { in: actor.mainheadIds } }),
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        severity: true,
        createdAt: true,
        inspectionItemResult: {
          select: {
            label: true,
            remark: true,
            inspection: {
              select: {
                asset: { select: { id: true, assetCode: true } },
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
    });

    return rows.map((row) => {
      const inspection = row.inspectionItemResult.inspection;
      return {
        defectId: row.id,
        label: row.inspectionItemResult.label,
        remark: row.inspectionItemResult.remark,
        severity: row.severity,
        createdAt: row.createdAt.toISOString(),
        asset: inspection.asset,
        siteVisitId: inspection.siteVisit.id,
        pencawangName: inspection.siteVisit.pencawangName,
        pencawangCode: inspection.siteVisit.pencawangCode,
        mainhead: inspection.siteVisit.mainheadRecord,
      };
    });
  }

  private async assertAssignableCompany(tenantId: string, organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, type: true, isActive: true, tenantId: true },
    });
    if (
      !organization ||
      !organization.isActive ||
      (organization.tenantId !== null && organization.tenantId !== tenantId)
    ) {
      throw new NotFoundException('Maintenance company not found or inactive.');
    }
    if (!CONTRACTOR_TYPES.includes(organization.type)) {
      throw new BadRequestException(
        'A package can only go to a main contractor or subcontractor.',
      );
    }
    return organization;
  }

  private async loadAssignableVisit(user: RequestUser, actor: ActorScope, siteVisitId: string) {
    const visit = await this.prisma.siteVisit.findFirst({
      where: { id: siteVisitId, tenantId: user.tenantId },
      select: { id: true, mainheadId: true, lifecycleStatus: true },
    });
    if (!visit || !this.inScope(actor, visit.mainheadId)) {
      throw new NotFoundException('Pencawang survey not found.');
    }
    if (!visit.lifecycleStatus || !ASSIGNABLE_VISIT_STATUSES.includes(visit.lifecycleStatus)) {
      throw new BadRequestException(
        'A Pencawang can be assigned only after its survey report is complete (LAPORAN SELESAI).',
      );
    }
    return visit;
  }

  /** Create or reassign a package (whole PE, or one work type of it). */
  async assign(user: RequestUser, dto: AssignMaintenancePackageDto) {
    const actor = await this.resolveAssigner(user);
    const visit = await this.loadAssignableVisit(user, actor, dto.siteVisitId);
    const company = await this.assertAssignableCompany(
      user.tenantId,
      dto.maintenanceOrganizationId,
    );
    const category = dto.category ?? null;
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const notes = dto.notes ?? null;
    const now = new Date();

    const routing = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.maintenancePackage.findMany({
          where: { siteVisitId: visit.id },
        });
        const whole = existing.find((pkg) => pkg.category === null) ?? null;
        const fields = {
          maintenanceOrganizationId: company.id,
          dueDate,
          notes,
          assignedByUserId: user.id,
          assignedAt: now,
        };

        if (category === null) {
          // Whole PE: replaces any per-work-type split.
          await tx.maintenancePackage.deleteMany({
            where: { siteVisitId: visit.id, category: { not: null } },
          });
          if (whole) {
            await tx.maintenancePackage.update({ where: { id: whole.id }, data: fields });
          } else {
            await tx.maintenancePackage.create({
              data: { tenantId: user.tenantId, siteVisitId: visit.id, category: null, ...fields },
            });
          }
        } else {
          if (whole) {
            // Splitting a whole-PE package: the OTHER work types present on this
            // PE keep the whole package's company, then the chosen one changes.
            const presentCategories = await this.presentCategories(tx, visit.id);
            const others = presentCategories.filter((candidate) => candidate !== category);
            await tx.maintenancePackage.delete({ where: { id: whole.id } });
            if (others.length > 0) {
              await tx.maintenancePackage.createMany({
                data: others.map((other) => ({
                  tenantId: user.tenantId,
                  siteVisitId: visit.id,
                  category: other,
                  maintenanceOrganizationId: whole.maintenanceOrganizationId,
                  dueDate: whole.dueDate,
                  notes: whole.notes,
                  assignedByUserId: whole.assignedByUserId,
                  assignedAt: whole.assignedAt,
                })),
              });
            }
          }
          await tx.maintenancePackage.upsert({
            where: { siteVisitId_category: { siteVisitId: visit.id, category } },
            update: fields,
            create: { tenantId: user.tenantId, siteVisitId: visit.id, category, ...fields },
          });
        }

        return applyPackageRouting(tx, visit.id, {
          actorUserId: user.id,
          now,
          reason: 'Pencawang package assigned',
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { siteVisitId: visit.id, routing };
  }

  /** Withdraw a package; its not-yet-started Kejanggalan return to TNB. */
  async unassign(user: RequestUser, packageId: string) {
    const actor = await this.resolveAssigner(user);
    const pkg = await this.prisma.maintenancePackage.findFirst({
      where: { id: packageId, tenantId: user.tenantId },
      select: { id: true, siteVisitId: true, siteVisit: { select: { mainheadId: true } } },
    });
    if (!pkg || !this.inScope(actor, pkg.siteVisit.mainheadId)) {
      throw new NotFoundException('Maintenance package not found.');
    }

    const routing = await this.prisma.$transaction(
      async (tx) => {
        await tx.maintenancePackage.delete({ where: { id: pkg.id } });
        return applyPackageRouting(tx, pkg.siteVisitId, {
          actorUserId: user.id,
          now: new Date(),
          reason: 'Pencawang package withdrawn',
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { siteVisitId: pkg.siteVisitId, routing };
  }

  /** Route an emergency whose PE has no package covering it (manual, per owner). */
  async assignEmergency(user: RequestUser, defectId: string, dto: AssignEmergencyDto) {
    const actor = await this.resolveAssigner(user);
    const defect = await this.prisma.defect.findFirst({
      where: {
        id: defectId,
        isEmergency: true,
        inspectionItemResult: { inspection: { siteVisit: { tenantId: user.tenantId } } },
      },
      select: {
        id: true,
        lifecycleStatus: true,
        maintenanceOrganizationId: true,
        inspectionItemResult: {
          select: { inspection: { select: { siteVisit: { select: { mainheadId: true } } } } },
        },
      },
    });
    if (
      !defect ||
      !this.inScope(actor, defect.inspectionItemResult.inspection.siteVisit.mainheadId)
    ) {
      throw new NotFoundException('Emergency not found.');
    }
    const company = await this.assertAssignableCompany(
      user.tenantId,
      dto.maintenanceOrganizationId,
    );

    const now = new Date();
    const assigned = await this.prisma.$transaction(async (tx) => {
      // Single winner: only an emergency that is STILL unrouted and open moves.
      const result = await tx.defect.updateMany({
        where: {
          id: defect.id,
          maintenanceOrganizationId: null,
          AND: [RELEASED_DEFECT_WHERE, NOT_FINISHED_WHERE],
        },
        data: { maintenanceOrganizationId: company.id },
      });
      if (result.count === 0) {
        return false;
      }
      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.ASSIGNMENT_CHANGED,
          fromLifecycleStatus: defect.lifecycleStatus,
          toLifecycleStatus: defect.lifecycleStatus,
          comment: `Emergency routed to ${company.name}.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
      return true;
    });

    if (!assigned) {
      throw new ConflictException(
        'This emergency is already routed or closed — refresh and try again.',
      );
    }

    return { defectId: defect.id, maintenanceOrganizationId: company.id };
  }

  private async presentCategories(
    tx: Prisma.TransactionClient,
    siteVisitId: string,
  ): Promise<MaintenanceCategory[]> {
    const rows = await tx.defect.findMany({
      where: {
        inspectionItemResult: { isDefect: true, inspection: { siteVisitId } },
        ...RELEASED_DEFECT_WHERE,
      },
      select: { maintenanceCategory: true },
      distinct: ['maintenanceCategory'],
    });
    return [
      ...new Set(
        rows.map((row) => row.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN),
      ),
    ];
  }
}
