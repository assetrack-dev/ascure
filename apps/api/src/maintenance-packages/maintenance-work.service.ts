import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DefectLifecycleStatus,
  DefectStatus,
  DefectTimelineEventType,
  InspectionCompletionStatus,
  InspectionItemResultSource,
  MaintenanceCategory,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { buildScopeContext } from '../common/authorization/scope-context';
import { evidenceTypeLabel, isRepairStageEvidenceType } from '../defects/evidence-types';
import { isCannotRepairOutcome } from '../common/authorization/maintenance-closure';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AddMaintenanceFindingDto } from './dto/maintenance-finding.dto';
import { createMaintenanceFinding, loadVisitFindingItems } from './maintenance-finding.util';
import { MATERIAL_SELECT, loadMaterialCatalog, serializeMaterials } from './maintenance-materials.util';
import { resolveRoutingTarget } from './package-routing.util';
import { pickPolePhotos, type PolePhoto } from './pole-photos.util';

/**
 * The contractor crew's "my work" (docs/PLAN-maintenance-flow.md §7.1, M2):
 * the routed Kejanggalan a maintenance user is responsible for, grouped into
 * Pencawang packages, and per package every pole with its Kejanggalan, survey
 * photos and repair-photo progress — shaped so the mobile app can cache it
 * whole and work offline.
 *
 * Scope (owner decision D10) — ROUTED Kejanggalan only (maintenanceOrganizationId
 * set; the legacy unrouted flow stays on the existing defect screens):
 *  - MANAGER: the company's whole pool incl. subcontractor subtree;
 *  - SUPERVISOR: work assigned to the teams they supervise or belong to;
 *  - TECHNICIAN: work assigned to their own team(s) or to them personally.
 */

export type WorkState = 'TODO' | 'IN_PROGRESS' | 'SUBMITTED' | 'CLOSED';

const SUBMITTED: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.COMPLETED,
  DefectLifecycleStatus.VERIFICATION_PENDING,
];

function workState(defect: {
  lifecycleStatus: DefectLifecycleStatus | null;
  status: DefectStatus;
}): WorkState {
  if (defect.lifecycleStatus === DefectLifecycleStatus.CLOSED || defect.status === DefectStatus.CLOSED) {
    return 'CLOSED';
  }
  if (defect.lifecycleStatus && SUBMITTED.includes(defect.lifecycleStatus)) {
    return 'SUBMITTED';
  }
  if (defect.lifecycleStatus === DefectLifecycleStatus.IN_PROGRESS) {
    return 'IN_PROGRESS';
  }
  return 'TODO';
}

type Counts = Record<WorkState, number>;
const emptyCounts = (): Counts => ({ TODO: 0, IN_PROGRESS: 0, SUBMITTED: 0, CLOSED: 0 });

@Injectable()
export class MaintenanceWorkService {
  constructor(private readonly prisma: PrismaService) {}

