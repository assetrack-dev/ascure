import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DefectLifecycleStatus,
  DefectSeverity,
  DefectStatus,
  DefectTimelineEventType,
  InspectionCompletionStatus,
  InspectionItemInputType,
  InspectionItemResultSource,
  InspectionItemResultValue,
  MaintenanceCategory,
  Prisma,
  SurveyLifecycleStatus,
} from '@prisma/client';
import { buildInitialDefectData } from '../defects/defect-materialization.util';
import { isDefectSelectOption } from '../inspections/checklist-verdict.util';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import { applyPackageRouting } from './package-routing.util';

/**
 * A Kejanggalan added during maintenance that was not in the survey
 * (docs/PLAN-maintenance-flow.md §13) — e.g. a pole that did not need Rentis at
 * survey time and does now.
 *
 * Stored as ONE extra item result on the pole's latest SUBMITTED survey
 * inspection in the packaged visit, flagged source = MAINTENANCE_FINDING (the
 * declareEmergency pattern). The survey's own answers are never touched, and
 * survey outputs filter the flag out. Its Defect opens VERIFIED (released) and
 * is routed by the same package rules as every other Kejanggalan.
 *
 * Free text (TNB feedback #2, 2026-10-10): work the checklist does not list is
 * added the same way with the crew's own words as its label, no checklist item,
 * and the work type the crew picked — kept on the pole's record for later.
 */

/** Plain severity for a free-text finding (the office can change it later). */
const CUSTOM_FINDING_SEVERITY = DefectSeverity.MEDIUM;

/** A finding needs the PE's survey report to be final — same gate as packages. */
const FINDING_VISIT_STATUSES: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.LAPORAN_SELESAI,
  SurveyLifecycleStatus.ARKIB,
];

/** Lifecycles in which a Kejanggalan no longer blocks a new one for the same item. */
const NOT_OPEN_LIFECYCLES: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.CLOSED,
  DefectLifecycleStatus.REJECTED,
];

export type FindingOption = {
  value: string;
  label: string;
  severity: DefectSeverity;
};

export type FindingItem = {
  templateItemId: string;
  label: string;
  section: string | null;
  category: MaintenanceCategory;
  severity: DefectSeverity;
  inputType: InspectionItemInputType;
  /** Empty for a yes/no item — adding it IS the defect answer. */
  options: FindingOption[];
};

type TemplateItemShape = {
  id: string;
  label: string;
  inputType: InspectionItemInputType;
  isActive: boolean;
  isDefectTrigger: boolean;
  severity: DefectSeverity;
  maintenanceCategory: MaintenanceCategory | null;
  optionsJson: Prisma.JsonValue | null;
  section?: { title: string } | null;
};

/**
 * The template items a finding can be raised on, with their defect options.
 * Yes/no items that trigger defects, and select items with at least one defect
 * option. Text / number / photo items cannot carry a defect answer.
 */
export function buildFindingItems(items: TemplateItemShape[]): FindingItem[] {
  const result: FindingItem[] = [];
  for (const item of items) {
    if (!item.isActive || item.isDefectTrigger === false) continue;
    const base = {
      templateItemId: item.id,
      label: item.label,
      section: item.section?.title ?? null,
      category: item.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN,
      severity: item.severity,
      inputType: item.inputType,
    };
    if (item.inputType === InspectionItemInputType.BOOLEAN) {
      result.push({ ...base, options: [] });
      continue;
    }
    if (
      item.inputType === InspectionItemInputType.SELECT ||
      item.inputType === InspectionItemInputType.MULTI_SELECT
    ) {
      const options = (normalizeTemplateSelectOptions(item.optionsJson) ?? [])
        .filter((option) => isDefectSelectOption(item.optionsJson, option.value))
        .map((option) => ({
          value: option.value,
          label: option.label,
          severity: option.severity ?? item.severity,
        }));
      if (options.length > 0) {
        result.push({ ...base, options });
      }
    }
  }
  return result;
}

export type CreateFindingInput = {
  tenantId: string;
  siteVisitId: string;
  assetId: string;
  /** A checklist item … */
  templateItemId?: string | null;
  optionValue?: string | null;
  /** … or free text with its work type. */
  customLabel?: string | null;
  category?: MaintenanceCategory | null;
  note?: string | null;
  clientRef?: string | null;
  actorUserId: string;
  now: Date;
};

/** Validate the either/or shape; returns the free-text label when it is one. */
export function resolveFindingKind(input: {
  templateItemId?: string | null;
  customLabel?: string | null;
  category?: MaintenanceCategory | null;
}): { kind: 'ITEM'; templateItemId: string } | { kind: 'CUSTOM'; label: string; category: MaintenanceCategory } {
  const label = input.customLabel?.replace(/\s+/g, ' ').trim() || null;
  if (input.templateItemId && label) {
    throw new BadRequestException('Pick a checklist item or type the Kejanggalan — not both.');
  }
  if (input.templateItemId) return { kind: 'ITEM', templateItemId: input.templateItemId };
  if (!label) {
    throw new BadRequestException('Pick a checklist item, or type what you found.');
  }
  if (!input.category) {
    throw new BadRequestException('Pick the work type for this Kejanggalan.');
  }
  return { kind: 'CUSTOM', label, category: input.category };
}

