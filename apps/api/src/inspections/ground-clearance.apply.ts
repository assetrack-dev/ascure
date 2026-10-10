import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectTimelineEventType,
  InspectionCompletionStatus,
  InspectionItemInputType,
  InspectionItemResultValue,
  OperationalScope,
  Prisma,
  PrismaClient,
  SurveyLifecycleStatus,
} from '@prisma/client';
import { buildInitialDefectData } from '../defects/defect-materialization.util';
import { DEFAULT_OPERATIONAL_SCOPE, inferOperationalScopeFromAssetTypeCode } from '../common/operational-scope';
import { MAINTENANCE_LOCKED_DEFECT_STATUSES } from '../common/authorization/defect-governance';
import { applyPackageRouting } from '../maintenance-packages/package-routing.util';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';
import { deriveEditedChecklistVerdict } from './checklist-verdict.util';
import {
  GC_ITEM_LABEL,
  gradeGroundClearance,
  isRoadOrLowFailure,
  type GcPoleResult,
} from './ground-clearance.util';

/**
 * Auto "TIDAK PATUH GROUND CLEARANCE" on stored surveys (TNB feedback #3).
 * Plain functions on a Prisma client so the API (submit / office edits) and the
 * one-time backfill script (prisma/scripts/backfill-ground-clearance.ts) run the
 * exact same evaluation and write.
 *
 * Evaluation unit = one Pencawang: its latest exportable SAVR inspection per
 * pole, in the checklist export's order — the very rows the QR AUTO receives.
 *
 * The item is a Yes/No (SS / GRK / KLT / KLB: YES) or, on KUANTAN, an A/B grade
 * dropdown: owner rule 2026-10-11 = A (Super Critical) when a failing span is
 * over MELINTASI JALAN RAYA or marked LO, otherwise B (Critical); the option's
 * own severity applies.
 *
 * Writing only ever ADDS the flag (QR AUTO behaviour: a surveyor's own flag
 * without a failing span is reported, never removed). The flag is written like
 * an office edit of the item to YES: value + verdict + Kejanggalan; on a survey
 * whose report is already final (LAPORAN SELESAI / ARKIB) the Kejanggalan opens
 * released (VERIFIED) and follows the Pencawang's maintenance package.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const READING_LABELS = (n: number) => [`GAMBAR KELEGAAN ${n}`, `BACAAN KELEGAAN ${n}`];
const TERRAIN_LABEL = (n: number) => `KEADAAN DI TAPAK ${n}`;
const UMBANG_LABEL = 'UMBANG - TERBANG / SUPPORT POLE';
const CATATAN_LABELS = ['CATITAN', 'CATATAN'];
const RELEASED_VISIT_STATUSES: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.LAPORAN_SELESAI,
  SurveyLifecycleStatus.ARKIB,
];
const AUTO_REMARK_PREFIX = 'Auto (ground clearance)';
/** An office user set the GC item by hand — the auto rule leaves the pole alone. */
export const GC_OFFICE_OVERRIDE_REMARK = 'Office override (ground clearance)';

/** Labels whose value feeds the rule: an office edit of one re-grades the Pencawang. */
export function isGroundClearanceInputLabel(label: string): boolean {
  const key = norm(label);
  return key !== norm(GC_ITEM_LABEL) && WANTED_LABELS.has(key);
}

export function isGroundClearanceItemLabel(label: string): boolean {
  return norm(label) === norm(GC_ITEM_LABEL);
}

const norm = (label: string) => label.toUpperCase().replace(/\s+/g, ' ').trim();
const WANTED_LABELS = new Set(
  [
    ...[1, 2, 3].flatMap((n) => [...READING_LABELS(n), TERRAIN_LABEL(n)]),
    UMBANG_LABEL,
    ...CATATAN_LABELS,
    GC_ITEM_LABEL,
  ].map(norm),
);