  /** Which routed Kejanggalan this user works on (never the legacy pool). */
  private async workScope(user: RequestUser): Promise<{
    where: Prisma.DefectWhereInput;
    role: 'MANAGER' | 'SUPERVISOR' | 'TECHNICIAN';
    /** Which owners (company, team) count as this user's — for pole pickers. */
    owns: (target: { organizationId: string | null; teamId: string | null }) => boolean;
  }> {
    if (!user.organizationId) {
      throw new ForbiddenException('Your account is not linked to a maintenance company.');
    }
    const tenant: Prisma.DefectWhereInput = {
      inspectionItemResult: { isDefect: true, inspection: { tenantId: user.tenantId } },
    };

    if (user.role === UserRole.MANAGER) {
      const ctx = await buildScopeContext(this.prisma, user);
      const organizationIds =
        ctx.maintenanceOrgIds.length > 0 ? ctx.maintenanceOrgIds : [user.organizationId];
      return {
        role: 'MANAGER',
        where: { ...tenant, maintenanceOrganizationId: { in: organizationIds } },
        owns: (target) => target.organizationId !== null && organizationIds.includes(target.organizationId),
      };
    }

    if (user.role !== UserRole.SUPERVISOR && user.role !== UserRole.TECHNICIAN) {
      throw new ForbiddenException('Maintenance work is for contractor managers, supervisors and technicians.');
    }

    const [memberships, supervised] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { userId: user.id, isActive: true },
        select: { teamId: true },
      }),
      user.role === UserRole.SUPERVISOR
        ? this.prisma.teamSupervisor.findMany({
            where: { supervisorUserId: user.id, isActive: true },
            select: { teamId: true },
          })
        : Promise.resolve([]),
    ]);
    const teamIds = [...new Set([...memberships, ...supervised].map((row) => row.teamId))];

    const organizationId = user.organizationId;
    return {
      role: user.role === UserRole.SUPERVISOR ? 'SUPERVISOR' : 'TECHNICIAN',
      // A company-only owner (no team) counts: a new finding there goes to the
      // adding crew's own team (assignOwnTeamIfUnassigned).
      owns: (target) =>
        target.organizationId === organizationId &&
        (target.teamId === null || teamIds.includes(target.teamId)),
      where: {
        ...tenant,
        maintenanceOrganizationId: user.organizationId,
        OR: [
          { assignedToUserId: user.id },
          { assignedUserId: user.id },
          ...(teamIds.length > 0
            ? [{ assignedToTeamId: { in: teamIds } }, { assignedTeamId: { in: teamIds } }]
            : []),
        ],
      },
    };
  }

  /** Is this routed Kejanggalan part of the user's maintenance work? */
  async isInWorkScope(user: RequestUser, defectId: string): Promise<boolean> {
    if (!user.organizationId) return false;
    const scope = await this.workScope(user);
    const found = await this.prisma.defect.findFirst({
      where: { AND: [scope.where, { id: defectId }] },
      select: { id: true },
    });
    return Boolean(found);
  }

  /** The user's Pencawang packages with progress counts. */
  async listPackages(user: RequestUser) {
    const scope = await this.workScope(user);
    const defects = await this.prisma.defect.findMany({
      where: scope.where,
      select: {
        lifecycleStatus: true,
        status: true,
        maintenanceCategory: true,
        isEmergency: true,
        inspectionItemResult: {
          select: {
            inspection: {
              select: {
                assetId: true,
                asset: { select: { latitude: true, longitude: true } },
                siteVisitId: true,
              },
            },
          },
        },
      },
    });

    type Acc = {
      counts: Counts;
      poles: Set<string>;
      emergencies: number;
      categories: Set<MaintenanceCategory>;
      lat: number;
      lng: number;
      located: number;
    };
    const byVisit = new Map<string, Acc>();
    for (const defect of defects) {
      const inspection = defect.inspectionItemResult.inspection;
      let acc = byVisit.get(inspection.siteVisitId);
      if (!acc) {
        acc = { counts: emptyCounts(), poles: new Set(), emergencies: 0, categories: new Set(), lat: 0, lng: 0, located: 0 };
        byVisit.set(inspection.siteVisitId, acc);
      }
      acc.counts[workState(defect)] += 1;
      acc.categories.add(defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN);
      if (defect.isEmergency && workState(defect) !== 'CLOSED') acc.emergencies += 1;
      if (!acc.poles.has(inspection.assetId)) {
        acc.poles.add(inspection.assetId);
        if (inspection.asset.latitude !== null && inspection.asset.longitude !== null) {
          acc.lat += inspection.asset.latitude;
          acc.lng += inspection.asset.longitude;
          acc.located += 1;
        }
      }
    }

    const visitIds = [...byVisit.keys()];
    const visits =
      visitIds.length === 0
        ? []
        : await this.prisma.siteVisit.findMany({
            where: { id: { in: visitIds } },
            select: {
              id: true,
              pencawangName: true,
              pencawangCode: true,
              cycleNumber: true,
              substation: { select: { name: true, code: true } },
              mainheadRecord: { select: { id: true, name: true } },
              maintenancePackages: {
                select: { category: true, dueDate: true, notes: true },
              },
            },
          });

    const packages = visits
      .map((visit) => {
        const acc = byVisit.get(visit.id)!;
        const dueDates = visit.maintenancePackages
          .map((pkg) => pkg.dueDate)
          .filter((date): date is Date => date !== null)
          .sort((left, right) => left.getTime() - right.getTime());
        return {
          siteVisitId: visit.id,
          pencawangName: visit.pencawangName ?? visit.substation?.name ?? null,
          pencawangCode: visit.pencawangCode ?? visit.substation?.code ?? null,
          mainhead: visit.mainheadRecord,
          cycleNumber: visit.cycleNumber,
          // Earliest TNB target across the PE's packages.
          dueDate: dueDates[0]?.toISOString() ?? null,
          notes: visit.maintenancePackages.map((pkg) => pkg.notes).filter(Boolean).join(' · ') || null,
          categories: [...acc.categories],
          poleCount: acc.poles.size,
          emergencyCount: acc.emergencies,
          counts: acc.counts,
          center:
            acc.located > 0
              ? { latitude: acc.lat / acc.located, longitude: acc.lng / acc.located }
              : null,
        };
      })
      // Most outstanding work first, then nearest target date.
      .sort(
        (left, right) =>
          right.counts.TODO + right.counts.IN_PROGRESS - (left.counts.TODO + left.counts.IN_PROGRESS) ||
          (left.dueDate ?? '9999').localeCompare(right.dueDate ?? '9999'),
      );

    return { role: scope.role, packages };
  }

  /** Every pole of one package with its Kejanggalan — the offline work pack. */
  async getPackage(user: RequestUser, siteVisitId: string) {
    const scope = await this.workScope(user);
    const defects = await this.prisma.defect.findMany({
      where: {
        AND: [scope.where, { inspectionItemResult: { inspection: { siteVisitId } } }],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        severity: true,
        isEmergency: true,
        maintenanceCategory: true,
        lifecycleStatus: true,
        status: true,
        resolutionOutcome: true,
        maintenanceNotes: true,
        maintainedAt: true,
        maintenanceOrganizationId: true,
        repairMethodNote: true,
        repairMethod: { select: { id: true, label: true } },
        assignedToTeam: { select: { id: true, name: true } },
        assignedTeam: { select: { id: true, name: true } },
        timelineEntries: {
          where: { type: 'STATUS_CHANGED', toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { comment: true, createdAt: true },
        },
        evidenceImages: {
          where: { evidenceType: { in: ['BEFORE', 'DURING', 'AFTER'] } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, evidenceType: true, url: true, sizeBytes: true, timestamp: true, createdAt: true },
        },
        // TNB feedback #1: materials used for the repair.
        materials: { select: MATERIAL_SELECT },
        inspectionItemResult: {
          select: {
            label: true,
            remark: true,
            checklistItemId: true,
            source: true,
            createdAt: true,
            createdBy: { select: { name: true } },
            inspection: {
              select: {
                id: true,
                submittedAt: true,
                asset: {
                  select: {
                    id: true,
                    assetCode: true,
                    noTiangLama: true,
                    // The app stores NO TIANG LAMA as the pole's name; only
                    // imports fill noTiangLama — read both (effectiveLama).
                    name: true,
                    latitude: true,
                    longitude: true,
                  },
                },
                inspectionImages: {
                  select: { id: true, url: true, templateItemId: true, sizeBytes: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    if (defects.length === 0) {
      // Either not theirs or nothing routed — same answer, no existence leak.
      throw new NotFoundException('No maintenance work for you on this Pencawang.');
    }

    const [visit, packages, visitPoles, findingTemplates, materialCatalog] = await Promise.all([
      this.prisma.siteVisit.findUniqueOrThrow({
        where: { id: siteVisitId },
        select: {
          id: true,
          pencawangName: true,
          pencawangCode: true,
          substation: { select: { name: true, code: true } },
          mainheadRecord: { select: { id: true, name: true } },
        },
      }),
      this.prisma.maintenancePackage.findMany({
        where: { siteVisitId },
        select: { category: true, dueDate: true, maintenanceOrganizationId: true, assignedTeamId: true },
      }),
      // Every surveyed pole of the PE — a new finding may go on a pole that had
      // no Kejanggalan at survey time (§13).
      // Latest submitted inspection per pole; its photos help the crew
      // recognise the pole on site (§14).
      this.prisma.inspection.findMany({
        where: { siteVisitId, completionStatus: InspectionCompletionStatus.SUBMITTED },
        distinct: ['assetId'],
        orderBy: [{ assetId: 'asc' }, { submittedAt: 'desc' }],
        select: {
          templateId: true,
          asset: {
            select: { id: true, assetCode: true, noTiangLama: true, name: true, latitude: true, longitude: true },
          },
          inspectionImages: {
            select: { id: true, url: true, templateItemId: true, sizeBytes: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      loadVisitFindingItems(this.prisma, siteVisitId),
      loadMaterialCatalog(this.prisma),
    ]);
    const repairMethods = await listActiveRepairMethods(this.prisma);
    const poleOwners = await this.prisma.maintenancePoleAssignment.findMany({
      where: { siteVisitId },
      select: { assetId: true, category: true, maintenanceOrganizationId: true, assignedTeamId: true },
    });
    const photoItemIds = [
      ...new Set(
        visitPoles.flatMap((row) =>
          row.inspectionImages.map((image) => image.templateItemId).filter((id): id is string => id !== null),
        ),
      ),
    ];
    const photoItemLabels = new Map(
      photoItemIds.length === 0
        ? []
        : (
            await this.prisma.inspectionTemplateItem.findMany({
              where: { id: { in: photoItemIds } },
              select: { id: true, label: true },
            })
          ).map((item) => [item.id, item.label] as const),
    );
    const polePhotos = new Map<string, PolePhoto[]>(
      visitPoles.map((row) => [row.asset.id, pickPolePhotos(row.inspectionImages, photoItemLabels)]),
    );
    const ALL_CATEGORIES = Object.values(MaintenanceCategory);
    /** The work types this user may raise a finding for on a pole (§13). */
    const findingCategories = (assetId: string) =>
      ALL_CATEGORIES.filter((category) =>
        scope.owns(resolveRoutingTarget(packages, poleOwners, assetId, category)),
      );

    type Pole = {
      assetId: string;
      assetCode: string;
      refCode: string | null;
      noTiangLama: string | null;
      latitude: number | null;
      longitude: number | null;
      counts: Counts;
      photos: PolePhoto[];
      kejanggalan: unknown[];
      canEditNoTiangLama: boolean;
    };
    const poles = new Map<string, Pole>();

    for (const defect of defects) {
      const item = defect.inspectionItemResult;
      const asset = item.inspection.asset;
      let pole = poles.get(asset.id);
      if (!pole) {
        pole = { assetId: asset.id, assetCode: asset.assetCode, refCode: null, noTiangLama: effectiveLama(asset), latitude: asset.latitude, longitude: asset.longitude, counts: emptyCounts(), photos: polePhotos.get(asset.id) ?? [], kejanggalan: [], canEditNoTiangLama: false };
        poles.set(asset.id, pole);
      }
      const state = workState(defect);
      pole.counts[state] += 1;

      // The survey photo(s) of THIS Kejanggalan (tagged with its checklist
      // item); falls back to nothing rather than every photo of the pole.
      const surveyPhotos = item.checklistItemId
        ? item.inspection.inspectionImages.filter((image) => image.templateItemId === item.checklistItemId)
        : [];
      const stage = (type: string) =>
        defect.evidenceImages
          .filter((image) => image.evidenceType === type)
          .map((image) => ({
            id: image.id,
            url: image.url,
            sizeBytes: image.sizeBytes,
            takenAt: (image.timestamp ?? image.createdAt).toISOString(),
          }));
      const category = defect.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN;
      const packageDue = (
        packages.find((pkg) => pkg.category === category) ??
        packages.find((pkg) => pkg.category === null)
      )?.dueDate;

      const isNewFinding = item.source === InspectionItemResultSource.MAINTENANCE_FINDING;
      pole.kejanggalan.push({
        id: defect.id,
        label: item.label,
        // §13: added during maintenance, not in the survey.
        isNewFinding,
        addedBy: isNewFinding ? item.createdBy?.name ?? null : null,
        addedAt: isNewFinding ? item.createdAt.toISOString() : null,
        remark: item.remark,
        severity: defect.severity,
        isEmergency: defect.isEmergency,
        category,
        state,
        lifecycleStatus: defect.lifecycleStatus,
        resolutionOutcome: defect.resolutionOutcome,
        cannotRepair: isCannotRepairOutcome(defect.resolutionOutcome),
        maintenanceNotes: defect.maintenanceNotes,
        submittedAt: defect.maintainedAt?.toISOString() ?? null,
        team: defect.assignedToTeam ?? defect.assignedTeam,
        // Why TNB / the main contractor sent it back, if they did.
        sentBackReason: state === 'IN_PROGRESS' ? defect.timelineEntries[0]?.comment ?? null : null,
        dueDate: packageDue?.toISOString() ?? null,
        surveyedAt: item.inspection.submittedAt?.toISOString() ?? null,
        surveyPhotos: surveyPhotos.map((image) => ({ id: image.id, url: image.url, sizeBytes: image.sizeBytes })),
        photos: { BEFORE: stage('BEFORE'), DURING: stage('DURING'), AFTER: stage('AFTER') },
        materials: serializeMaterials(defect.materials),
        // Plan §20 (P2): the kind of repair done (Rentis: KAEDAH LAZIM …).
        repairMethod: defect.repairMethod
          ? { id: defect.repairMethod.id, label: defect.repairMethod.label, note: defect.repairMethodNote }
          : null,
        // Plan §20 (P1): photos / repair type can be corrected until TNB verifies.
        canCorrect: state !== 'CLOSED',
      });
      // Plan §20 (P3): No Tiang Lama is editable while any work on the pole is unverified.
      if (state !== 'CLOSED') pole.canEditNoTiangLama = true;
    }

    const poleList = [...poles.values()].sort((left, right) =>
      left.assetCode.localeCompare(right.assetCode, undefined, { numeric: true }),
    );
    const counts = emptyCounts();
    for (const pole of poleList) {
      (Object.keys(counts) as WorkState[]).forEach((state) => (counts[state] += pole.counts[state]));
    }

    return {
      role: scope.role,
      siteVisitId: visit.id,
      pencawangName: visit.pencawangName ?? visit.substation?.name ?? null,
      pencawangCode: visit.pencawangCode ?? visit.substation?.code ?? null,
      mainhead: visit.mainheadRecord,
      counts,
      poles: poleList,
      // §13 — for "Add Kejanggalan": every surveyed pole (incl. ones with no
      // work yet) with its checklist template, and each template's items that
      // can carry a defect. Shipped with the pack so adding works offline.
      // Only poles where at least one work type is this crew's; each lists the
      // work types it may add (a split PE gives other poles to other teams).
      surveyedPoles: visitPoles
        .map(({ asset, templateId }) => ({
          photos: polePhotos.get(asset.id) ?? [],
          assetId: asset.id,
          assetCode: asset.assetCode,
          refCode: null, // prod has no Asset.refCode (see 65150de)
          noTiangLama: effectiveLama(asset),
          latitude: asset.latitude,
          longitude: asset.longitude,
          templateId,
          categories: findingCategories(asset.id),
        }))
        .filter((pole) => pole.categories.length > 0)
        .sort((left, right) => left.assetCode.localeCompare(right.assetCode, undefined, { numeric: true })),
      findingTemplates,
      // TNB feedback #1 — the TNB material list, shipped with the pack so the
      // crew can record materials offline.
      materialCatalog,
      // Plan §20 (P2) — the kinds of repair per work type, for "Mark done" offline.
      repairMethods,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * The crew adds a Kejanggalan that was not in the survey (§13). It is routed
   * like any other; if the package names no team, it goes to the adding crew's
   * own team so they can complete it. Refused (rolled back) when the pole / work
   * type belongs to another company or team.
   */
  async addFinding(user: RequestUser, siteVisitId: string, dto: AddMaintenanceFindingDto) {
    const scope = await this.workScope(user);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const finding = await createMaintenanceFinding(tx, {
        tenantId: user.tenantId,
        siteVisitId,
        assetId: dto.assetId,
        templateItemId: dto.templateItemId,
        optionValue: dto.optionValue,
        customLabel: dto.customLabel,
        category: dto.category,
        note: dto.note,
        clientRef: dto.clientRef,
        actorUserId: user.id,
        now,
      });

      if (finding.created && scope.role !== 'MANAGER') {
        await this.assignOwnTeamIfUnassigned(tx, user, finding.defectId, now);
      }

      const visible = await tx.defect.findFirst({
        where: { AND: [scope.where, { id: finding.defectId }] },
        select: { id: true },
      });
      if (!visible) {
        throw new ForbiddenException(
          'This pole or work type is assigned to another company or team — ask your manager.',
        );
      }
      return finding;
    });
  }

  private async assignOwnTeamIfUnassigned(
    tx: Prisma.TransactionClient,
    user: RequestUser,
    defectId: string,
    now: Date,
  ) {
    const defect = await tx.defect.findUniqueOrThrow({
      where: { id: defectId },
      select: { assignedToTeamId: true, assignedTeamId: true, maintenanceOrganizationId: true, lifecycleStatus: true },
    });
    if (defect.assignedToTeamId || defect.assignedTeamId || defect.maintenanceOrganizationId !== user.organizationId) {
      return;
    }
    const membership = await tx.teamMember.findFirst({
      where: { userId: user.id, isActive: true, team: { organizationId: user.organizationId, isActive: true } },
      orderBy: { createdAt: 'asc' },
      select: { team: { select: { id: true, name: true } } },
    });
    if (!membership) {
      return;
    }
    await tx.defect.update({
      where: { id: defectId },
      data: {
        assignedToTeamId: membership.team.id,
        assignedTeamId: membership.team.id,
        assignedAt: now,
        ...(defect.lifecycleStatus === DefectLifecycleStatus.VERIFIED
          ? { lifecycleStatus: DefectLifecycleStatus.ASSIGNED }
          : {}),
      },
    });
    await tx.defectTimelineEntry.create({
      data: {
        defectId,
        type: DefectTimelineEventType.DEFECT_ASSIGNED,
        fromLifecycleStatus: defect.lifecycleStatus,
        toLifecycleStatus:
          defect.lifecycleStatus === DefectLifecycleStatus.VERIFIED
            ? DefectLifecycleStatus.ASSIGNED
            : defect.lifecycleStatus,
        comment: `New finding: assigned to ${membership.team.name} (the crew that found it).`,
        createdByUserId: user.id,
        createdAt: now,
      },
    });
  }

  // ── Plan §20: crew / office corrections (until TNB verifies) ──────────────

  /** The routed work this user may correct — ADMIN: any in the tenant. */
  private async correctionScope(user: RequestUser): Promise<Prisma.DefectWhereInput> {
    return user.role === UserRole.ADMIN
      ? { inspectionItemResult: { inspection: { tenantId: user.tenantId } } }
      : (await this.workScope(user)).where;
  }

  /**
   * A Kejanggalan this user may still correct: in {@link correctionScope} (crew
   * = own teams, Manager = company + subcontractors) and NOT yet verified by
   * TNB (CLOSED).
   */
  private async editableDefect(user: RequestUser, defectId: string) {
    const defect = await this.prisma.defect.findFirst({
      where: { AND: [await this.correctionScope(user), { id: defectId }] },
      select: { id: true, lifecycleStatus: true, status: true, maintenanceCategory: true },
    });
    if (!defect) {
      throw new NotFoundException('Kejanggalan not found in your maintenance work.');
    }
    if (
      defect.lifecycleStatus === DefectLifecycleStatus.CLOSED ||
      defect.status === DefectStatus.CLOSED
    ) {
      throw new BadRequestException('TNB has already verified this repair — it can no longer be changed.');
    }
    return defect;
  }

  private async editableEvidenceImage(user: RequestUser, imageId: string) {
    const image = await this.prisma.defectEvidenceImage.findUnique({ where: { id: imageId } });
    if (!image || !isRepairStageEvidenceType(image.evidenceType)) {
      throw new NotFoundException('Repair photo not found.');
    }
    await this.editableDefect(user, image.defectId);
    return image;
  }

  /**
   * Delete a repair photo (P1). The row MOVES to DefectEvidenceImageArchive:
   * every read path keeps reading DefectEvidenceImage, so a deleted photo can
   * never resurface anywhere; the file stays on disk for an audit.
   */
  async deleteEvidenceImage(user: RequestUser, imageId: string) {
    const image = await this.editableEvidenceImage(user, imageId);
    const now = new Date();
    const takenAt = (image.timestamp ?? image.createdAt).toISOString().slice(0, 16).replace('T', ' ');
    await this.prisma.$transaction(async (tx) => {
      await tx.defectEvidenceImageArchive.create({
        data: {
          id: image.id,
          defectId: image.defectId,
          createdByUserId: image.createdByUserId,
          evidenceType: image.evidenceType,
          fileName: image.fileName,
          storageKey: image.storageKey,
          contentType: image.contentType,
          sizeBytes: image.sizeBytes,
          url: image.url,
          note: image.note,
          latitude: image.latitude,
          longitude: image.longitude,
          timestamp: image.timestamp,
          createdAt: image.createdAt,
          deletedAt: now,
          deletedByUserId: user.id,
        },
      });
      await tx.defectEvidenceImage.delete({ where: { id: image.id } });
      await tx.defect.update({ where: { id: image.defectId }, data: { evidenceChangedAt: now } });
      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: image.defectId,
          type: DefectTimelineEventType.COMMENT,
          comment: `${evidenceTypeLabel(image.evidenceType)} deleted (taken ${takenAt} UTC).`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });
    return { id: image.id, deleted: true };
  }

  /** Move a repair photo to another stage — fixes a wrong Before / After (P1). */
  async relabelEvidenceImage(user: RequestUser, imageId: string, evidenceType: string) {
    const target = evidenceType.trim().toUpperCase();
    if (!isRepairStageEvidenceType(target)) {
      throw new BadRequestException('A repair photo can only be BEFORE, DURING or AFTER.');
    }
    const image = await this.editableEvidenceImage(user, imageId);
    if (image.evidenceType === target) {
      return { id: image.id, evidenceType: target };
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.defectEvidenceImage.update({ where: { id: image.id }, data: { evidenceType: target } });
      await tx.defect.update({ where: { id: image.defectId }, data: { evidenceChangedAt: now } });
      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: image.defectId,
          type: DefectTimelineEventType.COMMENT,
          comment: `Photo moved: ${evidenceTypeLabel(image.evidenceType)} → ${evidenceTypeLabel(target)}.`,
          createdByUserId: user.id,
          createdAt: now,
        },
      });
    });
    return { id: image.id, evidenceType: target };
  }

  /** The active kinds of repair (P2), optionally for one work type. */
  listRepairMethods(category?: MaintenanceCategory) {
    return listActiveRepairMethods(this.prisma, category);
  }

  /** Set / correct the kind of repair after "Mark done" (P2) — crew or office. */
  async setRepairMethod(
    user: RequestUser,
    defectId: string,
    repairMethodId: string | null,
    note: string | null | undefined,
  ) {
    const defect = await this.editableDefect(user, defectId);
    const resolved = await resolveRepairMethod(this.prisma, defect.maintenanceCategory, repairMethodId, note);
    await this.prisma.$transaction(async (tx) => {
      await tx.defect.update({
        where: { id: defect.id },
        data: { repairMethodId: resolved.repairMethodId, repairMethodNote: resolved.repairMethodNote },
      });
      await tx.defectTimelineEntry.create({
        data: {
          id: randomUUID(),
          defectId: defect.id,
          type: DefectTimelineEventType.COMMENT,
          comment: resolved.label
            ? `Repair type: ${resolved.label}${resolved.repairMethodNote ? ` — ${resolved.repairMethodNote}` : ''}.`
            : 'Repair type cleared.',
          createdByUserId: user.id,
        },
      });
    });
    return {
      id: defect.id,
      repairMethod: resolved.repairMethodId
        ? { id: resolved.repairMethodId, label: resolved.label, note: resolved.repairMethodNote }
        : null,
    };
  }

  /**
   * Correct a pole's No Tiang Lama on site (P3) — e.g. repainted before the
   * crew came. Allowed while the user has unverified work on the pole; every
   * change is logged (old → new, who, when) in AssetChangeLog.
   */
  async setNoTiangLama(user: RequestUser, assetId: string, value: string | null | undefined) {
    const work = await this.prisma.defect.findFirst({
      where: {
        AND: [
          await this.correctionScope(user),
          { inspectionItemResult: { inspection: { assetId } } },
          { NOT: { lifecycleStatus: DefectLifecycleStatus.CLOSED } },
          { NOT: { status: DefectStatus.CLOSED } },
        ],
      },
      select: { id: true },
    });
    if (!work) {
      throw new NotFoundException('No unverified maintenance work of yours on this pole.');
    }
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, tenantId: true, noTiangLama: true, name: true },
    });
    if (!asset) {
      throw new NotFoundException('Pole not found.');
    }
    const current = effectiveLama(asset);
    const next = value?.replace(/\s+/g, ' ').trim() || null;
    if (next && next.length > 60) {
      throw new BadRequestException('No Tiang Lama is too long (60 characters at most).');
    }
    if (next === current) {
      return { assetId, noTiangLama: next, previous: current, changed: false };
    }
    await this.prisma.$transaction([
      // Both fields: reports read noTiangLama first, the app's screens read name.
      this.prisma.asset.update({ where: { id: assetId }, data: { noTiangLama: next, name: next } }),
      this.prisma.assetChangeLog.create({
        data: {
          tenantId: asset.tenantId,
          assetId,
          field: 'noTiangLama',
          oldValue: current,
          newValue: next,
          source: 'MAINTENANCE',
          changedByUserId: user.id,
        },
      }),
    ]);
    return { assetId, noTiangLama: next, previous: current, changed: true };
  }
}

/** Active kinds of repair (plan §20, P2) — shipped with the crew's pack. */
export function listActiveRepairMethods(
  prisma: PrismaService | Prisma.TransactionClient,
  category?: MaintenanceCategory,
) {
  return prisma.repairMethod.findMany({
    where: { isActive: true, ...(category ? { category } : {}) },
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    select: { id: true, category: true, code: true, label: true, requiresNote: true },
  });
}

/**
 * Validate a kind of repair for a Kejanggalan's work type (plan §20, P2); null
 * clears it. A method that requires a note ("Lain-lain") must come with one.
 * Shared by the crew's "Mark done" and the later correction.
 */
export async function resolveRepairMethod(
  prisma: PrismaService | Prisma.TransactionClient,
  category: MaintenanceCategory | null,
  repairMethodId: string | null | undefined,
  note: string | null | undefined,
): Promise<{ repairMethodId: string | null; repairMethodNote: string | null; label: string | null }> {
  if (!repairMethodId) {
    return { repairMethodId: null, repairMethodNote: null, label: null };
  }
  const method = await prisma.repairMethod.findUnique({ where: { id: repairMethodId } });
  if (!method || !method.isActive) {
    throw new BadRequestException('That repair type is not available.');
  }
  if (method.category !== (category ?? MaintenanceCategory.SELENGGARAAN)) {
    throw new BadRequestException('That repair type does not belong to this work type.');
  }
  const cleanNote = note?.replace(/\s+/g, ' ').trim() || null;
  if (method.requiresNote && !cleanNote) {
    throw new BadRequestException(`"${method.label}" needs a short description of the work done.`);
  }
  if (cleanNote && cleanNote.length > 300) {
    throw new BadRequestException('The description is too long (300 characters at most).');
  }
  return { repairMethodId: method.id, repairMethodNote: cleanNote, label: method.label };
}

/**
 * A pole's NO TIANG LAMA as the reports read it: the dedicated column (filled
 * by imports and by a maintenance correction), else the pole's name — which is
 * where the mobile Add-Pole screen stores it.
 */
export function effectiveLama(asset: { noTiangLama: string | null; name: string | null }): string | null {
  return asset.noTiangLama?.trim() || asset.name?.trim() || null;
}
