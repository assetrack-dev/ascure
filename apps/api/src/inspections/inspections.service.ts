import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { extname, resolve } from 'path';
import {
  DefectSeverity,
  SurveyLifecycleStatus,
  InspectionCompletionStatus,
  InspectionItemInputType,
  InspectionItemResultValue,
  MaintenanceCategory,
  Prisma,
  SiteVisitStatus,
  UserRole,
} from '@prisma/client';
import { normalizeReadingSentinel } from '@ascure/shared-utils';
import {
  DEFAULT_OPERATION_MODE,
  DEFAULT_OPERATIONAL_SCOPE,
  inferOperationalScopeFromAssetTypeCode,
  scopeRequiresQAQC,
} from '../common/operational-scope';
import { buildInitialDefectData } from '../defects/defect-materialization.util';
import { releaseVisitDefects } from '../defects/defect-release.util';
import {
  MAINTENANCE_LOCKED_DEFECT_STATUSES,
  releaseDefectsOnReport,
} from '../common/authorization/defect-governance';
import {
  siteVisitAccessWhere,
  siteVisitOversightWhere,
} from '../common/authorization/site-visit-scope';
import {
  buildScopeContext,
  ScopeContext,
} from '../common/authorization/scope-context';
import {
  buildInspectionImagePath,
  buildInspectionImageUrl,
  buildInspectionImagesDirectory,
} from '../common/uploads.constants';
import { RequestUser } from '../common/interfaces/request-user.interface';
import { normalizeOperationalText } from '../common/operational-text';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import {
  checklistResultValue,
  KELEGAAN_LABEL_ALIASES,
} from '../common/checklist-columns';
import { TemplatesService } from '../templates/templates.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CorrectReadingDto } from './dto/correct-reading.dto';
import { EditChecklistResultDto } from './dto/edit-checklist-result.dto';
import { RequestReinspectionDto } from './dto/request-reinspection.dto';
import {
  deriveEditedChecklistVerdict,
  type EditedChecklistValue,
} from './checklist-verdict.util';
import { isQaActor } from '../common/authorization/qa-actor';
import {
  SaveInspectionItemResultDto,
  SaveInspectionResultItemDto,
  SaveInspectionResultsDto,
} from './dto/save-inspection-results.dto';
import { UploadInspectionImageDto } from './dto/upload-inspection-image.dto';

type UploadedInspectionImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const ACTIVE_SITE_VISIT_STATUSES = [
  SiteVisitStatus.ACTIVE,
  SiteVisitStatus.OPEN,
  SiteVisitStatus.IN_PROGRESS,
] as const;

const OPERATIONAL_TEXT_KEYWORDS = [
  'nama pencawang',
  'functional location',
  'kod pencawang',
  'mainhead',
  'no tiang rondaan',
  'no tiang lama',
  'asset code',
  'asset name',
  'remark',
  'remarks',
  'catatan',
  'note',
  'notes',
];