type TemplateItem = {
  id: string;
  label: string;
  inputType: InspectionItemInputType;
  optionsJson: Prisma.JsonValue;
  severity: Prisma.InspectionTemplateItemGetPayload<{ select: { severity: true } }>['severity'];
  isDefectTrigger: boolean;
  maintenanceCategory: Prisma.InspectionTemplateItemGetPayload<{ select: { maintenanceCategory: true } }>['maintenanceCategory'];
};

type StoredResult = {
  templateItemId: string;
  valueText: string | null;
  valueNumber: Prisma.Decimal | null;
  valueBoolean: boolean | null;
  valueJson: Prisma.JsonValue;
};

export interface GcPoleReport {
  inspectionId: string;
  assetId: string;
  siteVisitId: string;
  code: string;
  /** The template has the TIDAK PATUH GROUND CLEARANCE item. */
  hasItem: boolean;
  /** The item can be written: a Yes/No item, or a dropdown with A/B defect grades. */
  writable: boolean;
  /** Dropdown items only: the grade the rule picks (A / B). */
  grade: string | null;
  computedFail: boolean;
  /** Already YES (surveyor or an earlier auto-set). */
  alreadyFlagged: boolean;
  /** Why it fails, e.g. "slot 2: TAK PATUH (4.1 < 5.49 · MELINTASI JALAN RAYA)". */
  reasons: string[];
}

export interface GcPencawangReport {
  substationId: string;
  poles: number;
  /** Computed TAK PATUH, not yet flagged → would be set. */
  toSet: GcPoleReport[];
  /** Computed TAK PATUH and already flagged. */
  agreed: number;
  /** Flagged by the surveyor but no failing span (kept, reported). */
  surveyorOnly: number;
  /** Computed TAK PATUH but the template lacks a writable item. */
  unwritable: GcPoleReport[];
  /** Set automatically earlier, no longer failing (reading corrected) → withdraw. */
  toWithdraw: GcPoleReport[];
  /** An office user set the item by hand — left alone. */
  overridden: number;
}

/** The answer the auto flag writes for this item, or null when it can't. */
function autoAnswer(
  item: Pick<TemplateItem, 'inputType' | 'optionsJson'>,
  roadOrLow: boolean,
): { kind: 'BOOLEAN' } | { kind: 'SELECT'; value: string; severity: TemplateItem['severity'] | null } | null {
  if (item.inputType === InspectionItemInputType.BOOLEAN) return { kind: 'BOOLEAN' };
  if (item.inputType !== InspectionItemInputType.SELECT) return null;
  const defectOptions = (normalizeTemplateSelectOptions(item.optionsJson) ?? []).filter((option) => option.isDefect);
  const wanted = roadOrLow ? 'A' : 'B';
  const option =
    defectOptions.find((candidate) => candidate.value.trim().toUpperCase() === wanted) ??
    // A template without that grade falls back to its nearest defect option.
    (roadOrLow ? defectOptions[0] : defectOptions[1] ?? defectOptions[0]);
  return option ? { kind: 'SELECT', value: option.value, severity: option.severity ?? null } : null;
}

/** Text value the checklist export would show for a non-Yes/No cell. */
function cellText(item: TemplateItem, result: StoredResult | undefined): string {
  if (!result) return '';
  if (item.inputType === InspectionItemInputType.MULTI_SELECT) {
    const picks = Array.isArray(result.valueJson) ? result.valueJson.map((value) => String(value)) : [];
    const other = result.valueText?.trim() ?? '';
    return [...picks, ...(other ? [other] : [])].join(', ');
  }
  if (result.valueText != null && result.valueText !== '') return result.valueText;
  if (result.valueNumber != null) return String(result.valueNumber.toNumber());
  return '';
}

