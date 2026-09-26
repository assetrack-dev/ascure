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
import { isClientMaintenanceActor } from '../common/authorization/client-maintenance-actor';
import {
  CANNOT_REPAIR_OUTCOMES,
  isCannotRepairOutcome,
  resolveMainContractorOrgIds,
} from '../common/authorization/maintenance-closure';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  ReassignCannotRepairDto,
  RepairReasonDto,
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

type ClosureActor =
  | { kind: 'ADMIN' }
  | { kind: 'TNB'; mainheadIds: string[]; canAct: boolean }
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
      return {
        kind: 'TNB',
        mainheadIds: ctx.clientMainheadIds,
        canAct: await isClientMaintenanceActor(this.prisma, user),
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

  async getQueue(user: RequestUser, tab: VerificationTab = 'PENDING') {
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
      AND: [this.scopeWhere(user, actor), tabWhere],
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
              inspection: {
                select: {
                  asset: {
                    select: { id: true, assetCode: true, latitude: true, longitude: true },
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

    const permissions = this.permissions(actor);
    // Companies are only needed to hand a cannot-repair item elsewhere.
    const companies = permissions.canDecideCannotRepair
      ? await this.prisma.organization.findMany({
          where: {
            isActive: true,
            type: { in: [OrganizationType.MAIN_CONTRACTOR, OrganizationType.SUBCONTRACTOR] },
            OR: [{ tenantId: user.tenantId }, { tenantId: null }],
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
          asset: inspection.asset,
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