@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templatesService: TemplatesService,
  ) {}

  async create(user: RequestUser, dto: CreateInspectionDto) {
    this.assertCanMutate(user);

    const siteVisit = await this.prisma.siteVisit.findFirst({
      where: {
        id: dto.siteVisitId,
        tenantId: user.tenantId,
        status: {
          in: [...ACTIVE_SITE_VISIT_STATUSES],
        },
        ...(await this.siteVisitMutationScope(user)),
      },
      include: {
        team: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!siteVisit) {
      throw new NotFoundException('Active site visit not found.');
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: dto.assetId,
        tenantId: user.tenantId,
      },
      include: {
        assetType: {
          select: {
            id: true,
            code: true,
            name: true,
            capabilityId: true,
            operationalScope: true,
          },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    if (asset.substationId !== siteVisit.substationId) {
      throw new BadRequestException('Asset does not belong to the substation for the selected site visit.');
    }

    // Idempotent per (asset, site visit): inspecting a pole that already has an
    // inspection this visit returns the existing one instead of minting a
    // duplicate cycle (re-taps of "Inspection" / "Save & inspect"). A genuine
    // new cycle is always a new site visit, so this never blocks re-inspection.
    const existingInspection = await this.prisma.inspection.findFirst({
      where: {
        tenantId: user.tenantId,
        siteVisitId: siteVisit.id,
        assetId: asset.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: this.inspectionInclude(),
    });

    if (existingInspection) {
      return existingInspection;
    }

    const operationalSession = dto.operationalSessionId
      ? await this.resolveOperationalSessionContext(user, dto.operationalSessionId, asset.id)
      : null;

    const templateResolution = await this.templatesService.resolveActiveTemplate(user, {
      assetTypeId: asset.assetTypeId,
      capabilityId: asset.assetType.capabilityId,
      siteVisitId: siteVisit.id,
      operationalSessionId: operationalSession?.id,
      organizationId: siteVisit.organizationId ?? operationalSession?.organizationId ?? null,
      branchId: siteVisit.branchId ?? operationalSession?.branchId ?? null,
      mainheadId: siteVisit.mainheadId ?? operationalSession?.mainheadId ?? null,
    });
    const template = templateResolution.template;
    const operationalScope =
      dto.operationalScope ??
      siteVisit.operationalScope ??
      asset.assetType.operationalScope ??
      inferOperationalScopeFromAssetTypeCode(asset.assetType.code) ??
      DEFAULT_OPERATIONAL_SCOPE;
    const operationMode =
      dto.operationMode ??
      siteVisit.operationMode ??
      DEFAULT_OPERATION_MODE;
    const requiresQAQC =
      dto.requiresQAQC ??
      siteVisit.requiresQAQC ??
      scopeRequiresQAQC(operationalScope);
    const reportingGroup =
      this.normalizeOperationalString(dto.reportingGroup) ??
      siteVisit.reportingGroup;

    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.inspection.create({
        data: {
          tenantId: user.tenantId,
          siteVisitId: siteVisit.id,
          assetId: asset.id,
          templateId: template.id,
          operationalSessionId: operationalSession?.id ?? null,
          createdByUserId: user.id,
          inspectionCycle: dto.inspectionCycle ?? 1,
          operationMode,
          operationalScope,
          requiresQAQC,
          reportingGroup,
        },
        include: this.inspectionInclude(),
      });

      await tx.siteVisitAsset.upsert({
        where: {
          siteVisitId_assetId: {
            siteVisitId: siteVisit.id,
            assetId: asset.id,
          },
        },
        create: {
          siteVisitId: siteVisit.id,
          assetId: asset.id,
          addedByUserId: user.id,
          source: 'INSPECTION',
        },
        update: {},
      });

      return inspection;
    });
  }

  async getForm(user: RequestUser, inspectionId: string) {
    const inspection = await this.getAccessibleInspection(inspectionId, user);
    const reboundInspection = await this.rebindUntouchedDraftTemplate(user, inspection);

    return this.serializeInspectionForm(reboundInspection ?? inspection);
  }

  /** Serialize an inspection's form WITHOUT the untouched-draft re-bind — used to
   *  return the just-persisted state after a save/amend. Re-binding to a newer
   *  template version is a form-open concern only, so it must not fire as a
   *  side effect of saving. */
  private async reloadForm(user: RequestUser, inspectionId: string) {
    const inspection = await this.getAccessibleInspection(inspectionId, user);

    return this.serializeInspectionForm(inspection);
  }

  /**
   * Untouched-draft template re-bind. A DRAFT inspection that has no answers and
   * no photos yet is NOT locked to its checklist version: when the form is
   * opened, re-resolve the currently active template for its asset/visit and
   * switch to it if a newer version has since been activated. Once the crew
   * enters anything (an answer or a photo) the version is locked — re-pointing
   * then would orphan their data, since a new template version is a fresh
   * template row with brand-new item IDs. Best-effort: skips read-only viewers,
   * closed visits, and any resolution failure (keeps the current binding), and
   * writes only when the active version actually differs.
   */
  private async rebindUntouchedDraftTemplate(
    user: RequestUser,
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
  ) {
    if (user.role === UserRole.VIEWER) {
      return null;
    }

    if (inspection.completionStatus !== InspectionCompletionStatus.DRAFT) {
      return null;
    }

    const isUntouched =
      inspection.itemResults.length === 0 &&
      inspection.results.length === 0 &&
      inspection.inspectionImages.length === 0;

    if (!isUntouched) {
      return null;
    }

    const visitActive = (
      ACTIVE_SITE_VISIT_STATUSES as readonly SiteVisitStatus[]
    ).includes(inspection.siteVisit.status);

    if (!visitActive) {
      return null;
    }

    let activeTemplateId: string;
    try {
      const resolution = await this.templatesService.resolveActiveTemplate(user, {
        assetId: inspection.assetId,
        siteVisitId: inspection.siteVisitId,
        operationalSessionId: inspection.operationalSessionId ?? undefined,
      });
      activeTemplateId = resolution.template.id;
    } catch {
      // No active template (or resolution failed) — keep the existing binding.
      return null;
    }

    if (activeTemplateId === inspection.templateId) {
      return null;
    }

    await this.prisma.inspection.update({
      where: { id: inspection.id },
      data: { templateId: activeTemplateId },
    });

    return this.getAccessibleInspection(inspection.id, user);
  }

  async getDetail(user: RequestUser, inspectionId: string) {
    const ctx = await buildScopeContext(this.prisma, user);
    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionOversightScope(user, ctx),
      },
      include: {
        inspectionImages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            inspectionId: true,
            url: true,
            filename: true,
            latitude: true,
            longitude: true,
            timestamp: true,
            createdAt: true,
          },
        },
        results: {
          select: {
            templateItemId: true,
            valueText: true,
            // The typed columns too, so an edit's audit line reports the real
            // previous value instead of a blank for anything non-text (a
            // MULTI_SELECT keeps its picks in valueJson).
            valueNumber: true,
            valueBoolean: true,
            valueDate: true,
            valueDateTime: true,
            valueJson: true,
            templateItem: {
              select: {
                key: true,
                label: true,
              },
            },
          },
        },
        itemResults: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    return {
      id: inspection.id,
      assetId: inspection.assetId,
      operationalSessionId: inspection.operationalSessionId,
      cycleNumber: inspection.inspectionCycle,
      status: inspection.completionStatus,
      operationMode: inspection.operationMode,
      operationalScope: inspection.operationalScope,
      requiresQAQC: inspection.requiresQAQC,
      reportingGroup: inspection.reportingGroup,
      submittedAt: inspection.submittedAt?.toISOString() ?? null,
      createdAt: inspection.createdAt.toISOString(),
      updatedAt: inspection.updatedAt.toISOString(),
      remarks: this.extractRemarks(inspection.results) || null,
      items: inspection.itemResults.map((item) => this.serializeInspectionItemResult(item)),
      totalDefects: inspection.itemResults.filter((item) => item.isDefect).length,
      images: inspection.inspectionImages.map((image) => this.serializeInspectionImage(image)),
    };
  }

  async saveResults(user: RequestUser, inspectionId: string, dto: SaveInspectionResultsDto) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Submitted inspections cannot be modified.');
    }

    await this.assertInspectionDefectEvidenceEditable(inspection.id);

    const hasStructuredItems = dto.items !== undefined;
    const hasLegacyResults = dto.results !== undefined;

    if (!hasStructuredItems && !hasLegacyResults) {
      throw new BadRequestException('Inspection results payload must include items or results.');
    }

    if (hasStructuredItems) {
      // The chosen option value(s) per item arrive in the parallel `results`
      // payload — pass them so a defect option's own severity (e.g. KUANTAN's
      // A/B/C) can override the item-level severity on the raised defect.
      await this.saveStructuredItemResults(
        inspection,
        dto.items ?? [],
        this.buildChosenValuesByTemplateItem(dto.results ?? []),
      );
    }

    if (hasLegacyResults) {
      await this.saveLegacyTemplateResults(inspection, dto.results ?? []);
    }

    return this.reloadForm(user, inspectionId);
  }

  private async assertInspectionDefectEvidenceEditable(inspectionId: string) {
    // Only a defect that maintenance has actually taken over locks the
    // inspection's evidence. A VERIFIED-but-unclaimed defect (the default under
    // INSPECTOR_OWNS) is still inspector-owned and editable. This uses the SAME
    // status set as amendInspection's re-open gate, so "could re-open" always
    // implies "can save" — see MAINTENANCE_LOCKED_DEFECT_STATUSES.
    const maintainedDefect = await this.prisma.defect.findFirst({
      where: {
        lifecycleStatus: {
          in: MAINTENANCE_LOCKED_DEFECT_STATUSES,
        },
        inspectionItemResult: {
          inspectionId,
        },
      },
      select: {
        id: true,
      },
    });

    if (maintainedDefect) {
      throw new BadRequestException(
        'A defect on this inspection is already in maintenance, so its evidence cannot be overwritten. Resolve the defect first.',
      );
    }
  }

  /**
   * Block all inspection edits once the owning site visit (Pencawang) is no
   * longer active — i.e. it has been Completed or Cancelled. Inspections, and
   * the defects their checklist answers produce, are editable only while the
   * visit is open. siteVisit.status is loaded by inspectionInclude().
   */
  private assertVisitEditable(siteVisitStatus: SiteVisitStatus) {
    const isActive = (
      ACTIVE_SITE_VISIT_STATUSES as readonly SiteVisitStatus[]
    ).includes(siteVisitStatus);

    if (!isActive) {
      throw new BadRequestException(
        'This site visit has been completed. The inspection can no longer be edited.',
      );
    }
  }

  /**
   * Re-open a SUBMITTED inspection for correction (amend tweak): revert it to
   * DRAFT so the field user can fix wrongly-entered data and re-submit. Blocked
   * if any of its defects has already entered maintenance (assigned / in
   * progress / completed / etc.) — those must be resolved first. The
   * pre-maintenance auto-created defects are removed so a clean re-submit
   * regenerates them from the amended results.
   */
  async amendInspection(user: RequestUser, inspectionId: string) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus !== InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Only a submitted inspection can be amended.');
    }

    const itemResults = await this.prisma.inspectionItemResult.findMany({
      where: { inspectionId: inspection.id },
      select: { id: true },
    });
    const itemResultIds = itemResults.map((result) => result.id);

    if (itemResultIds.length > 0) {
      const maintainedDefect = await this.prisma.defect.findFirst({
        where: {
          inspectionItemResultId: { in: itemResultIds },
          lifecycleStatus: {
            in: MAINTENANCE_LOCKED_DEFECT_STATUSES,
          },
        },
        select: { id: true },
      });

      if (maintainedDefect) {
        throw new BadRequestException(
          'This inspection has a defect already in maintenance and cannot be amended. Resolve the defect first.',
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.defect.deleteMany({
        where: { inspectionItemResultId: { in: itemResultIds } },
      }),
      this.prisma.inspection.update({
        where: { id: inspection.id },
        data: {
          completionStatus: InspectionCompletionStatus.DRAFT,
          submittedAt: null,
        },
      }),
    ]);

    return this.reloadForm(user, inspectionId);
  }

  /**
   * Manager/DC "send this pole back for re-inspection".
   *
   * The crew captured something the office can see is wrong but cannot correct
   * from a desk — a Smart-Sensor clearance the photo contradicts is the case
   * this exists for. Nobody in the office knows the true measurement, so the
   * pole has to be walked again.
   *
   * WHAT IT DOES: returns the inspection to DRAFT and records why. That single
   * flip does three useful things at once — the pole turns RED again on the
   * crew's map (mobile colours by `latestInspection.status`/`submittedAt`, so no
   * app change is needed), the form becomes editable so they can re-capture, and
   * the pole drops out of every "inspected" count including TNB's coverage.
   *
   * WHAT IT KEEPS: every recorded answer, photo and defect. The crew opens the
   * pole and corrects the bad value rather than starting from a blank form, and
   * findings are not lost if they never return. Stale defects are reconciled on
   * re-submit, not here.
   *
   * ⚠ Unlike {@link amendInspection} this deliberately works AFTER the visit is
   * completed — that is the moment a manager reviews, so refusing then would
   * make the feature useless. When the survey has already left the field it is
   * also returned to PERLU_PINDAAN, otherwise the crew would have no open visit
   * to reach the red pole through.
   */
  async requestReinspection(
    user: RequestUser,
    inspectionId: string,
    dto: RequestReinspectionDto,
  ) {
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.MANAGER &&
      !(await isQaActor(this.prisma, user))
    ) {
      throw new ForbiddenException(
        'Only an admin, manager, or QA actor can send a pole back for re-inspection.',
      );
    }

    const ctx = await buildScopeContext(this.prisma, user);
    const inspection = await this.getAccessibleInspection(inspectionId, user, ctx, {
      oversight: true,
    });

    if (inspection.siteVisit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This visit is cancelled — its poles cannot be sent back.',
      );
    }

    if (inspection.completionStatus !== InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException(
        'This pole has not been submitted, so there is nothing to send back.',
      );
    }

    // A defect already picked up by a maintenance crew must not be pulled out
    // from under them — same guard the amend path uses.
    const itemResultIds = inspection.itemResults.map((item) => item.id);
    if (itemResultIds.length > 0) {
      const maintainedDefect = await this.prisma.defect.findFirst({
        where: {
          inspectionItemResultId: { in: itemResultIds },
          lifecycleStatus: { in: MAINTENANCE_LOCKED_DEFECT_STATUSES },
        },
        select: { id: true },
      });
      if (maintainedDefect) {
        throw new BadRequestException(
          'A defect from this pole is already in maintenance. Resolve it before sending the pole back.',
        );
      }
    }

    const reason = dto.reason.trim();
    // A survey that has left the field has no open visit for the crew to work
    // in, so reopen it. One still being walked is already reachable.
    const reopenVisit =
      inspection.siteVisit.lifecycleStatus != null &&
      inspection.siteVisit.lifecycleStatus !== SurveyLifecycleStatus.DALAM_RONDAAN;

    await this.prisma.$transaction(async (tx) => {
      await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          completionStatus: InspectionCompletionStatus.DRAFT,
          submittedAt: null,
          reinspectionReason: reason,
          reinspectionRequestedAt: new Date(),
          reinspectionRequestedById: user.id,
        },
      });

      if (reopenVisit) {
        await tx.siteVisit.update({
          where: { id: inspection.siteVisitId },
          data: {
            lifecycleStatus: SurveyLifecycleStatus.PERLU_PINDAAN,
            // ⚠ The lifecycle alone is NOT enough. The crew presses "Complete
            // Visit" before review, which sets status=COMPLETED — and
            // assertVisitEditable then blocks every save/submit path, so the
            // pole would go red with no way to redo it. Restore an active
            // status and clear the completion stamps, exactly as the DC's
            // requestAmendment does (survey-lifecycle.service).
            status: SiteVisitStatus.IN_PROGRESS,
            completedAt: null,
            endedAt: null,
            amendmentRequestedAt: new Date(),
            amendmentRemark: `Pole ${inspection.asset?.assetCode ?? ''} sent back: ${reason}`.trim(),
          },
        });
      }
    });

    this.logger.warn(
      `Pole ${inspection.asset?.assetCode ?? inspection.assetId} sent back for re-inspection on visit ${inspection.siteVisitId} by ${user.email} (${user.role}): "${reason}"${reopenVisit ? ' — survey returned to PERLU_PINDAAN' : ''}`,
    );

    return { ok: true, reopenedSurvey: reopenVisit };
  }

  /**
   * In-place governance correction of the recorded BACAAN KELEGAAN 1 reading (the
   * Smart-Sensor value the DC re-verifies against the photo). Unlike saveResults,
   * this deliberately BYPASSES the submitted-inspection lock — it is a targeted
   * data-quality fix, so it is restricted to ADMIN / MANAGER / QA actor (never a
   * technician) and scoped to inspections the caller can reach; old→new is logged.
   * Numeric text → valueNumber, non-numeric (e.g. the "LO" sentinel) → valueText,
   * empty → clears the recorded value.
   */
  async correctKelegaanReading(
    user: RequestUser,
    inspectionId: string,
    dto: CorrectReadingDto,
  ) {
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.MANAGER &&
      !(await isQaActor(this.prisma, user))
    ) {
      throw new ForbiddenException(
        'Only an admin, manager, or QA actor can correct a recorded reading.',
      );
    }

    // Scope with the FULL ScopeContext so a QA/DC actor — who governs by mainhead,
    // not team membership — can actually reach the inspection (mirrors the defects
    // path). Without ctx the QA branch is skipped and every DC edit 404s.
    // { oversight: true } widens a main-contractor MANAGER to its subcontractor
    // subtree, matching the generalized checklist edit (owner-approved 2026-07-21).
    const ctx = await buildScopeContext(this.prisma, user);
    const inspection = await this.getAccessibleInspection(inspectionId, user, ctx, {
      oversight: true,
    });

    // A cancelled visit is closed data — never mutate its readings.
    if (inspection.siteVisit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This visit is cancelled — its readings cannot be corrected.',
      );
    }

    // Reject a correction whose inspection belongs to a DIFFERENT survey cycle than
    // the visit on screen: for a re-surveyed pole the displayed reading is the
    // pole's globally-latest submitted inspection, which may be a newer cycle.
    if (dto.siteVisitId && inspection.siteVisitId !== dto.siteVisitId) {
      throw new BadRequestException(
        'This reading was recorded in a different survey cycle — open that visit to correct it.',
      );
    }

    // Resolve the KELEGAAN item in ALIAS-PRIORITY order (matching the column
    // serializer), not template sort order, so on a split template the edit hits
    // the same item the column displays.
    const norm = (value: string) => value.toUpperCase().replace(/\s+/g, ' ').trim();
    const items = inspection.template.sections.flatMap((section) => section.items);
    let matched: (typeof items)[number] | undefined;
    for (const alias of KELEGAAN_LABEL_ALIASES.map(norm)) {
      matched = items.find((templateItem) => norm(templateItem.label) === alias);
      if (matched) {
        break;
      }
    }

    if (!matched) {
      throw new BadRequestException(
        'This inspection has no Bacaan Kelegaan item to correct.',
      );
    }
    const item = matched;

    const existing = inspection.results.find(
      (result) => result.templateItemId === item.id,
    );
    const oldValue =
      existing?.valueText?.trim() ||
      (existing?.valueNumber != null ? existing.valueNumber.toString() : null);

    const raw = dto.value?.trim() ?? '';
    const numeric = raw === '' ? Number.NaN : Number(raw);
    const isNumeric = raw !== '' && Number.isFinite(numeric);
    // valueNumber is Decimal(18,4) — reject a finite value too large for the
    // column instead of letting Postgres raise a 500 (numeric field overflow).
    if (isNumeric && Math.abs(numeric) >= 1e14) {
      throw new BadRequestException('Reading is out of range.');
    }
    const data = {
      valueText: raw === '' ? null : isNumeric ? null : raw.toUpperCase(),
      valueNumber: isNumeric ? numeric : null,
      valueBoolean: null,
      valueDate: null,
      valueDateTime: null,
      valueJson: Prisma.DbNull,
    };

    await this.prisma.inspectionResult.upsert({
      where: {
        inspectionId_templateItemId: {
          inspectionId: inspection.id,
          templateItemId: item.id,
        },
      },
      create: { inspectionId: inspection.id, templateItemId: item.id, ...data },
      update: data,
    });

    const newValue =
      data.valueText ??
      (data.valueNumber != null ? data.valueNumber.toString() : null);

    this.logger.warn(
      `BACAAN KELEGAAN 1 corrected on inspection ${inspection.id} by ${user.email} (${user.role}): "${oldValue ?? ''}" -> "${newValue ?? ''}"`,
    );

    return { ok: true, value: newValue };
  }

  /**
   * In-place edit of ANY recorded checklist value on a submitted inspection —
   * the generalization of correctKelegaanReading. Targets the checklist item
   * whose normalized label === dto.columnKey (the Linked-Assets column key),
   * coerces the free-text value to that item's typed InspectionResult column, and
   * upserts (create-or-update, so a not-yet-filled item is created). Same
   * governance model as the kelegaan correction: ADMIN / MANAGER / QA actor only,
   * oversight-scoped (own teams + subcontractor subtree), bypasses the submitted
   * lock, blocked only on a CANCELLED visit, old->new logged (owner chose
   * log-only, no DB audit, 2026-07-21).
   *
   * The edit then RE-RUNS THE VERDICT (2026-09-04): the new value is put through
   * the same PASS/FAIL derivation the mobile applies at capture
   * (checklist-verdict.util.ts), the matching InspectionItemResult is upserted,
   * and the Defect is materialized or withdrawn to match — so an office-edited
   * defect answer reaches the Laporan Kejanggalan, the defect lists, and mobile
   * exactly as if the crew had recorded it. Defects already claimed by
   * maintenance are never touched.
   */
  async editChecklistResult(
    user: RequestUser,
    inspectionId: string,
    dto: EditChecklistResultDto,
  ) {
    if (
      user.role !== UserRole.ADMIN &&
      user.role !== UserRole.MANAGER &&
      !(await isQaActor(this.prisma, user))
    ) {
      throw new ForbiddenException(
        'Only an admin, manager, or QA actor can edit a recorded checklist value.',
      );
    }

    const ctx = await buildScopeContext(this.prisma, user);
    const inspection = await this.getAccessibleInspection(inspectionId, user, ctx, {
      oversight: true,
    });

    if (inspection.siteVisit.status === SiteVisitStatus.CANCELLED) {
      throw new BadRequestException(
        'This visit is cancelled — its checklist values cannot be edited.',
      );
    }

    // Reject an edit whose inspection belongs to a DIFFERENT survey cycle than the
    // visit on screen (a re-surveyed pole's latest submitted inspection may be a
    // newer cycle) — mirrors correctKelegaanReading.
    if (dto.siteVisitId && inspection.siteVisitId !== dto.siteVisitId) {
      throw new BadRequestException(
        'This value was recorded in a different survey cycle — open that visit to edit it.',
      );
    }

    // Resolve the item by normalized label — the same key resolveChecklistColumns
    // builds the Linked-Assets columns from. IMAGE items have no text column and
    // are never editable this way.
    const norm = (value: string) => value.toUpperCase().replace(/\s+/g, ' ').trim();
    const columnKey = norm(dto.columnKey);
    // IMAGE carries a photo, not a value, so it is the only type excluded here.
    // MULTI_SELECT IS editable — its picks round-trip through valueJson (see the
    // MULTI_SELECT branch of coerceInspectionResultValue).
    const item = inspection.template.sections
      .flatMap((section) => section.items)
      .find(
        (templateItem) =>
          templateItem.inputType !== InspectionItemInputType.IMAGE &&
          norm(templateItem.label) === columnKey,
      );

    if (!item) {
      throw new BadRequestException(
        'This inspection has no editable checklist item matching that column.',
      );
    }

    const existing = inspection.results.find(
      (result) => result.templateItemId === item.id,
    );
    const oldValue = this.stringifyResultValue(existing ?? {});

    const data = this.coerceInspectionResultValue(
      item.inputType,
      dto.value ?? '',
      item.optionsJson,
    );

    // Re-run the verdict the mobile would have computed for this answer, so an
    // office edit COUNTS — it raises or clears the defect, not just the value.
    // (Before 2026-09, only the InspectionResult value was written; the frozen
    // InspectionItemResult/Defect never changed, so an edited defect answer was
    // invisible to the Laporan Kejanggalan, the defect lists, and mobile.)
    const editedValue: EditedChecklistValue = {
      ...data,
      // `data.valueJson` is Prisma's DbNull sentinel when cleared — the verdict
      // (and the log reader below) want a plain array-or-null.
      valueJson: Array.isArray(data.valueJson) ? (data.valueJson as string[]) : null,
    };
    const result = deriveEditedChecklistVerdict(item, editedValue);
    const isDefect =
      result === InspectionItemResultValue.FAIL && item.isDefectTrigger !== false;
    // Chosen option value(s) so a defect option's per-option severity applies
    // (same inputs buildChosenValuesByTemplateItem feeds the submit path).
    const chosenValues = [
      ...(editedValue.valueText ? [editedValue.valueText] : []),
      ...(editedValue.valueJson ?? []),
    ];
    const severity = isDefect
      ? this.resolveDefectSeverity(item, chosenValues)
      : null;

    // The item-result this verdict lands on: prefer the row already linked to
    // the template item, else match by label like the submit path does —
    // skipping standalone per-pole emergencies (label = free-text note).
    const labelKey = this.normalizeLabelKey(item.label);
    const existingItemResult =
      inspection.itemResults.find(
        (itemResult) => itemResult.checklistItemId === item.id,
      ) ??
      inspection.itemResults.find(
        (itemResult) =>
          !(itemResult.isEmergency && itemResult.checklistItemId === null) &&
          this.normalizeLabelKey(itemResult.label) === labelKey,
      );

    const itemResultData = {
      checklistItemId: item.id,
      result,
      isDefect,
      // An office edit never declares an emergency; clearing the defect clears
      // the flag with it (an emergency only carries meaning on a defect).
      isEmergency: isDefect ? (existingItemResult?.isEmergency ?? false) : false,
      severity,
      maintenanceCategory: item.maintenanceCategory ?? null,
    };
    // Emergency-flagged defects are CRITICAL regardless of template severity —
    // mirrors buildInitialDefectData so the synced Defect row can't disagree.
    const defectSeverity = itemResultData.isEmergency
      ? DefectSeverity.CRITICAL
      : (severity ?? DefectSeverity.MEDIUM);

    await this.prisma.$transaction(async (tx) => {
      await tx.inspectionResult.upsert({
        where: {
          inspectionId_templateItemId: {
            inspectionId: inspection.id,
            templateItemId: item.id,
          },
        },
        create: { inspectionId: inspection.id, templateItemId: item.id, ...data },
        update: data,
      });

      // A cleared/NA answer on a pole that never had this row needs no verdict
      // row at all — nothing was asserted and nothing needs withdrawing.
      if (!existingItemResult && result === InspectionItemResultValue.NA) {
        return;
      }

      const itemResultId = existingItemResult
        ? (
            await tx.inspectionItemResult.update({
              where: { id: existingItemResult.id },
              data: itemResultData,
              select: { id: true },
            })
          ).id
        : (
            await tx.inspectionItemResult.create({
              data: {
                inspectionId: inspection.id,
                label: item.label,
                ...itemResultData,
              },
              select: { id: true },
            })
          ).id;

      if (isDefect) {
        // Materialize the defect the way submit would; one already open keeps
        // its lifecycle but follows the edited severity/work-type — unless it
        // is maintenance-locked (someone is working it), which stays untouched.
        await tx.defect.upsert({
          where: { inspectionItemResultId: itemResultId },
          create: buildInitialDefectData(
            {
              id: itemResultId,
              severity,
              isEmergency: itemResultData.isEmergency,
              maintenanceCategory: itemResultData.maintenanceCategory,
            },
            new Date(),
          ),
          update: {},
        });
        await tx.defect.updateMany({
          where: {
            inspectionItemResultId: itemResultId,
            lifecycleStatus: { notIn: MAINTENANCE_LOCKED_DEFECT_STATUSES },
          },
          data: {
            severity: defectSeverity,
            maintenanceCategory:
              itemResultData.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN,
          },
        });
      } else {
        // The edit withdrew/changed the answer to a non-defect — the same rule
        // re-submission applies: drop the defect unless maintenance holds it.
        await tx.defect.deleteMany({
          where: {
            inspectionItemResultId: itemResultId,
            lifecycleStatus: { notIn: MAINTENANCE_LOCKED_DEFECT_STATUSES },
          },
        });
      }
    });

    const newValue = this.stringifyResultValue(editedValue);

    this.logger.warn(
      `Checklist item "${item.label}" edited on inspection ${inspection.id} by ${user.email} (${user.role}): "${oldValue ?? ''}" -> "${newValue ?? ''}" (verdict ${result}${isDefect ? `, defect ${severity ?? ''}`.trimEnd() : ''})`,
    );

    return { ok: true, value: newValue, result, isDefect, severity };
  }

  /**
   * Coerce a free-text edit into the correct typed InspectionResult column for a
   * checklist item's inputType. Empty clears every value column. NUMBER parses
   * strictly; READING/OCR (ground clearance) parse numerically but keep a
   * non-numeric sentinel like "LO" as text; BOOLEAN accepts yes/no/true/false/
   * 1/0; DATE/DATETIME parse a date; everything else (TEXT/SELECT/GPS/…) stores
   * text. Throws BadRequest on a malformed value.
   */
  private coerceInspectionResultValue(
    inputType: InspectionItemInputType,
    rawInput: string,
    optionsJson?: Prisma.JsonValue | null,
  ): {
    valueText: string | null;
    valueNumber: number | null;
    valueBoolean: boolean | null;
    valueDate: Date | null;
    valueDateTime: Date | null;
    valueJson: typeof Prisma.DbNull | Prisma.InputJsonArray;
  } {
    const raw = rawInput.trim();
    const cleared = {
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueDate: null as Date | null,
      valueDateTime: null as Date | null,
      valueJson: Prisma.DbNull,
    };
    if (raw === '') {
      return cleared;
    }

    // MULTI_SELECT keeps its picks as an ARRAY in valueJson — writing them to
    // valueText would leave the real answer untouched. The wire format is a
    // comma-separated list of OPTION VALUES; each is validated against the
    // template so a stale or mistyped pick is rejected rather than stored.
    if (inputType === InspectionItemInputType.MULTI_SELECT) {
      const allowed = normalizeTemplateSelectOptions(optionsJson ?? null);
      if (!allowed) {
        throw new BadRequestException(
          'This item has no configured options to choose from.',
        );
      }
      const allowedValues = new Set(allowed.map((option) => option.value));
      const picks = Array.from(
        new Set(
          raw
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      );
      const unknown = picks.find((pick) => !allowedValues.has(pick));
      if (unknown) {
        throw new BadRequestException(
          `"${unknown}" is not one of this item's options.`,
        );
      }
      return {
        ...cleared,
        valueJson: picks as Prisma.InputJsonArray,
      };
    }

    const asNumber = () => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException('This item expects a number.');
      }
      // valueNumber is Decimal(18,4) — reject an overflow rather than a Postgres 500.
      if (Math.abs(parsed) >= 1e14) {
        throw new BadRequestException('Value is out of range.');
      }
      return parsed;
    };

    switch (inputType) {
      case InspectionItemInputType.NUMBER:
        return { ...cleared, valueNumber: asNumber() };
      case InspectionItemInputType.READING:
      case InspectionItemInputType.OCR: {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          if (Math.abs(parsed) >= 1e14) {
            throw new BadRequestException('Value is out of range.');
          }
          return { ...cleared, valueNumber: parsed };
        }
        return { ...cleared, valueText: raw.toUpperCase() };
      }
      case InspectionItemInputType.BOOLEAN: {
        const lowered = raw.toLowerCase();
        if (['true', 'yes', 'ya', '1'].includes(lowered)) {
          return { ...cleared, valueBoolean: true };
        }
        if (['false', 'no', 'tidak', '0'].includes(lowered)) {
          return { ...cleared, valueBoolean: false };
        }
        throw new BadRequestException('This item expects Yes or No.');
      }
      case InspectionItemInputType.DATE: {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('This item expects a date.');
        }
        return { ...cleared, valueDate: parsed };
      }
      case InspectionItemInputType.DATETIME: {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('This item expects a date/time.');
        }
        return { ...cleared, valueDateTime: parsed };
      }
      default:
        // TEXT, SELECT, MULTI_SELECT, JSON, GPS, … → store as free text.
        return { ...cleared, valueText: raw };
    }
  }

  /** Render a stored/prepared InspectionResult value as one string for the edit
   *  log (first non-empty typed column wins; mirrors the serializer's valueOf). */
  /**
   * The human-readable form of a recorded value, for the edit audit line.
   * Delegates to the SHARED reader so it cannot drift — this used to omit
   * valueJson, which logged every MULTI_SELECT edit as an empty value.
   */
  private stringifyResultValue(v: {
    valueText?: string | null;
    valueNumber?: Prisma.Decimal | number | null;
    valueBoolean?: boolean | null;
    valueDate?: Date | null;
    valueDateTime?: Date | null;
    valueJson?: Prisma.JsonValue | null;
  }): string | null {
    return checklistResultValue({
      valueText: v.valueText ?? null,
      valueNumber: v.valueNumber ?? null,
      valueBoolean: v.valueBoolean ?? null,
      valueDate: v.valueDate ?? null,
      valueDateTime: v.valueDateTime ?? null,
      valueJson: v.valueJson ?? null,
    });
  }

  /** Map templateItemId → chosen option value(s) from the structured `results`
   *  payload (valueText for single-select, valueJson array for multi-select).
   *  Lets the save path resolve a defect option's per-option severity. */
  private buildChosenValuesByTemplateItem(
    results: SaveInspectionResultItemDto[],
  ): Map<string, string[]> {
    const chosen = new Map<string, string[]>();
    for (const result of results) {
      const values: string[] = [];
      if (typeof result.valueText === 'string' && result.valueText.trim()) {
        values.push(result.valueText.trim());
      }
      if (Array.isArray(result.valueJson)) {
        for (const entry of result.valueJson) {
          if (typeof entry === 'string' && entry.trim()) {
            values.push(entry.trim());
          }
        }
      }
      if (values.length > 0) {
        chosen.set(result.templateItemId, values);
      }
    }
    return chosen;
  }

  /** A raised defect's severity: a chosen defect option's own severity wins
   *  (highest if several were picked), else the item-level severity, else
   *  MEDIUM. YES/NO items (no per-option severity) are unchanged. */
  private resolveDefectSeverity(
    templateItem:
      | { optionsJson: Prisma.JsonValue | null; severity: DefectSeverity }
      | null
      | undefined,
    chosenValues: string[] | undefined,
  ): DefectSeverity {
    const fallback = templateItem?.severity ?? DefectSeverity.MEDIUM;
    if (!templateItem || !chosenValues || chosenValues.length === 0) {
      return fallback;
    }
    const options = normalizeTemplateSelectOptions(templateItem.optionsJson);
    if (!options) {
      return fallback;
    }
    const rank: Record<DefectSeverity, number> = {
      [DefectSeverity.LOW]: 0,
      [DefectSeverity.MEDIUM]: 1,
      [DefectSeverity.HIGH]: 2,
      [DefectSeverity.CRITICAL]: 3,
    };
    const chosen = new Set(chosenValues);
    let best: DefectSeverity | null = null;
    for (const option of options) {
      if (option.isDefect && option.severity && chosen.has(option.value)) {
        if (!best || rank[option.severity] > rank[best]) {
          best = option.severity;
        }
      }
    }
    return best ?? fallback;
  }

  private async saveStructuredItemResults(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
    items: SaveInspectionItemResultDto[],
    chosenValuesByTemplateItem: Map<string, string[]> = new Map(),
  ) {
    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    const templateItemIds = new Set(templateItems.map((item) => item.id));
    const templateItemById = new Map(templateItems.map((item) => [item.id, item]));
    const checklistItemIdByLabel = this.buildChecklistItemIdByLabel(templateItems);

    const data = items.map((item) => {
      const label = item.label.trim();

      if (!label) {
        throw new BadRequestException('Checklist item label is required.');
      }

      if (item.checklistItemId && !templateItemIds.has(item.checklistItemId)) {
        throw new BadRequestException(
          `Checklist item ${item.checklistItemId} does not belong to this inspection template.`,
        );
      }

      const checklistItemId =
        item.checklistItemId ?? checklistItemIdByLabel.get(this.normalizeLabelKey(label)) ?? null;
      const templateItem = checklistItemId ? templateItemById.get(checklistItemId) : null;
      const remark = this.normalizeOperationalString(item.remark);
      const isDefect = item.result === 'FAIL' && templateItem?.isDefectTrigger !== false;
      // Emergency only carries meaning on an actual defect — an inspector
      // flagging a dangerous-to-public condition on a failed item.
      const isEmergency = isDefect && item.isEmergency === true;
      // Severity only on an actual defect (blank otherwise — KUANTAN "no defect"
      // is a blank pick). A chosen defect option may carry its own severity
      // (A/B/C); resolveDefectSeverity prefers it, else the item-level severity.
      const severity = isDefect
        ? this.resolveDefectSeverity(
            templateItem,
            checklistItemId ? chosenValuesByTemplateItem.get(checklistItemId) : undefined,
          )
        : null;
      // Work-type carried from the template item so the materialized defect can
      // be packaged/filtered by the maintenance company (null = SELENGGARAAN).
      const maintenanceCategory = templateItem?.maintenanceCategory ?? null;

      return {
        inspectionId: inspection.id,
        checklistItemId,
        label,
        result: item.result,
        remark,
        isDefect,
        isEmergency,
        severity,
        maintenanceCategory,
      };
    });

    await this.prisma.$transaction([
      this.prisma.inspectionItemResult.deleteMany({
        where: {
          inspectionId: inspection.id,
          // Preserve instantly-declared per-pole emergencies — standalone records
          // (no checklistItemId), NOT checklist answers. Deleting one would
          // cascade-delete its routed emergency defect, so a re-save of the
          // checklist must leave them intact.
          NOT: { isEmergency: true, checklistItemId: null },
        },
      }),
      this.prisma.inspectionItemResult.createMany({
        data,
      }),
    ]);
  }

  private async saveLegacyTemplateResults(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
    results: SaveInspectionResultItemDto[],
  ) {
    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    const templateItemMap = new Map(templateItems.map((item) => [item.id, item]));

    await this.prisma.$transaction(
      results.map((input) => {
        const templateItem = templateItemMap.get(input.templateItemId);
        if (!templateItem) {
          throw new BadRequestException(`Template item ${input.templateItemId} does not belong to this inspection template.`);
        }

        const valueData = this.buildResultValueData(templateItem, input);

        return this.prisma.inspectionResult.upsert({
          where: {
            inspectionId_templateItemId: {
              inspectionId: inspection.id,
              templateItemId: templateItem.id,
            },
          },
          create: {
            inspectionId: inspection.id,
            templateItemId: templateItem.id,
            ...valueData,
          },
          update: valueData,
        });
      }),
    );
  }

  async submit(user: RequestUser, inspectionId: string) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);

    this.assertVisitEditable(inspection.siteVisit.status);

    if (inspection.completionStatus === InspectionCompletionStatus.SUBMITTED) {
      throw new BadRequestException('Inspection has already been submitted.');
    }

    const templateItems = this.flattenTemplateItems(inspection.template.sections);
    if (inspection.itemResults.length > 0) {
      const missingChecklistItems = this.findMissingStructuredChecklistItems(
        templateItems,
        inspection.itemResults,
      );

      if (missingChecklistItems.length > 0) {
        throw new BadRequestException({
          message: 'Checklist selections are missing.',
          missingItems: missingChecklistItems,
        });
      }
    } else {
      const resultMap = new Map(inspection.results.map((result) => [result.templateItemId, result]));

      const missingRequiredItems = templateItems
        .filter((item) => item.isRequired)
        .filter((item) => !this.hasStoredValue(resultMap.get(item.id)))
        .map((item) => ({
          templateItemId: item.id,
          key: item.key,
          label: item.label,
        }));

      if (missingRequiredItems.length > 0) {
        throw new BadRequestException({
          message: 'Required inspection items are missing.',
          missingItems: missingRequiredItems,
        });
      }
    }

    const defectCreateData = this.buildDefectCreateData(inspection.itemResults);
    const submitInspection = this.prisma.inspection.update({
      where: { id: inspection.id },
      data: {
        completionStatus: InspectionCompletionStatus.SUBMITTED,
        submittedAt: new Date(),
        // A re-inspection request is answered by this submit — clear it so the
        // pole stops reading "sent back" once the crew has redone it.
        reinspectionReason: null,
        reinspectionRequestedAt: null,
        reinspectionRequestedById: null,
      },
      include: this.inspectionInclude(),
    });

    // Re-submitting a pole that was sent back keeps its earlier defects (nothing
    // is deleted when it is flagged, so findings survive if the crew never
    // returns). Any whose answer is no longer a defect must go now, or a
    // corrected false positive would linger for ever. Defects already in
    // maintenance are left alone — someone is working them.
    const clearedDefectItemResultIds = inspection.itemResults
      .filter((item) => !item.isDefect)
      .map((item) => item.id);
    if (clearedDefectItemResultIds.length > 0) {
      await this.prisma.defect.deleteMany({
        where: {
          inspectionItemResultId: { in: clearedDefectItemResultIds },
          lifecycleStatus: { notIn: MAINTENANCE_LOCKED_DEFECT_STATUSES },
        },
      });
    }

    if (defectCreateData.length === 0) {
      return submitInspection;
    }

    const [submittedInspection] = await this.prisma.$transaction([
      submitInspection,
      this.prisma.defect.createMany({
        data: defectCreateData,
        skipDuplicates: true,
      }),
    ]);

    // Maintenance handoff Phase 3 — emergency-flagged defects bypass the LAPORAN
    // SELESAI wait: release + route them to the MAINHEAD's maintenance company
    // immediately. Best-effort; a failure must not fail the submit (the defects
    // exist and the LAPORAN SELESAI release is the safety net for the rest).
    if (
      releaseDefectsOnReport() &&
      defectCreateData.some((defect) => defect.isEmergency)
    ) {
      try {
        await releaseVisitDefects(this.prisma, inspection.siteVisitId, {
          scope: 'EMERGENCY',
          actorUserId: user.id,
          inspectionId: inspection.id,
        });
      } catch (error) {
        this.logger.warn(
          `Emergency defect release failed for site visit ${inspection.siteVisitId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return submittedInspection;
  }

  /**
   * Per-pole emergency (Option 1 — instant). The field button declares a
   * dangerous-to-public condition that must reach the response side immediately,
   * independent of finishing/submitting the pole's checklist. Creates one
   * emergency item-result (FAIL + isEmergency, the note as label/remark) and its
   * CRITICAL defect right away, then routes it under RELEASE_ON_REPORT. The defect
   * surfaces in the emergency lane before the inspection is submitted (see
   * defectAccessScope's submitted-OR-emergency rule). Media is uploaded to the
   * returned defect via POST /defects/:id/evidence-images.
   */
  async declareEmergency(
    user: RequestUser,
    inspectionId: string,
    dto: { note?: string | null },
  ) {
    this.assertCanMutate(user);

    const inspection = await this.getAccessibleInspection(inspectionId, user);
    const note = this.normalizeOperationalString(dto.note);
    const label = note
      ? note.length > 200
        ? `${note.slice(0, 197)}…`
        : note
      : 'Emergency reported';

    const now = new Date();
    const itemResult = await this.prisma.inspectionItemResult.create({
      data: {
        inspectionId: inspection.id,
        label,
        result: InspectionItemResultValue.FAIL,
        remark: note,
        isDefect: true,
        isEmergency: true,
        severity: DefectSeverity.CRITICAL,
      },
      select: {
        id: true,
        severity: true,
        isEmergency: true,
        maintenanceCategory: true,
      },
    });

    const defect = await this.prisma.defect.create({
      data: buildInitialDefectData(itemResult, now),
      select: { id: true },
    });

    // Route instantly under RELEASE_ON_REPORT (stamp the MAINHEAD's maintenance
    // company). No-op under INSPECTOR_OWNS, where the emergency is already
    // VERIFIED and visible to the inspecting team. Best-effort.
    if (releaseDefectsOnReport()) {
      try {
        await releaseVisitDefects(this.prisma, inspection.siteVisitId, {
          scope: 'EMERGENCY',
          actorUserId: user.id,
          inspectionId: inspection.id,
        });
      } catch (error) {
        this.logger.warn(
          `Instant emergency release failed for inspection ${inspection.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { defectId: defect.id, inspectionItemResultId: itemResult.id };
  }

  async uploadImage(
    user: RequestUser,
    inspectionId: string,
    file: UploadedInspectionImageFile | undefined,
    dto: UploadInspectionImageDto,
  ) {
    this.assertCanMutate(user);

    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required.');
    }

    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      select: {
        id: true,
        siteVisit: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    this.assertVisitEditable(inspection.siteVisit.status);

    const uploadDirectory = buildInspectionImagesDirectory(inspection.id);

    await mkdir(uploadDirectory, { recursive: true });

    const fileExtension = this.getSafeFileExtension(file.originalname);
    const filename = `${Date.now()}-${randomUUID()}${fileExtension}`;
    const filePath = resolve(uploadDirectory, filename);

    await writeFile(filePath, file.buffer);

    const image = await this.prisma.inspectionImage.create({
      data: {
        inspectionId: inspection.id,
        templateItemId: dto.templateItemId ?? null,
        url: buildInspectionImageUrl(inspection.id, filename),
        filename,
        mimeType: file.mimetype || null,
        sizeBytes: Number.isFinite(file.size) ? file.size : null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : null,
        accuracyMeters: dto.accuracyMeters ?? null,
        capturedFixAt: dto.capturedFixAt ? new Date(dto.capturedFixAt) : null,
        mocked: dto.mocked ?? null,
      },
    });

    return this.serializeInspectionImage(image, dto.type ?? null);
  }

  /**
   * Remove a single inspection image (e.g. deleting/replacing a photo while
   * amending). Same editability gate as uploadImage — the visit must be open —
   * and the image must belong to the (accessible) inspection. The DB row is the
   * source of truth; the on-disk file is removed best-effort.
   */
  async deleteImage(user: RequestUser, inspectionId: string, imageId: string) {
    this.assertCanMutate(user);

    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...this.inspectionAccessScope(user),
      },
      select: {
        id: true,
        siteVisit: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    this.assertVisitEditable(inspection.siteVisit.status);

    const image = await this.prisma.inspectionImage.findFirst({
      where: {
        id: imageId,
        inspectionId: inspection.id,
      },
      select: {
        id: true,
        filename: true,
      },
    });

    if (!image) {
      throw new NotFoundException('Image not found.');
    }

    await this.prisma.inspectionImage.delete({ where: { id: image.id } });

    try {
      await unlink(resolve(buildInspectionImagesDirectory(inspection.id), image.filename));
    } catch {
      // File may already be gone; the row deletion is what matters.
    }

    return { id: image.id, deleted: true };
  }

  private serializeInspectionItemResult(item: {
    id: string;
    inspectionId: string;
    checklistItemId: string | null;
    label: string;
    result: string;
    remark: string | null;
    isDefect: boolean;
    isEmergency: boolean;
    severity: DefectSeverity | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      inspectionId: item.inspectionId,
      checklistItemId: item.checklistItemId,
      label: item.label,
      result: item.result,
      remark: item.remark,
      isDefect: item.isDefect,
      isEmergency: item.isEmergency,
      severity: item.severity,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private serializeInspectionImage(
    image: {
      id: string;
      inspectionId: string;
      url: string;
      filename: string;
      latitude: number | null;
      longitude: number | null;
      timestamp: Date | null;
      createdAt: Date;
    },
    type: string | null = null,
  ) {
    return {
      id: image.id,
      inspectionId: image.inspectionId,
      url: image.url,
      path: buildInspectionImagePath(image.inspectionId, image.filename),
      latitude: image.latitude,
      longitude: image.longitude,
      timestamp: image.timestamp?.toISOString() ?? null,
      type,
      createdAt: image.createdAt.toISOString(),
    };
  }

  private getSafeFileExtension(originalName: string | undefined) {
    const extension = extname(originalName || '').toLowerCase();

    if (/^\.[a-z0-9]{1,10}$/.test(extension)) {
      return extension;
    }

    return '.jpg';
  }

  private async getAccessibleInspection(
    inspectionId: string,
    user: RequestUser,
    ctx?: ScopeContext,
    opts?: { oversight?: boolean },
  ) {
    // The in-place VALUE-CORRECTION paths (kelegaan + the generalized checklist
    // edit) pass { oversight: true } so a MANAGER can fix a recorded value on
    // their own teams' AND — when they are a main contractor — their active
    // subcontractor subtree's inspections (owner-approved 2026-07-21). This is a
    // DELIBERATE, narrow exception to inspectionOversightScope's "reads only"
    // rule: it covers value corrections only; amend/submit/save stay strict on
    // inspectionAccessScope. Falls back to strict if no ctx was resolved.
    const scope =
      opts?.oversight && ctx
        ? this.inspectionOversightScope(user, ctx)
        : this.inspectionAccessScope(user, ctx);
    const inspection = await this.prisma.inspection.findFirst({
      where: {
        id: inspectionId,
        tenantId: user.tenantId,
        ...scope,
      },
      include: {
        ...this.inspectionInclude(),
        template: {
          include: {
            sections: {
              include: {
                items: {
                  where: {
                    isActive: true,
                  },
                  orderBy: {
                    sortOrder: 'asc',
                  },
                },
              },
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
        },
        results: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        itemResults: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        // Already-uploaded photos (incl. per-item IMAGE/OCR captures tagged by
        // templateItemId) so the form can rehydrate them on re-open/amend —
        // otherwise required IMAGE items wrongly read as missing and force a
        // retake.
        inspectionImages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            inspectionId: true,
            templateItemId: true,
            url: true,
            filename: true,
            latitude: true,
            longitude: true,
            timestamp: true,
            createdAt: true,
          },
        },
      },
    });

    if (!inspection) {
      throw new NotFoundException('Inspection not found.');
    }

    return inspection;
  }

  // Which site visits a user may CREATE an inspection on. Delegates to the
  // canonical role-aware SiteVisit filter (strict variant — never the widened
  // oversight scope) so create matches the read/amend paths below: ADMIN =
  // tenant, MANAGER = their whole company, SUPERVISOR = supervised teams, DC =
  // their mainheads, everyone else = own teams. Previously this was a narrow
  // own-team-membership filter, which locked a MANAGER out of inspecting their
  // own company's poles (they oversee teams but aren't members of them) — the
  // same lockout inspectionAccessScope already fixed for reads.
  private async siteVisitMutationScope(
    user: RequestUser,
  ): Promise<Prisma.SiteVisitWhereInput> {
    const ctx = await buildScopeContext(this.prisma, user);
    return siteVisitAccessWhere(user, ctx);
  }

  // Which inspections a user may read/mutate. Delegates to the canonical
  // role-aware SiteVisit filter so inspections match every other surface
  // (dashboard/defects/site-visits/map): ADMIN = tenant, MANAGER = their whole
  // company, SUPERVISOR = supervised teams, everyone else = own teams. Previously
  // this used a narrow own-team-membership filter, which locked a MANAGER out of
  // viewing/amending their own company's inspections (they oversee teams but
  // aren't members of them).
  private inspectionAccessScope(
    user: RequestUser,
    ctx?: ScopeContext,
  ): Prisma.InspectionWhereInput {
    // ctx enables the QA-actor (governs by mainhead) branch of siteVisitAccessWhere;
    // omit it and a QA/DC caller falls back to team membership and matches nothing.
    return { siteVisit: siteVisitAccessWhere(user, ctx) };
  }

  // READ-ONLY oversight variant of inspectionAccessScope: a MANAGER additionally
  // sees inspections of the company's active subcontractor subtree (work it
  // delegated). Use ONLY on read paths (getDetail); the mutation gate
  // getAccessibleInspection must stay on inspectionAccessScope so a main
  // contractor can monitor — but never amend/submit — a subcontractor's
  // inspection. Needs the ScopeContext for the resolved maintenanceOrgIds (own
  // org + active contractor descendants).
  private inspectionOversightScope(
    user: RequestUser,
    ctx: ScopeContext,
  ): Prisma.InspectionWhereInput {
    return { siteVisit: siteVisitOversightWhere(user, ctx) };
  }

  private async resolveOperationalSessionContext(
    user: RequestUser,
    operationalSessionId: string,
    assetId: string,
  ) {
    const session = await this.prisma.operationalSession.findFirst({
      where: {
        AND: [
          {
            id: operationalSessionId,
            workspaceId: user.tenantId,
          },
          await this.operationalSessionAccessScope(user),
        ],
      },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        mainheadId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Operational session not found.');
    }

    const assignment = await this.prisma.operationalSessionAsset.findFirst({
      where: {
        operationalSessionId: session.id,
        assetId,
        removedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!assignment) {
      throw new BadRequestException(
        'Asset is not assigned to this operational session.',
      );
    }

    return session;
  }

  private async operationalSessionAccessScope(
    user: RequestUser,
  ): Promise<Prisma.OperationalSessionWhereInput> {
    if (user.role === UserRole.ADMIN) {
      return {};
    }

    const organizationIds = await this.getUserOrganizationIds(user);
    const accessFilters: Prisma.OperationalSessionWhereInput[] = [
      {
        assignedQaUserId: user.id,
      },
    ];

    if (organizationIds.length > 0) {
      accessFilters.push({
        assignedCompanyId: {
          in: organizationIds,
        },
      });
    }

    return {
      OR: accessFilters,
    };
  }

  private async getUserOrganizationIds(user: RequestUser) {
    const currentUser = await this.prisma.user.findFirst({
      where: {
        id: user.id,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: {
        organizationId: true,
        organizationMemberships: {
          where: {
            isActive: true,
          },
          select: {
            organizationId: true,
          },
        },
      },
    });

    if (!currentUser) {
      return [];
    }

    return Array.from(
      new Set(
        [
          currentUser.organizationId,
          ...currentUser.organizationMemberships.map(
            (membership) => membership.organizationId,
          ),
        ].filter((organizationId): organizationId is string =>
          Boolean(organizationId),
        ),
      ),
    );
  }

  private inspectionInclude() {
    return {
      siteVisit: {
        select: {
          id: true,
          status: true,
          // Needed by requestReinspection to decide whether the survey has left
          // the field and must be reopened (PERLU_PINDAAN).
          lifecycleStatus: true,
          operationMode: true,
          operationalScope: true,
          sessionKind: true,
          requiresQAQC: true,
          reportingGroup: true,
          startedAt: true,
          team: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          substation: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      asset: {
        select: {
          id: true,
          assetCode: true,
          name: true,
          assetType: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          substation: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      template: {
        select: {
          id: true,
          name: true,
          version: true,
          assetTypeId: true,
          capabilityId: true,
          scopeLevel: true,
          organizationId: true,
          branchId: true,
          mainheadId: true,
          operationalScope: true,
          requiresQAQC: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      },
    };
  }

  private assertCanMutate(user: RequestUser) {
    // CLIENT blocked too (matches assets.assertCanMutate): the canonical visit
    // scope gives a client viewer mainhead-wide READ visibility, which must
    // never become the ability to create/submit an inspection.
    if (user.role === UserRole.VIEWER || user.role === UserRole.CLIENT) {
      throw new ForbiddenException('This role is read-only for inspection actions.');
    }
  }

  private flattenTemplateItems(
    sections: Array<{
      items: Array<{
        id: string;
        key: string;
        label: string;
        inputType: InspectionItemInputType;
        isRequired: boolean;
        isDefectTrigger: boolean;
        severity: DefectSeverity;
        maintenanceCategory: MaintenanceCategory | null;
        optionsJson: Prisma.JsonValue | null;
      }>;
    }>,
  ) {
    return sections.flatMap((section) => section.items);
  }

  private buildChecklistItemIdByLabel(
    templateItems: Array<{
      id: string;
      label: string;
    }>,
  ) {
    const byLabel = new Map<string, string | null>();

    for (const item of templateItems) {
      const labelKey = this.normalizeLabelKey(item.label);

      if (!labelKey) {
        continue;
      }

      byLabel.set(labelKey, byLabel.has(labelKey) ? null : item.id);
    }

    return byLabel;
  }

  private findMissingStructuredChecklistItems(
    templateItems: Array<{
      id: string;
      key: string;
      label: string;
    }>,
    itemResults: Array<{
      checklistItemId: string | null;
      label: string;
    }>,
  ) {
    const resultItemIds = new Set(
      itemResults
        .map((item) => item.checklistItemId)
        .filter((id): id is string => Boolean(id)),
    );
    const resultLabelCounts = new Map<string, number>();

    for (const item of itemResults) {
      if (item.checklistItemId) {
        continue;
      }

      const labelKey = this.normalizeLabelKey(item.label);

      if (!labelKey) {
        continue;
      }

      resultLabelCounts.set(labelKey, (resultLabelCounts.get(labelKey) ?? 0) + 1);
    }

    const missingItems: Array<{
      templateItemId: string;
      key: string;
      label: string;
    }> = [];

    for (const item of templateItems) {
      if (resultItemIds.has(item.id)) {
        continue;
      }

      const labelKey = this.normalizeLabelKey(item.label);
      const labelResultCount = resultLabelCounts.get(labelKey) ?? 0;

      if (labelResultCount > 0) {
        resultLabelCounts.set(labelKey, labelResultCount - 1);
        continue;
      }

      missingItems.push({
        templateItemId: item.id,
        key: item.key,
        label: item.label,
      });
    }

    return missingItems;
  }

  private normalizeLabelKey(label: string) {
    return label.trim().toLowerCase();
  }

  private normalizeOptionalString(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmedValue = value.trim();

    return trimmedValue ? trimmedValue : null;
  }

  private normalizeOperationalString(value?: string | null) {
    const normalizedValue = this.normalizeOptionalString(value);

    return normalizedValue ? normalizeOperationalText(normalizedValue) : null;
  }

  private normalizeTemplateTextValue(
    templateItem: {
      key: string;
      label: string;
    },
    value: string,
  ) {
    const trimmedValue = value.trim();

    if (!this.isOperationalTemplateTextItem(templateItem)) {
      return trimmedValue;
    }

    return this.normalizeOperationalString(trimmedValue);
  }

  private isOperationalTemplateTextItem(templateItem: { key: string; label: string }) {
    const searchText = `${templateItem.key} ${templateItem.label}`.toLowerCase();

    return OPERATIONAL_TEXT_KEYWORDS.some((keyword) => searchText.includes(keyword));
  }

  private buildResultValueData(
    templateItem: {
      id: string;
      key: string;
      label: string;
      inputType: InspectionItemInputType;
      optionsJson: Prisma.JsonValue | null;
    },
    input: SaveInspectionResultItemDto,
  ): {
    valueText: string | null;
    valueNumber: number | null;
    valueBoolean: boolean | null;
    valueDate: Date | null;
    valueDateTime: Date | null;
    valueJson: Prisma.InputJsonValue | typeof Prisma.DbNull;
  } {
    const baseValueData = {
      valueText: null,
      valueNumber: null,
      valueBoolean: null,
      valueDate: null,
      valueDateTime: null,
      valueJson: Prisma.DbNull,
    };

    switch (templateItem.inputType) {
      case InspectionItemInputType.TEXT:
        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueText:
            input.valueText === null
              ? null
              : this.normalizeTemplateTextValue(templateItem, input.valueText),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.NUMBER:
        if (input.valueNumber === undefined) {
          throw new BadRequestException(`valueNumber is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueNumber: input.valueNumber,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.OCR: {
        // Smart Sensor reading (#4): stores the OCR'd / manually-entered number.
        // Lenient on null so a missing reading never blocks submission — the
        // captured photo is the evidence and the value stays editable.
        if (input.valueNumber != null) {
          return {
            ...baseValueData,
            valueNumber: input.valueNumber,
            valueJson: Prisma.DbNull,
          };
        }

        // A non-numeric reading is stored as text: device sentinels ("LO" =
        // below measurable range, normalized via shared-utils) and, since the
        // owner's 2026-07-29 call, ANY free text the technician records (some
        // field situations can't produce a number). Uppercased for consistency
        // with the office edit path; every report/admin reader already prefers
        // valueText over valueNumber. Numeric consumers must skip text entries
        // — they already do for the sentinel and null.
        const sentinel = normalizeReadingSentinel(input.valueText);

        if (sentinel) {
          return {
            ...baseValueData,
            valueText: sentinel,
            valueJson: Prisma.DbNull,
          };
        }

        const text =
          typeof input.valueText === 'string' ? input.valueText.trim() : '';

        return {
          ...baseValueData,
          valueText: text ? text.toUpperCase() : null,
          valueJson: Prisma.DbNull,
        };
      }

      case InspectionItemInputType.BOOLEAN:
        if (input.valueBoolean === undefined) {
          throw new BadRequestException(`valueBoolean is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueBoolean: input.valueBoolean,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.DATE:
        if (input.valueDate === undefined) {
          throw new BadRequestException(`valueDate is required for template item ${input.templateItemId}.`);
        }

        if (input.valueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.valueDate)) {
          throw new BadRequestException(`valueDate must be a YYYY-MM-DD string for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueDate: input.valueDate === null ? null : new Date(`${input.valueDate}T00:00:00.000Z`),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.DATETIME:
        if (input.valueDateTime === undefined) {
          throw new BadRequestException(`valueDateTime is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueDateTime: input.valueDateTime === null ? null : new Date(input.valueDateTime),
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.SELECT: {
        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText is required for template item ${input.templateItemId}.`);
        }

        const selectedValue = input.valueText === null ? null : input.valueText.trim();

        if (selectedValue !== null && selectedValue !== '') {
          const allowedOptions = normalizeTemplateSelectOptions(templateItem.optionsJson);

          if (!allowedOptions) {
            throw new BadRequestException(
              `Template item ${templateItem.id} has invalid SELECT options configuration.`,
            );
          }

          const isAllowedOption = allowedOptions.some((option) => option.value === selectedValue);

          if (!isAllowedOption) {
            throw new BadRequestException(
              `valueText must match one of the configured SELECT options for template item ${input.templateItemId}.`,
            );
          }
        }

        return {
          ...baseValueData,
          valueText: selectedValue === '' ? null : selectedValue,
          valueJson: Prisma.DbNull,
        };
      }

      case InspectionItemInputType.MULTI_SELECT: {
        const selectedValues = this.normalizeMultiSelectValue(templateItem, input);
        // v1 "Other (free text)": when the item allows it, the custom answer
        // rides in valueText alongside the validated picks; otherwise any stray
        // valueText is ignored. Never affects defect logic.
        const allowOther = this.multiSelectAllowsOther(templateItem.optionsJson);
        const otherText =
          allowOther && typeof input.valueText === 'string'
            ? input.valueText.trim() || null
            : null;

        return {
          ...baseValueData,
          valueText: otherText,
          valueJson:
            selectedValues === null
              ? Prisma.DbNull
              : (selectedValues as Prisma.InputJsonArray),
        };
      }

      case InspectionItemInputType.IMAGE:
        return {
          ...baseValueData,
          valueJson:
            input.valueJson === undefined || input.valueJson === null
              ? Prisma.DbNull
              : (input.valueJson as Prisma.InputJsonValue),
        };

      case InspectionItemInputType.GPS:
        if (input.valueJson !== undefined) {
          return {
            ...baseValueData,
            valueJson:
              input.valueJson === null
                ? Prisma.DbNull
                : (input.valueJson as Prisma.InputJsonValue),
          };
        }

        if (input.valueText === undefined) {
          throw new BadRequestException(`valueText or valueJson is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueText: input.valueText === null ? null : input.valueText.trim() || null,
          valueJson: Prisma.DbNull,
        };

      case InspectionItemInputType.READING:
        if (input.valueNumber !== undefined) {
          return {
            ...baseValueData,
            valueNumber: input.valueNumber,
            valueJson: Prisma.DbNull,
          };
        }

        if (input.valueText !== undefined) {
          return {
            ...baseValueData,
            valueText: input.valueText === null ? null : input.valueText.trim() || null,
            valueJson: Prisma.DbNull,
          };
        }

        if (input.valueJson !== undefined) {
          return {
            ...baseValueData,
            valueJson:
              input.valueJson === null
                ? Prisma.DbNull
                : (input.valueJson as Prisma.InputJsonValue),
          };
        }

        throw new BadRequestException(`valueNumber or valueText is required for template item ${input.templateItemId}.`);

      case InspectionItemInputType.JSON:
        if (input.valueJson === undefined) {
          throw new BadRequestException(`valueJson is required for template item ${input.templateItemId}.`);
        }

        return {
          ...baseValueData,
          valueJson:
            input.valueJson === null
              ? Prisma.DbNull
              : (input.valueJson as Prisma.InputJsonValue),
        };

      default:
        throw new ForbiddenException(`Unsupported input type ${templateItem.inputType}.`);
    }
  }

  private normalizeMultiSelectValue(
    templateItem: {
      id: string;
      optionsJson: Prisma.JsonValue | null;
    },
    input: SaveInspectionResultItemDto,
  ) {
    // valueJson carries the configured picks; valueText is reserved for the
    // optional free-text "Other" answer (handled in buildResultValueData), so it
    // is NOT interpreted as a pick here.
    const rawValues = input.valueJson;

    if (rawValues === undefined || rawValues === null || rawValues === '') {
      return null;
    }

    const selectedValues = Array.isArray(rawValues)
      ? rawValues
      : String(rawValues)
          .split(',')
          .map((value) => value.trim());
    const normalizedValues = selectedValues.filter(
      (value): value is string => typeof value === 'string' && value.trim() !== '',
    );

    if (normalizedValues.length === 0) {
      return null;
    }

    const allowedOptions = normalizeTemplateSelectOptions(templateItem.optionsJson);

    if (!allowedOptions) {
      throw new BadRequestException(
        `Template item ${templateItem.id} has invalid MULTI_SELECT options configuration.`,
      );
    }

    const allowedValues = new Set(allowedOptions.map((option) => option.value));
    const uniqueValues = Array.from(new Set(normalizedValues));
    const invalidValue = uniqueValues.find((value) => !allowedValues.has(value));

    if (invalidValue) {
      throw new BadRequestException(
        `valueJson contains an option that is not configured for template item ${templateItem.id}: ${invalidValue}.`,
      );
    }

    return uniqueValues;
  }

  /** Whether a MULTI_SELECT item opts into a free-text "Other" answer (the v1
   *  `allowOther` flag in the v2 optionsJson config object). */
  private multiSelectAllowsOther(optionsJson: Prisma.JsonValue | null | undefined): boolean {
    return (
      !!optionsJson &&
      typeof optionsJson === 'object' &&
      !Array.isArray(optionsJson) &&
      (optionsJson as { allowOther?: unknown }).allowOther === true
    );
  }

  private hasStoredValue(
    result:
      | {
          valueText: string | null;
          valueNumber: Prisma.Decimal | null;
          valueBoolean: boolean | null;
          valueDate: Date | null;
          valueDateTime: Date | null;
          valueJson: Prisma.JsonValue | null;
        }
      | undefined,
  ) {
    if (!result) {
      return false;
    }

    if (result.valueText !== null && result.valueText.trim() !== '') {
      return true;
    }

    if (result.valueNumber !== null) {
      return true;
    }

    if (result.valueBoolean !== null) {
      return true;
    }

    if (result.valueDate !== null) {
      return true;
    }

    if (result.valueDateTime !== null) {
      return true;
    }

    return result.valueJson !== null;
  }

  private extractRemarks(
    results: Array<{
      valueText: string | null;
      templateItem: {
        key: string;
        label: string;
      };
    }>,
  ) {
    const remarkResult = results.find((result) => {
      const key = result.templateItem.key.toLowerCase();
      const label = result.templateItem.label.toLowerCase();

      return (
        key.includes('remark') ||
        label.includes('remark') ||
        key.includes('catatan') ||
        label.includes('catatan')
      );
    });

    return remarkResult?.valueText?.trim() ?? '';
  }

  private serializeInspectionForm(
    inspection: Awaited<ReturnType<InspectionsService['getAccessibleInspection']>>,
  ) {
    const resultMap = new Map(inspection.results.map((result) => [result.templateItemId, result]));

    return {
      inspection: {
        id: inspection.id,
        tenantId: inspection.tenantId,
        siteVisitId: inspection.siteVisitId,
        assetId: inspection.assetId,
        templateId: inspection.templateId,
        operationalSessionId: inspection.operationalSessionId,
        inspectionCycle: inspection.inspectionCycle,
        completionStatus: inspection.completionStatus,
        operationMode: inspection.operationMode,
        operationalScope: inspection.operationalScope,
        requiresQAQC: inspection.requiresQAQC,
        reportingGroup: inspection.reportingGroup,
        submittedAt: inspection.submittedAt,
        // Why this pole was sent back, so the crew opening the reopened form sees
        // what to fix — not just that it went red. Set while flagged, cleared on
        // re-submit. (Field app surfaces it as a banner.)
        reinspectionReason: inspection.reinspectionReason,
        reinspectionRequestedAt: inspection.reinspectionRequestedAt,
        createdAt: inspection.createdAt,
        updatedAt: inspection.updatedAt,
        siteVisit: inspection.siteVisit,
        asset: inspection.asset,
        createdBy: inspection.createdBy,
      },
      template: {
        id: inspection.template.id,
        name: inspection.template.name,
        version: inspection.template.version,
        assetTypeId: inspection.template.assetTypeId,
        capabilityId: inspection.template.capabilityId,
        scopeLevel: inspection.template.scopeLevel,
        organizationId: inspection.template.organizationId,
        branchId: inspection.template.branchId,
        mainheadId: inspection.template.mainheadId,
        operationalScope: inspection.template.operationalScope,
        requiresQAQC: inspection.template.requiresQAQC,
        sections: inspection.template.sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          sortOrder: section.sortOrder,
          items: section.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            helperText: item.helperText,
            inputType: item.inputType,
            isRequired: item.isRequired,
            isDefectTrigger: item.isDefectTrigger,
            severity: item.severity,
            sortOrder: item.sortOrder,
            optionsJson: item.optionsJson,
            value: this.serializeStoredValue(resultMap.get(item.id)),
          })),
        })),
      },
      results: inspection.results.map((result) => ({
        id: result.id,
        templateItemId: result.templateItemId,
        valueText: result.valueText,
        valueNumber: result.valueNumber === null ? null : Number(result.valueNumber),
        valueBoolean: result.valueBoolean,
        valueDate: result.valueDate,
        valueDateTime: result.valueDateTime,
        valueJson: result.valueJson,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      })),
      items: inspection.itemResults.map((item) => this.serializeInspectionItemResult(item)),
      images: inspection.inspectionImages.map((image) => ({
        id: image.id,
        inspectionId: image.inspectionId,
        templateItemId: image.templateItemId,
        url: image.url,
        path: buildInspectionImagePath(image.inspectionId, image.filename),
        latitude: image.latitude,
        longitude: image.longitude,
        timestamp: image.timestamp?.toISOString() ?? null,
        createdAt: image.createdAt.toISOString(),
      })),
    };
  }

  private buildDefectCreateData(
    itemResults: Array<{
      id: string;
      isDefect: boolean;
      severity: DefectSeverity | null;
      isEmergency: boolean;
      maintenanceCategory: MaintenanceCategory | null;
    }>,
  ) {
    const now = new Date();

    return itemResults
      .filter((item) => item.isDefect)
      .map((item) => buildInitialDefectData(item, now));
  }

  private serializeStoredValue(
    result:
      | {
          valueText: string | null;
          valueNumber: Prisma.Decimal | null;
          valueBoolean: boolean | null;
          valueDate: Date | null;
          valueDateTime: Date | null;
          valueJson: Prisma.JsonValue | null;
        }
      | undefined,
  ) {
    if (!result) {
      return null;
    }

    return {
      valueText: result.valueText,
      valueNumber: result.valueNumber === null ? null : Number(result.valueNumber),
      valueBoolean: result.valueBoolean,
      valueDate: result.valueDate,
      valueDateTime: result.valueDateTime,
      valueJson: result.valueJson,
    };
  }
}