/** Evaluate one Pencawang (read-only). */
export async function evaluatePencawangGroundClearance(
  db: Db,
  tenantId: string,
  substationId: string,
): Promise<GcPencawangReport> {
  const inspections = await db.inspection.findMany({
    where: {
      tenantId,
      asset: { substationId },
      OR: [
        { completionStatus: InspectionCompletionStatus.SUBMITTED },
        { reinspectionRequestedAt: { not: null } },
      ],
    },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      assetId: true,
      siteVisitId: true,
      templateId: true,
      operationalScope: true,
      asset: {
        select: { assetCode: true, assetType: { select: { code: true, operationalScope: true } } },
      },
    },
  });

  // Same SAVR filter + latest-per-pole + asset-code order as the export.
  const latest = new Map<string, (typeof inspections)[number]>();
  for (const inspection of inspections) {
    const scope =
      inspection.operationalScope ??
      inspection.asset.assetType?.operationalScope ??
      inferOperationalScopeFromAssetTypeCode(inspection.asset.assetType?.code) ??
      DEFAULT_OPERATIONAL_SCOPE;
    if (scope !== OperationalScope.SAVR) continue;
    if (!latest.has(inspection.assetId)) latest.set(inspection.assetId, inspection);
  }
  const chosen = [...latest.values()].sort((left, right) =>
    left.asset.assetCode.localeCompare(right.asset.assetCode),
  );
  const empty: GcPencawangReport = {
    substationId,
    poles: chosen.length,
    toSet: [],
    agreed: 0,
    surveyorOnly: 0,
    unwritable: [],
    toWithdraw: [],
    overridden: 0,
  };
  if (chosen.length === 0) return empty;

  const templateIds = [...new Set(chosen.map((inspection) => inspection.templateId))];
  const items = (
    await db.inspectionTemplateItem.findMany({
      where: { section: { templateId: { in: templateIds } } },
      select: {
        id: true,
        label: true,
        inputType: true,
        optionsJson: true,
        severity: true,
        isDefectTrigger: true,
        maintenanceCategory: true,
        section: { select: { templateId: true } },
      },
    })
  ).filter((item) => WANTED_LABELS.has(norm(item.label)));
  const itemsByTemplate = new Map<string, Map<string, TemplateItem>>();
  for (const item of items) {
    const byLabel = itemsByTemplate.get(item.section.templateId) ?? new Map<string, TemplateItem>();
    if (!byLabel.has(norm(item.label))) byLabel.set(norm(item.label), item);
    itemsByTemplate.set(item.section.templateId, byLabel);
  }

  const inspectionIds = chosen.map((inspection) => inspection.id);
  const itemIds = items.map((item) => item.id);
  const [results, gcVerdicts] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve([] as Array<StoredResult & { inspectionId: string }>)
      : db.inspectionResult.findMany({
          where: { inspectionId: { in: inspectionIds }, templateItemId: { in: itemIds } },
          select: {
            inspectionId: true,
            templateItemId: true,
            valueText: true,
            valueNumber: true,
            valueBoolean: true,
            valueJson: true,
          },
        }),
    db.inspectionItemResult.findMany({
      where: {
        inspectionId: { in: inspectionIds },
        checklistItemId: { in: items.filter((item) => norm(item.label) === norm(GC_ITEM_LABEL)).map((item) => item.id) },
      },
      select: { inspectionId: true, result: true, isDefect: true, remark: true },
    }),
  ]);
  const resultsByInspection = new Map<string, Map<string, StoredResult>>();
  for (const result of results) {
    const byItem = resultsByInspection.get(result.inspectionId) ?? new Map<string, StoredResult>();
    byItem.set(result.templateItemId, result);
    resultsByInspection.set(result.inspectionId, byItem);
  }
  const flaggedVerdicts = gcVerdicts.filter(
    (verdict) => verdict.isDefect && verdict.result === InspectionItemResultValue.FAIL,
  );
  const flaggedInspections = new Set(flaggedVerdicts.map((verdict) => verdict.inspectionId));
  const overridden = new Set(
    gcVerdicts
      .filter((verdict) => verdict.remark === GC_OFFICE_OVERRIDE_REMARK)
      .map((verdict) => verdict.inspectionId),
  );
  const autoFlagged = new Set(
    flaggedVerdicts
      .filter((verdict) => verdict.remark?.startsWith(AUTO_REMARK_PREFIX))
      .map((verdict) => verdict.inspectionId),
  );

  const value = (inspectionId: string, templateId: string, labels: string[]) => {
    const byLabel = itemsByTemplate.get(templateId);
    for (const label of labels) {
      const item = byLabel?.get(norm(label));
      if (item) return cellText(item, resultsByInspection.get(inspectionId)?.get(item.id));
    }
    return '';
  };

  const graded = gradeGroundClearance(
    chosen.map((inspection) => ({
      key: inspection.id,
      code: inspection.asset.assetCode,
      slots: [1, 2, 3].map((n) => ({
        reading: value(inspection.id, inspection.templateId, READING_LABELS(n)),
        terrain: value(inspection.id, inspection.templateId, [TERRAIN_LABEL(n)]),
      })),
      umbang: value(inspection.id, inspection.templateId, [UMBANG_LABEL]),
      catatan: value(inspection.id, inspection.templateId, CATATAN_LABELS),
    })),
  );
  const gradeByKey = new Map<string, GcPoleResult>(graded.map((row) => [row.key, row]));

  const report: GcPencawangReport = { ...empty, toSet: [], unwritable: [], toWithdraw: [] };
  for (const inspection of chosen) {
    const grade = gradeByKey.get(inspection.id);
    const gcItem = itemsByTemplate.get(inspection.templateId)?.get(norm(GC_ITEM_LABEL));
    const alreadyFlagged = flaggedInspections.has(inspection.id);
    const computedFail = grade?.fail ?? false;
    const failing = (grade?.spans ?? []).filter((span) => span.grade?.status === 'TAK PATUH');
    const roadOrLow = failing.some((span) => isRoadOrLowFailure(span.grade!));
    const answer = gcItem ? autoAnswer(gcItem, roadOrLow) : null;
    const pole: GcPoleReport = {
      inspectionId: inspection.id,
      assetId: inspection.assetId,
      siteVisitId: inspection.siteVisitId,
      code: inspection.asset.assetCode,
      hasItem: Boolean(gcItem),
      writable: answer !== null,
      grade: answer?.kind === 'SELECT' ? answer.value : null,
      computedFail,
      alreadyFlagged,
      reasons: failing.map((span) => span.grade!.detail ?? `slot ${span.slot}: TAK PATUH`),
    };
    if (overridden.has(inspection.id)) report.overridden += 1;
    else if (computedFail && alreadyFlagged) report.agreed += 1;
    else if (computedFail && pole.writable) report.toSet.push(pole);
    else if (computedFail) report.unwritable.push(pole);
    else if (alreadyFlagged && autoFlagged.has(inspection.id)) report.toWithdraw.push(pole);
    else if (alreadyFlagged) report.surveyorOnly += 1;
  }
  return report;
}