export type CreatedFinding = {
  defectId: string;
  inspectionItemResultId: string;
  /** False when clientRef matched an earlier add (offline retry). */
  created: boolean;
};

/**
 * Create the finding + its Defect and route it. Must run inside the caller's
 * transaction (the caller checks who may add, and may still roll back).
 */
export async function createMaintenanceFinding(
  tx: Prisma.TransactionClient,
  input: CreateFindingInput,
): Promise<CreatedFinding> {
  const clientRef = input.clientRef?.trim() || null;
  if (clientRef) {
    const existing = await tx.inspectionItemResult.findUnique({
      where: { clientRef },
      select: {
        id: true,
        defect: { select: { id: true } },
        inspection: { select: { tenantId: true, siteVisitId: true, assetId: true } },
      },
    });
    if (existing) {
      if (
        existing.inspection.tenantId !== input.tenantId ||
        existing.inspection.siteVisitId !== input.siteVisitId ||
        existing.inspection.assetId !== input.assetId ||
        !existing.defect
      ) {
        throw new ConflictException('This finding reference was already used for another pole.');
      }
      return { defectId: existing.defect.id, inspectionItemResultId: existing.id, created: false };
    }
  }

  const visit = await tx.siteVisit.findFirst({
    where: { id: input.siteVisitId, tenantId: input.tenantId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!visit) {
    throw new NotFoundException('Pencawang survey not found.');
  }
  if (!visit.lifecycleStatus || !FINDING_VISIT_STATUSES.includes(visit.lifecycleStatus)) {
    throw new BadRequestException(
      'This Pencawang survey is not released for maintenance yet (needs LAPORAN SELESAI).',
    );
  }

  // The pole's survey inspection in this visit — the finding hangs off it.
  const inspection = await tx.inspection.findFirst({
    where: {
      tenantId: input.tenantId,
      siteVisitId: visit.id,
      assetId: input.assetId,
      completionStatus: InspectionCompletionStatus.SUBMITTED,
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, templateId: true },
  });
  if (!inspection) {
    throw new BadRequestException('This pole has no submitted survey in this Pencawang package.');
  }

  const kind = resolveFindingKind(input);
  if (kind.kind === 'CUSTOM') {
    return createCustomFinding(tx, input, { visitId: visit.id, inspectionId: inspection.id, clientRef }, kind);
  }

  const templateItem = await tx.inspectionTemplateItem.findFirst({
    where: { id: kind.templateItemId, templateId: inspection.templateId },
    select: {
      id: true,
      label: true,
      inputType: true,
      isActive: true,
      isDefectTrigger: true,
      severity: true,
      maintenanceCategory: true,
      optionsJson: true,
    },
  });
  if (!templateItem) {
    throw new BadRequestException('That checklist item is not on this pole’s survey checklist.');
  }
  const findingItem = buildFindingItems([templateItem])[0];
  if (!findingItem) {
    throw new BadRequestException('That checklist item cannot carry a Kejanggalan.');
  }

  let option: FindingOption | null = null;
  if (findingItem.options.length > 0) {
    option = findingItem.options.find((candidate) => candidate.value === input.optionValue) ?? null;
    if (!option) {
      throw new BadRequestException('Pick which defect it is for this checklist item.');
    }
  }

  // One open Kejanggalan per pole + item: survey or finding, any visit.
  const duplicate = await tx.defect.findFirst({
    where: {
      status: { notIn: [DefectStatus.CLOSED, DefectStatus.RESOLVED] },
      OR: [{ lifecycleStatus: null }, { lifecycleStatus: { notIn: NOT_OPEN_LIFECYCLES } }],
      inspectionItemResult: {
        isDefect: true,
        checklistItemId: templateItem.id,
        inspection: { tenantId: input.tenantId, assetId: input.assetId },
      },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictException({
      message: 'This pole already has an open Kejanggalan for that checklist item — use it.',
      defectId: duplicate.id,
    });
  }

  const note = input.note?.trim() || null;
  const remark = [option?.label, note].filter(Boolean).join(' — ') || null;
  const severity = option?.severity ?? templateItem.severity ?? DefectSeverity.MEDIUM;

  const itemResult = await tx.inspectionItemResult.create({
    data: {
      inspectionId: inspection.id,
      checklistItemId: templateItem.id,
      label: templateItem.label,
      result: InspectionItemResultValue.FAIL,
      remark,
      isDefect: true,
      isEmergency: false,
      severity,
      maintenanceCategory: findingItem.category,
      source: InspectionItemResultSource.MAINTENANCE_FINDING,
      createdByUserId: input.actorUserId,
      clientRef,
    },
    select: { id: true, severity: true, isEmergency: true, maintenanceCategory: true },
  });

  const initial = buildInitialDefectData(itemResult, input.now);
  const defect = await tx.defect.create({
    data: {
      ...initial,
      // Released at once — the PE is already past LAPORAN SELESAI.
      lifecycleStatus: DefectLifecycleStatus.VERIFIED,
      verifiedAt: input.now,
    },
    select: { id: true },
  });
  await tx.defectTimelineEntry.create({
    data: {
      defectId: defect.id,
      type: DefectTimelineEventType.CREATED,
      toStatus: DefectStatus.OPEN,
      toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
      comment: `New finding (not in survey): ${templateItem.label}${remark ? ` — ${remark}` : ''}`,
      createdByUserId: input.actorUserId,
      createdAt: input.now,
    },
  });

  await applyPackageRouting(tx, visit.id, {
    actorUserId: input.actorUserId,
    now: input.now,
    reason: 'New finding added during maintenance',
  });

  return { defectId: defect.id, inspectionItemResultId: itemResult.id, created: true };
}

/** A free-text finding (no checklist item): same storage, routing and release. */
async function createCustomFinding(
  tx: Prisma.TransactionClient,
  input: CreateFindingInput,
  context: { visitId: string; inspectionId: string; clientRef: string | null },
  kind: { label: string; category: MaintenanceCategory },
): Promise<CreatedFinding> {
  // One open Kejanggalan per pole + wording (case-insensitive).
  const duplicate = await tx.defect.findFirst({
    where: {
      status: { notIn: [DefectStatus.CLOSED, DefectStatus.RESOLVED] },
      OR: [{ lifecycleStatus: null }, { lifecycleStatus: { notIn: NOT_OPEN_LIFECYCLES } }],
      inspectionItemResult: {
        isDefect: true,
        checklistItemId: null,
        source: InspectionItemResultSource.MAINTENANCE_FINDING,
        label: { equals: kind.label, mode: 'insensitive' },
        inspection: { tenantId: input.tenantId, assetId: input.assetId },
      },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictException({
      message: 'This pole already has an open Kejanggalan with that wording — use it.',
      defectId: duplicate.id,
    });
  }

  const remark = input.note?.trim() || null;
  const itemResult = await tx.inspectionItemResult.create({
    data: {
      inspectionId: context.inspectionId,
      checklistItemId: null,
      label: kind.label,
      result: InspectionItemResultValue.FAIL,
      remark,
      isDefect: true,
      isEmergency: false,
      severity: CUSTOM_FINDING_SEVERITY,
      maintenanceCategory: kind.category,
      source: InspectionItemResultSource.MAINTENANCE_FINDING,
      createdByUserId: input.actorUserId,
      clientRef: context.clientRef,
    },
    select: { id: true, severity: true, isEmergency: true, maintenanceCategory: true },
  });

  const defect = await tx.defect.create({
    data: {
      ...buildInitialDefectData(itemResult, input.now),
      lifecycleStatus: DefectLifecycleStatus.VERIFIED,
      verifiedAt: input.now,
    },
    select: { id: true },
  });
  await tx.defectTimelineEntry.create({
    data: {
      defectId: defect.id,
      type: DefectTimelineEventType.CREATED,
      toStatus: DefectStatus.OPEN,
      toLifecycleStatus: DefectLifecycleStatus.VERIFIED,
      comment: `New finding (not in the checklist — Lain-lain): ${kind.label}${remark ? ` — ${remark}` : ''}`,
      createdByUserId: input.actorUserId,
      createdAt: input.now,
    },
  });

  await applyPackageRouting(tx, context.visitId, {
    actorUserId: input.actorUserId,
    now: input.now,
    reason: 'New finding added during maintenance',
  });

  return { defectId: defect.id, inspectionItemResultId: itemResult.id, created: true };
}

/** The template defect-capable items of a visit's survey checklist(s), for pickers. */
export async function loadVisitFindingItems(
  prisma: Prisma.TransactionClient,
  siteVisitId: string,
): Promise<Array<{ templateId: string; items: FindingItem[] }>> {
  const templates = await prisma.inspection.findMany({
    where: { siteVisitId, completionStatus: InspectionCompletionStatus.SUBMITTED },
    distinct: ['templateId'],
    select: { templateId: true },
  });
  if (templates.length === 0) return [];
  const items = await prisma.inspectionTemplateItem.findMany({
    where: { templateId: { in: templates.map((row) => row.templateId) } },
    orderBy: [{ section: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    select: {
      id: true,
      templateId: true,
      label: true,
      inputType: true,
      isActive: true,
      isDefectTrigger: true,
      severity: true,
      maintenanceCategory: true,
      optionsJson: true,
      section: { select: { title: true } },
    },
  });
  return templates.map(({ templateId }) => ({
    templateId,
    items: buildFindingItems(items.filter((item) => item.templateId === templateId)),
  }));
}
