import {
  InspectionItemInputType,
  InspectionItemResultValue,
  Prisma,
} from '@prisma/client';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';

/**
 * Server-side mirror of the mobile PASS/FAIL derivation in
 * `apps/mobile/src/utils.ts` (`getInspectionItemResultValue`,
 * `getBooleanDefectValue`, `inferSelectInspectionResult`). The mobile computes
 * the verdict at capture time and the API trusts it — but an OFFICE edit of a
 * recorded value (`PATCH /inspections/:id/checklist-result`) has no mobile in
 * the loop, so the same rules must run here for the edit to raise or clear a
 * defect. Keep the two implementations in sync when either changes.
 */

// Best-effort defect keywords used ONLY when a template item has no option
// explicitly flagged as a defect. EN + Bahasa Malaysia, copied verbatim from
// the mobile's INSPECTION_DEFECT_KEYWORD_TOKENS.
const DEFECT_KEYWORD_TOKENS = new Set<string>([
  // English
  'no',
  'fail',
  'failed',
  'failure',
  'defect',
  'defects',
  'defective',
  'bad',
  'poor',
  'abnormal',
  'reject',
  'rejected',
  'unsatisfactory',
  'fault',
  'faulty',
  'damaged',
  'damage',
  'broken',
  'crack',
  'cracked',
  'rust',
  'rusty',
  'rusted',
  'corroded',
  'corrosion',
  'leak',
  'leaking',
  'missing',
  'loose',
  'worn',
  'burnt',
  'burned',
  'overheat',
  'overheated',
  'bent',
  'tilt',
  'tilted',
  'ng', // "not good" shorthand commonly used on field forms
  // Bahasa Malaysia
  'tidak',
  'tak',
  'rosak',
  'kerosakan',
  'teruk',
  'gagal',
  'bahaya',
  'merbahaya',
  'retak',
  'pecah',
  'patah',
  'karat',
  'berkarat',
  'hakis',
  'terhakis',
  'bocor',
  'longgar',
  'kendur',
  'kotor',
  'usang',
  'koyak',
  'lemah',
  'condong',
  'senget',
]);

function isNotApplicableSelection(normalizedSelection: string): boolean {
  return (
    /\bn\/?a\b/.test(normalizedSelection) ||
    normalizedSelection.includes('not applicable') ||
    normalizedSelection.includes('not_applicable') ||
    normalizedSelection.includes('tidak berkenaan') ||
    normalizedSelection.includes('tidak berkaitan')
  );
}

/**
 * For a defect-trigger BOOLEAN item, which answer means "the defect exists".
 * ASCURE SAVR checklists ask whether the defect is present (e.g.
 * "TIANG - CONDONG" → YES = defect), so TRUE is the defect by default; an
 * optional `optionsJson.defectWhen` ('TRUE' | 'FALSE' | boolean) overrides it.
 */
function booleanDefectValue(optionsJson: Prisma.JsonValue | null): boolean {
  if (
    optionsJson &&
    typeof optionsJson === 'object' &&
    !Array.isArray(optionsJson) &&
    'defectWhen' in optionsJson
  ) {
    const raw = (optionsJson as { defectWhen?: unknown }).defectWhen;
    if (raw === false || raw === 'FALSE' || raw === 'false') {
      return false;
    }
    if (raw === true || raw === 'TRUE' || raw === 'true') {
      return true;
    }
  }
  return true;
}

function inferSelectVerdict(
  optionsJson: Prisma.JsonValue | null,
  selectedValue: string,
): InspectionItemResultValue {
  const options = normalizeTemplateSelectOptions(optionsJson) ?? [];
  const selectedOption = options.find((option) => option.value === selectedValue);

  // 1) Explicit, admin-configured defect marker is authoritative and
  //    language-independent — it always wins over keyword inference.
  if (selectedOption?.isDefect) {
    return InspectionItemResultValue.FAIL;
  }

  const normalizedSelection = [selectedValue, selectedOption?.label ?? '']
    .join(' ')
    .toLowerCase();

  // N/A is about applicability, not pass/fail — honour it regardless of config.
  if (isNotApplicableSelection(normalizedSelection)) {
    return InspectionItemResultValue.NA;
  }

  // 2) If the item has ANY explicitly flagged option, trust that configuration
  //    fully: an unflagged selection is a PASS (no keyword guessing).
  if (options.some((option) => option.isDefect)) {
    return InspectionItemResultValue.PASS;
  }

  // 3) Legacy / unconfigured templates: best-effort EN + Malay keyword inference.
  const tokens = normalizedSelection.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => DEFECT_KEYWORD_TOKENS.has(token))) {
    return InspectionItemResultValue.FAIL;
  }

  return InspectionItemResultValue.PASS;
}

export type EditedChecklistValue = {
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDateTime: Date | null;
  /** MULTI_SELECT picks; null for every other type / when cleared. */
  valueJson: string[] | null;
};

/**
 * PASS / FAIL / NA for an office-edited checklist value. A cleared value is NA
 * — the office withdrew the answer, so no verdict stands on it.
 */
export function deriveEditedChecklistVerdict(
  item: {
    inputType: InspectionItemInputType;
    isDefectTrigger: boolean;
    optionsJson: Prisma.JsonValue | null;
  },
  value: EditedChecklistValue,
): InspectionItemResultValue {
  if (item.inputType === InspectionItemInputType.BOOLEAN) {
    if (value.valueBoolean !== true && value.valueBoolean !== false) {
      return InspectionItemResultValue.NA;
    }
    // Defect-trigger booleans follow the ASCURE SAVR rule: the inspector states
    // whether the defect exists, so the "defect" answer maps to FAIL.
    // Non-defect-trigger booleans keep the legacy YES = PASS / NO = FAIL.
    if (item.isDefectTrigger !== false) {
      return value.valueBoolean === booleanDefectValue(item.optionsJson)
        ? InspectionItemResultValue.FAIL
        : InspectionItemResultValue.PASS;
    }
    return value.valueBoolean === true
      ? InspectionItemResultValue.PASS
      : InspectionItemResultValue.FAIL;
  }

  if (item.inputType === InspectionItemInputType.SELECT) {
    const selected = value.valueText?.trim();
    if (!selected) {
      return InspectionItemResultValue.NA;
    }
    return inferSelectVerdict(item.optionsJson, selected);
  }

  if (item.inputType === InspectionItemInputType.MULTI_SELECT) {
    const picks = value.valueJson ?? [];
    if (picks.length === 0) {
      return InspectionItemResultValue.NA;
    }
    return picks.some(
      (pick) =>
        inferSelectVerdict(item.optionsJson, pick) ===
        InspectionItemResultValue.FAIL,
    )
      ? InspectionItemResultValue.FAIL
      : InspectionItemResultValue.PASS;
  }

  // TEXT / NUMBER / READING / OCR / DATE / DATETIME / GPS / …: answered = PASS,
  // cleared = NA (mirrors the mobile's hasInspectionDraftValue rule).
  const answered =
    value.valueText != null ||
    value.valueNumber != null ||
    value.valueDate != null ||
    value.valueDateTime != null;
  return answered ? InspectionItemResultValue.PASS : InspectionItemResultValue.NA;
}