/**
 * Set the flag on every pole the evaluation says to. One transaction per
 * Pencawang; returns how many were set. `actorUserId` stamps the amendment
 * (null for a system run — no stamp).
 */
export async function applyPencawangGroundClearance(
  prisma: PrismaClient,
  tenantId: string,
  substationId: string,
  options: { actorUserId: string | null; now?: Date } = { actorUserId: null },
): Promise<{ set: number; withdrawn: number; report: GcPencawangReport }> {
  const report = await evaluatePencawangGroundClearance(prisma, tenantId, substationId);
  if (report.toSet.length === 0 && report.toWithdraw.length === 0) return { set: 0, withdrawn: 0, report };
  let withdrawn = 0;
  const now = options.now ?? new Date();

  await prisma.$transaction(async (tx) => {
    const visitsToRoute = new Set<string>();
    for (const pole of report.toSet) {
      const inspection = await tx.inspection.findUniqueOrThrow({
        where: { id: pole.inspectionId },
        select: {
          id: true,
          template: {
            select: {
              sections: {
                select: {
                  items: {
                    select: {
                      id: true,
                      label: true,
                      inputType: true,
                      optionsJson: true,
                      severity: true,
                      isDefectTrigger: true,
                      maintenanceCategory: true,
                    },
                  },
                },
              },
            },
          },
          siteVisit: { select: { id: true, lifecycleStatus: true } },
          itemResults: {
            select: { id: true, checklistItemId: true, label: true, isEmergency: true, remark: true, source: true },
          },
        },
      });
      const item = inspection.template.sections
        .flatMap((section) => section.items)
        .find((candidate) => norm(candidate.label) === norm(GC_ITEM_LABEL));
      if (!item) continue;
      const answer =
        item.inputType === InspectionItemInputType.BOOLEAN
          ? ({ kind: 'BOOLEAN' } as const)
          : pole.grade
            ? autoAnswer(item, pole.grade.trim().toUpperCase() === 'A')
            : null;
      if (!answer) continue;

      const edited = {
        valueText: answer.kind === 'SELECT' ? answer.value : null,
        valueNumber: null,
        valueBoolean: answer.kind === 'BOOLEAN' ? true : null,
        valueDate: null,
        valueDateTime: null,
        valueJson: null,
      };
      const result = deriveEditedChecklistVerdict(item, edited);
      const isDefect = result === InspectionItemResultValue.FAIL && item.isDefectTrigger !== false;
      const remark = `${AUTO_REMARK_PREFIX}: ${pole.reasons.join(' | ')}`.slice(0, 500);

      if (options.actorUserId) {
        await tx.inspection.update({
          where: { id: inspection.id },
          data: { lastAmendedAt: now, lastAmendedById: options.actorUserId },
        });
      }
      await tx.inspectionResult.upsert({
        where: { inspectionId_templateItemId: { inspectionId: inspection.id, templateItemId: item.id } },
        create: {
          inspectionId: inspection.id,
          templateItemId: item.id,
          valueText: edited.valueText,
          valueBoolean: edited.valueBoolean,
        },
        update: {
          valueText: edited.valueText,
          valueNumber: null,
          valueBoolean: edited.valueBoolean,
          valueDate: null,
          valueDateTime: null,
          valueJson: Prisma.DbNull,
        },
      });

      const labelKey = item.label.trim().toLowerCase();
      const existing =
        inspection.itemResults.find((row) => row.checklistItemId === item.id) ??
        inspection.itemResults.find(
          (row) =>
            row.source !== 'MAINTENANCE_FINDING' &&
            !(row.isEmergency && row.checklistItemId === null) &&
            row.label.trim().toLowerCase() === labelKey,
        );
      // A dropdown grade carries its own severity (A → CRITICAL, B → HIGH).
      const severity = isDefect ? (answer.kind === 'SELECT' ? answer.severity : null) ?? item.severity : null;
      const itemResultData = {
        checklistItemId: item.id,
        result,
        isDefect,
        isEmergency: isDefect ? (existing?.isEmergency ?? false) : false,
        severity,
        maintenanceCategory: item.maintenanceCategory ?? null,
      };
      const itemResultId = existing
        ? (
            await tx.inspectionItemResult.update({
              where: { id: existing.id },
              data: { ...itemResultData, ...(existing.remark ? {} : { remark }) },
              select: { id: true },
            })
          ).id
        : (
            await tx.inspectionItemResult.create({
              data: { inspectionId: inspection.id, label: item.label, remark, ...itemResultData },
              select: { id: true },
            })
          ).id;
      if (!isDefect) continue;

      const released = inspection.siteVisit.lifecycleStatus
        ? RELEASED_VISIT_STATUSES.includes(inspection.siteVisit.lifecycleStatus)
        : false;
      const initial = buildInitialDefectData(
        {
          id: itemResultId,
          severity,
          isEmergency: itemResultData.isEmergency,
          maintenanceCategory: itemResultData.maintenanceCategory,
        },
        now,
      );
      const defect = await tx.defect.upsert({
        where: { inspectionItemResultId: itemResultId },
        create: {
          ...initial,
          // A final report's Kejanggalan are already with maintenance.
          ...(released && initial.lifecycleStatus === DefectLifecycleStatus.DETECTED
            ? { lifecycleStatus: DefectLifecycleStatus.VERIFIED }
            : {}),
        },
        update: {},
        select: { id: true, lifecycleStatus: true },
      });
      if (released && defect.lifecycleStatus === DefectLifecycleStatus.DETECTED) {
        await tx.defect.update({ where: { id: defect.id }, data: { lifecycleStatus: DefectLifecycleStatus.VERIFIED } });
      }
      if (!MAINTENANCE_LOCKED_DEFECT_STATUSES.includes(defect.lifecycleStatus ?? DefectLifecycleStatus.DETECTED)) {
        await tx.defectTimelineEntry.create({
          data: {
            id: randomUUID(),
            defectId: defect.id,
            type: DefectTimelineEventType.COMMENT,
            fromLifecycleStatus: null,
            toLifecycleStatus: released ? DefectLifecycleStatus.VERIFIED : defect.lifecycleStatus,
            comment: `TIDAK PATUH GROUND CLEARANCE set automatically (QR AUTO rule): ${pole.reasons.join(' | ')}`.slice(0, 1000),
            createdByUserId: options.actorUserId,
            createdAt: now,
          },
        });
      }
      if (released) visitsToRoute.add(inspection.siteVisit.id);
    }

    // Withdraw auto-set flags whose span now passes (the reading was corrected).
    // Only our own (remark-marked) flags; a Kejanggalan maintenance already holds
    // keeps its verdict.
    for (const pole of report.toWithdraw) {
      const itemResult = await tx.inspectionItemResult.findFirst({
        where: {
          inspectionId: pole.inspectionId,
          // Only the auto-set GC flag carries this remark.
          remark: { startsWith: AUTO_REMARK_PREFIX },
          checklistItemId: { not: null },
        },
        select: {
          id: true,
          checklistItemId: true,
          defect: { select: { id: true, lifecycleStatus: true, _count: { select: { evidenceImages: true } } } },
        },
      });
      if (!itemResult?.checklistItemId) continue;
      const defect = itemResult.defect;
      if (
        defect &&
        (MAINTENANCE_LOCKED_DEFECT_STATUSES.includes(defect.lifecycleStatus ?? DefectLifecycleStatus.DETECTED) ||
          defect._count.evidenceImages > 0)
      ) {
        continue;
      }
      if (defect) await tx.defect.delete({ where: { id: defect.id } });
      await tx.inspectionItemResult.update({
        where: { id: itemResult.id },
        data: { result: InspectionItemResultValue.PASS, isDefect: false, isEmergency: false, severity: null, remark: null },
      });
      // Yes/No → NO; a grade dropdown has no "no" option, so its answer is cleared.
      const stored = await tx.inspectionResult.findUnique({
        where: {
          inspectionId_templateItemId: { inspectionId: pole.inspectionId, templateItemId: itemResult.checklistItemId },
        },
        select: { valueBoolean: true },
      });
      await tx.inspectionResult.updateMany({
        where: { inspectionId: pole.inspectionId, templateItemId: itemResult.checklistItemId },
        data: stored?.valueBoolean != null ? { valueBoolean: false } : { valueText: null },
      });
      if (options.actorUserId) {
        await tx.inspection.update({
          where: { id: pole.inspectionId },
          data: { lastAmendedAt: now, lastAmendedById: options.actorUserId },
        });
      }
      withdrawn += 1;
    }

    for (const siteVisitId of visitsToRoute) {
      await applyPackageRouting(tx, siteVisitId, {
        actorUserId: options.actorUserId,
        now,
        reason: 'Auto ground clearance',
      });
    }
  }, { timeout: 120_000 });

  return { set: report.toSet.length, withdrawn, report };
}
