import {
  ChecklistDraftValues,
  DraftValues,
  InspectionFormResponse,
  InspectionItemResultValue,
  InspectionSummary,
  InspectionTemplateItem,
  InspectionTemplateSection,
  SaveInspectionItemResultInput,
  SaveInspectionResultItemInput,
  SelectOption,
  SiteVisit,
} from './types';
import {
  canShowInInspectionMobileQueue,
  getInspectionQueueStatusGroup,
} from './operationalWorkspace';
import { normalizeReadingSentinel } from '@ascure/shared-utils';

export function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatRole(role: string) {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

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
const PRESERVED_OPERATIONAL_TEXT_PART_PATTERN =
  /((?:https?:\/\/|www\.)\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const PRESERVED_OPERATIONAL_TEXT_TOKEN_PATTERN =
  /^(?:(?:https?:\/\/|www\.)\S+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})$/i;

export function normalizeOperationalText(value: string) {
  return value
    .split(PRESERVED_OPERATIONAL_TEXT_PART_PATTERN)
    .map((part) =>
      PRESERVED_OPERATIONAL_TEXT_TOKEN_PATTERN.test(part) ? part : part.toUpperCase(),
    )
    .join('');
}

export function normalizeOperationalPayloadText(value: string) {
  const normalizedValue = normalizeOperationalText(value).trim();

  return normalizedValue || undefined;
}

export function isOperationalTemplateTextItem(item: InspectionTemplateItem) {
  const searchText = `${item.key} ${item.label}`.toLowerCase();

  return OPERATIONAL_TEXT_KEYWORDS.some((keyword) => searchText.includes(keyword));
}

export function formatInspectionStatus(status: 'DRAFT' | 'SUBMITTED') {
  return status === 'SUBMITTED' ? 'Completed' : 'Draft';
}

export function createInitialDraftValues(form: InspectionFormResponse): DraftValues {
  const values: DraftValues = {};
  const storedItems = form.items ?? [];
  const storedByChecklistItemId = new Map(
    storedItems
      .filter((item) => item.checklistItemId)
      .map((item) => [item.checklistItemId, item]),
  );
  const storedByLabel = new Map(
    storedItems.map((item) => [normalizeLabelKey(item.label), item]),
  );

  for (const section of form.template.sections) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);
      const storedItem =
        storedByChecklistItemId.get(item.id) ?? storedByLabel.get(normalizeLabelKey(item.label));

      if (inputType === 'BOOLEAN') {
        if (typeof item.value?.valueBoolean === 'boolean') {
          values[item.id] = item.value.valueBoolean;
          continue;
        }

        if (storedItem?.result === 'PASS') {
          values[item.id] = true;
          continue;
        }

        if (storedItem?.result === 'FAIL') {
          values[item.id] = false;
          continue;
        }

        values[item.id] = null;
        continue;
      }

      if (inputType === 'NUMBER' || inputType === 'OCR') {
        values[item.id] =
          item.value?.valueNumber === null || item.value?.valueNumber === undefined
            ? // An OCR reading may hold a device sentinel ("LO" = below the
              // meter's range) in valueText — round-trip it on amend/reopen.
              item.value?.valueText ?? ''
            : String(item.value.valueNumber);
        continue;
      }

      if (inputType === 'READING') {
        values[item.id] =
          item.value?.valueNumber === null || item.value?.valueNumber === undefined
            ? item.value?.valueText ?? ''
            : String(item.value.valueNumber);
        continue;
      }

      if (inputType === 'SELECT') {
        values[item.id] = item.value?.valueText ?? '';
        continue;
      }

      if (inputType === 'MULTI_SELECT') {
        const picks = normalizeStoredMultiSelectValue(item.value?.valueJson);
        // Rehydrate a free-text "Other" answer (stored in valueText) as the
        // sentinel entry so amend/re-open shows it.
        const other =
          typeof item.value?.valueText === 'string' ? item.value.valueText.trim() : '';
        values[item.id] = other ? [...picks, `${OTHER_VALUE_PREFIX}${other}`] : picks;
        continue;
      }

      if (inputType === 'DATE') {
        values[item.id] = formatDateInputValue(item.value?.valueDate);
        continue;
      }

      if (inputType === 'DATETIME') {
        values[item.id] = formatDateTimeInputValue(item.value?.valueDateTime);
        continue;
      }

      if (inputType === 'GPS') {
        values[item.id] = item.value?.valueText ?? formatJsonValue(item.value?.valueJson);
        continue;
      }

      if (inputType === 'IMAGE') {
        values[item.id] = '';
        continue;
      }

      values[item.id] = item.value?.valueText ?? storedItem?.remark ?? '';
    }
  }

  return values;
}

export function getDraftValue(itemId: string, draftValues: DraftValues) {
  return draftValues[itemId];
}

/**
 * Per-field IMAGE config, read from `optionsJson.image` — the same block the
 * admin builder writes and the API persists (ChecklistImageConfig). Only the
 * two flags mobile acts on are surfaced (we are camera-only + always overlay, so
 * cameraOnly / galleryAllowed / timestampOverlayRequired need no runtime read).
 * Defaults preserve today's behaviour: a photo is required only when the flag is
 * explicitly set, and multiple photos stay allowed unless it is explicitly false
 * — so unconfigured fields behave exactly as before.
 */
export function readImageConfig(optionsJson: unknown): {
  requiredPhoto: boolean;
  allowMultiplePhotos: boolean;
} {
  const image =
    optionsJson &&
    typeof optionsJson === 'object' &&
    !Array.isArray(optionsJson) &&
    'image' in optionsJson &&
    optionsJson.image &&
    typeof optionsJson.image === 'object'
      ? (optionsJson.image as Record<string, unknown>)
      : null;

  return {
    requiredPhoto: image?.requiredPhoto === true,
    allowMultiplePhotos: image?.allowMultiplePhotos !== false,
  };
}

export function normalizeSelectOptions(optionsJson: unknown): SelectOption[] {
  const rawOptions = Array.isArray(optionsJson)
    ? optionsJson
    : optionsJson && typeof optionsJson === 'object' && !Array.isArray(optionsJson) && 'options' in optionsJson && Array.isArray(optionsJson.options)
      ? optionsJson.options
      : null;

  if (!rawOptions) {
    return [];
  }

  const options: SelectOption[] = [];

  for (const option of rawOptions) {
    if (typeof option === 'string') {
      const value = option.trim();

      if (value) {
        options.push({ label: value, value });
      }

      continue;
    }

    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      continue;
    }

    const label = 'label' in option && typeof option.label === 'string' ? option.label.trim() : '';
    const value = 'value' in option && typeof option.value === 'string' ? option.value.trim() : '';
    const prefix = 'prefix' in option && typeof option.prefix === 'string' ? option.prefix.trim() : '';
    const isDefect = 'isDefect' in option && option.isDefect === true;

    if (label && value) {
      const normalizedOption: SelectOption = { label, value };
      if (prefix) {
        normalizedOption.prefix = prefix;
      }
      if (isDefect) {
        normalizedOption.isDefect = true;
      }
      options.push(normalizedOption);
    }
  }

  return options;
}

/** Sentinel prefix marking the free-text "Other" entry inside a MULTI_SELECT
 *  draft value array. Device-side only — buildResultsPayload strips it, sending
 *  the typed text as valueText and the configured picks as valueJson. The
 *  unusual token avoids colliding with any configured option value. */
export const OTHER_VALUE_PREFIX = '__other__:';

/** Whether a MULTI_SELECT item opts into a free-text "Other" answer (the
 *  allowOther flag in its v2 optionsJson config). */
export function readMultiSelectAllowOther(optionsJson: unknown): boolean {
  return (
    !!optionsJson &&
    typeof optionsJson === 'object' &&
    !Array.isArray(optionsJson) &&
    (optionsJson as { allowOther?: unknown }).allowOther === true
  );
}

export function createInitialChecklistDraftValues(form: InspectionFormResponse): ChecklistDraftValues {
  const values: ChecklistDraftValues = {};
  const storedItems = form.items ?? [];
  const storedByChecklistItemId = new Map(
    storedItems
      .filter((item) => item.checklistItemId)
      .map((item) => [item.checklistItemId, item]),
  );
  const storedByLabel = new Map(
    storedItems.map((item) => [normalizeLabelKey(item.label), item]),
  );

  for (const section of form.template.sections) {
    for (const item of section.items) {
      const storedItem =
        storedByChecklistItemId.get(item.id) ?? storedByLabel.get(normalizeLabelKey(item.label));

      values[item.id] = {
        result: isInspectionItemResultValue(storedItem?.result) ? storedItem.result : null,
        remark: storedItem?.remark ?? '',
      };
    }
  }

  return values;
}

export function validateChecklistDraft(
  form: InspectionFormResponse,
  draftValues: ChecklistDraftValues,
) {
  const missingItems: string[] = [];

  for (const section of form.template.sections) {
    for (const item of section.items) {
      const draftValue = draftValues[item.id];

      if (!isInspectionItemResultValue(draftValue?.result)) {
        missingItems.push(item.label);
      }
    }
  }

  if (missingItems.length === 0) {
    return null;
  }

  return `Please select PASS, FAIL, or NA for: ${missingItems.join(', ')}`;
}

export function buildChecklistItemsPayload(
  form: InspectionFormResponse,
  draftValues: ChecklistDraftValues,
) {
  const items: SaveInspectionItemResultInput[] = [];

  for (const section of form.template.sections) {
    for (const item of section.items) {
      const draftValue = draftValues[item.id];

      if (!isInspectionItemResultValue(draftValue?.result)) {
        continue;
      }

      const remark = normalizeOperationalText(draftValue.remark).trim();

      items.push({
        checklistItemId: item.id,
        label: item.label,
        result: draftValue.result,
        remark: remark || null,
      });
    }
  }

  return items;
}

function isInspectionItemResultValue(value: unknown): value is InspectionItemResultValue {
  return value === 'PASS' || value === 'FAIL' || value === 'NA';
}

function normalizeLabelKey(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStoredMultiSelectValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function formatDateInputValue(value: unknown) {
  if (!value) {
    return '';
  }

  const text = String(value);

  return text.includes('T') ? text.slice(0, 10) : text;
}

function formatDateTimeInputValue(value: unknown) {
  if (!value) {
    return '';
  }

  const text = String(value);

  return text.endsWith('Z') ? text.slice(0, 16) : text;
}

function formatJsonValue(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export function getVisibleInspectionSections(
  form: InspectionFormResponse,
  draftValues: DraftValues,
): InspectionTemplateSection[] {
  return form.template.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isInspectionItemVisible(form, draftValues, item)),
    }))
    .filter((section) => section.items.length > 0);
}

function isInspectionItemVisible(
  form: InspectionFormResponse,
  draftValues: DraftValues,
  item: InspectionTemplateItem,
) {
  const showIf = readShowIfConfig(item.optionsJson);

  if (!showIf) {
    return true;
  }

  const dependency = findDependencyItem(form, showIf.dependsOn);

  if (!dependency) {
    return true;
  }

  const rawValue = getDraftValue(dependency.id, draftValues);

  return evaluateShowIf(rawValue, showIf);
}

function findDependencyItem(form: InspectionFormResponse, dependsOn: string) {
  const normalizedDependsOn = normalizeLabelKey(dependsOn);

  for (const section of form.template.sections) {
    for (const item of section.items) {
      if (
        normalizeLabelKey(item.key) === normalizedDependsOn ||
        normalizeLabelKey(item.label) === normalizedDependsOn
      ) {
        return item;
      }
    }
  }

  return null;
}

type ShowIfOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'greater_than'
  | 'less_than'
  | 'is_empty'
  | 'is_not_empty';

type ShowIfConfig = {
  dependsOn: string;
  operator: ShowIfOperator;
  value: string;
};

function readShowIfConfig(optionsJson: unknown): ShowIfConfig | null {
  if (!optionsJson || typeof optionsJson !== 'object' || Array.isArray(optionsJson)) {
    return null;
  }

  const config = optionsJson as {
    version?: unknown;
    showIf?: {
      dependsOn?: unknown;
      operator?: unknown;
      value?: unknown;
    };
  };

  if (config.version !== 2 || !config.showIf) {
    return null;
  }

  const dependsOn = typeof config.showIf.dependsOn === 'string' ? config.showIf.dependsOn.trim() : '';
  const operator = typeof config.showIf.operator === 'string' ? config.showIf.operator : '';

  if (!dependsOn || !isShowIfOperator(operator)) {
    return null;
  }

  return {
    dependsOn,
    operator,
    value: typeof config.showIf.value === 'string' ? config.showIf.value.trim() : '',
  };
}

function isShowIfOperator(value: string): value is ShowIfOperator {
  return [
    'equals',
    'not_equals',
    'contains',
    'greater_than',
    'less_than',
    'is_empty',
    'is_not_empty',
  ].includes(value);
}

function evaluateShowIf(
  rawValue: DraftValues[string],
  showIf: NonNullable<ReturnType<typeof readShowIfConfig>>,
) {
  const isEmpty = isDraftValueEmpty(rawValue);
  const actualText = normalizeComparableText(rawValue);
  const expectedText = showIf.value.trim().toLowerCase();

  if (showIf.operator === 'is_empty') {
    return isEmpty;
  }

  if (showIf.operator === 'is_not_empty') {
    return !isEmpty;
  }

  if (showIf.operator === 'equals') {
    return comparableTextCandidates(rawValue).includes(expectedText);
  }

  if (showIf.operator === 'not_equals') {
    return !comparableTextCandidates(rawValue).includes(expectedText);
  }

  if (showIf.operator === 'contains') {
    return actualText.includes(expectedText);
  }

  const actualNumber = Number(actualText);
  const expectedNumber = Number(expectedText);

  if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) {
    return false;
  }

  return showIf.operator === 'greater_than'
    ? actualNumber > expectedNumber
    : actualNumber < expectedNumber;
}

function isDraftValueEmpty(value: DraftValues[string]) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'boolean') {
    return false;
  }

  return value === null || value.trim() === '';
}

function normalizeComparableText(value: DraftValues[string]) {
  if (Array.isArray(value)) {
    return value.join(',').toLowerCase();
  }

  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }

  return (value ?? '').trim().toLowerCase();
}

function comparableTextCandidates(value: DraftValues[string]) {
  if (typeof value === 'boolean') {
    return value ? ['yes', 'true', 'pass'] : ['no', 'false', 'fail'];
  }

  return [normalizeComparableText(value)];
}

// Collect the required-item and invalid-number issues for one set of (already
// visibility-filtered) items. Shared by the whole-form validator and the
// per-group validator so both enforce identical rules.
function collectSectionIssues(
  items: InspectionTemplateItem[],
  draftValues: DraftValues,
  // Item ids that have at least one captured photo. IMAGE fields store their
  // value as photos (tagged with templateItemId), not in draftValues, so the
  // caller passes the set so required IMAGE items can be validated.
  photoItemIds: Set<string>,
) {
  const missingRequired: string[] = [];
  const invalidNumbers: string[] = [];

  for (const item of items) {
    const inputType = normalizeInspectionInputType(item.inputType);
    const rawValue = getDraftValue(item.id, draftValues);

    if (item.isRequired) {
      if (inputType === 'BOOLEAN') {
        if (typeof rawValue !== 'boolean') {
          missingRequired.push(item.label);
          continue;
        }
      }

      if (inputType === 'NUMBER' || inputType === 'READING' || inputType === 'OCR') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

        if (!normalized) {
          missingRequired.push(item.label);
          continue;
        }
      }

      if (
        inputType === 'TEXT' ||
        inputType === 'SELECT' ||
        inputType === 'DATE' ||
        inputType === 'DATETIME' ||
        inputType === 'GPS'
      ) {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

        if (!normalized) {
          missingRequired.push(item.label);
          continue;
        }
      }

      if (inputType === 'MULTI_SELECT' && (!Array.isArray(rawValue) || rawValue.length === 0)) {
        missingRequired.push(item.label);
        continue;
      }
    }

    // IMAGE fields store their answer as photos (tagged by templateItemId), not
    // in draftValues. A photo is required when the field is required OR its
    // per-field `requiredPhoto` flag is set (optionsJson.image) — the flag is
    // honoured independently of the generic isRequired.
    if (inputType === 'IMAGE') {
      const requiresPhoto =
        item.isRequired || readImageConfig(item.optionsJson).requiredPhoto;
      if (requiresPhoto && !photoItemIds.has(item.id)) {
        missingRequired.push(item.label);
      }
      continue;
    }

    // Only strict NUMBER fields must parse. Reading fields (OCR/READING)
    // accept text by design — device sentinels ("LO" = below measurable
    // range) and, per the owner's 2026-07-29 call, any note the technician
    // must record when a number can't be produced. The payload/API store
    // text readings as valueText.
    if (inputType !== 'NUMBER') {
      continue;
    }

    const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (!normalized) {
      continue;
    }

    if (!Number.isFinite(Number(normalized))) {
      invalidNumbers.push(item.label);
    }
  }

  return { missingRequired, invalidNumbers };
}

function issuesToMessage(missingRequired: string[], invalidNumbers: string[]) {
  if (missingRequired.length > 0) {
    return `Please complete required items: ${missingRequired.join(', ')}`;
  }

  if (invalidNumbers.length > 0) {
    return `Please enter a valid number for: ${invalidNumbers.join(', ')}`;
  }

  return null;
}

export function validateInspectionDraft(
  form: InspectionFormResponse,
  draftValues: DraftValues,
  photoItemIds: Set<string> = new Set(),
) {
  const missingRequiredItems: string[] = [];
  const invalidNumbers: string[] = [];

  for (const section of getVisibleInspectionSections(form, draftValues)) {
    const issues = collectSectionIssues(section.items, draftValues, photoItemIds);
    missingRequiredItems.push(...issues.missingRequired);
    invalidNumbers.push(...issues.invalidNumbers);
  }

  return issuesToMessage(missingRequiredItems, invalidNumbers);
}

/**
 * Validate a single group's (already visibility-filtered) items. Used by the
 * per-group "Mark group done" action so each group is held to the same required
 * and valid-number rules the final submit enforces.
 */
export function validateInspectionSectionItems(
  items: InspectionTemplateItem[],
  draftValues: DraftValues,
  photoItemIds: Set<string> = new Set(),
) {
  const { missingRequired, invalidNumbers } = collectSectionIssues(
    items,
    draftValues,
    photoItemIds,
  );

  return issuesToMessage(missingRequired, invalidNumbers);
}

/** Whether an item carries any answer — drives a group card's progress chip. */
export function isInspectionItemAnswered(
  item: InspectionTemplateItem,
  draftValues: DraftValues,
  photoItemIds: Set<string> = new Set(),
) {
  if (normalizeInspectionInputType(item.inputType) === 'IMAGE') {
    return photoItemIds.has(item.id);
  }

  return !isDraftValueEmpty(getDraftValue(item.id, draftValues));
}

export function countAnsweredInspectionItems(
  items: InspectionTemplateItem[],
  draftValues: DraftValues,
  photoItemIds: Set<string> = new Set(),
) {
  return items.filter((item) => isInspectionItemAnswered(item, draftValues, photoItemIds)).length;
}

export function validateInspectionDraftForSave(
  form: InspectionFormResponse,
  draftValues: DraftValues,
) {
  const invalidNumbers: string[] = [];

  for (const section of getVisibleInspectionSections(form, draftValues)) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);

      // Reading fields (OCR/READING) accept text — see collectSectionIssues.
      if (inputType !== 'NUMBER') {
        continue;
      }

      const rawValue = getDraftValue(item.id, draftValues);
      const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

      if (normalized && !Number.isFinite(Number(normalized))) {
        invalidNumbers.push(item.label);
      }
    }
  }

  if (invalidNumbers.length === 0) {
    return null;
  }

  return `Please enter a valid number for: ${invalidNumbers.join(', ')}`;
}

/**
 * Parse a numeric field value, returning null for blank OR unparseable input.
 * `Number('LO')` is NaN, which JSON-serialises to null and silently discards the
 * reading — this makes that explicit instead.
 */
function parseFiniteNumber(normalized: string): number | null {
  if (normalized === '') {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildResultsPayload(form: InspectionFormResponse, draftValues: DraftValues) {
  const supportedResults: SaveInspectionResultItemInput[] = [];
  const unsupportedLabels: string[] = [];

  for (const section of getVisibleInspectionSections(form, draftValues)) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);
      const rawValue = getDraftValue(item.id, draftValues);

      if (inputType === 'TEXT') {
        const normalized =
          typeof rawValue === 'string'
            ? (isOperationalTemplateTextItem(item)
                ? normalizeOperationalText(rawValue)
                : rawValue
              ).trim()
            : '';

        supportedResults.push({
          templateItemId: item.id,
          valueText: normalized === '' ? null : normalized,
        });
        continue;
      }

      if (inputType === 'OCR') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

        // A numeric reading rides as a number. Anything else rides as TEXT:
        // the Smart Sensor's "LO" sentinel (below measurable range — a hazard,
        // not a missing reading; normalized via shared-utils) and any note the
        // technician records when a number can't be produced. Uppercased for
        // consistency with the office edit path.
        const sentinel = normalizeReadingSentinel(normalized);

        if (sentinel) {
          supportedResults.push({ templateItemId: item.id, valueText: sentinel });
          continue;
        }

        const numeric = parseFiniteNumber(normalized);

        supportedResults.push(
          numeric !== null || normalized === ''
            ? { templateItemId: item.id, valueNumber: numeric }
            : { templateItemId: item.id, valueText: normalized.toUpperCase() },
        );
        continue;
      }

      if (inputType === 'NUMBER') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueNumber: parseFiniteNumber(normalized),
        });
        continue;
      }

      if (inputType === 'READING') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

        // Same handling as OCR: numeric → number, sentinel/text → valueText.
        const sentinel = normalizeReadingSentinel(normalized);

        if (sentinel) {
          supportedResults.push({ templateItemId: item.id, valueText: sentinel });
          continue;
        }

        const numeric = parseFiniteNumber(normalized);

        supportedResults.push(
          numeric !== null || normalized === ''
            ? { templateItemId: item.id, valueNumber: numeric }
            : { templateItemId: item.id, valueText: normalized.toUpperCase() },
        );
        continue;
      }

      if (inputType === 'BOOLEAN') {
        supportedResults.push({
          templateItemId: item.id,
          valueBoolean: typeof rawValue === 'boolean' ? rawValue : null,
        });
        continue;
      }

      if (inputType === 'SELECT') {
        const normalized = typeof rawValue === 'string' ? rawValue : '';
        supportedResults.push({
          templateItemId: item.id,
          valueText: normalized === '' ? null : normalized,
        });
        continue;
      }

      if (inputType === 'MULTI_SELECT') {
        const entries = Array.isArray(rawValue) ? rawValue : [];
        const picks = entries.filter(
          (entry): entry is string =>
            typeof entry === 'string' && !entry.startsWith(OTHER_VALUE_PREFIX),
        );
        const otherEntry = entries.find(
          (entry): entry is string =>
            typeof entry === 'string' && entry.startsWith(OTHER_VALUE_PREFIX),
        );
        const otherText = otherEntry ? otherEntry.slice(OTHER_VALUE_PREFIX.length).trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueJson: picks.length > 0 ? picks : null,
          valueText: otherText ? otherText : null,
        });
        continue;
      }

      if (inputType === 'DATE') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueDate: normalized === '' ? null : normalized,
        });
        continue;
      }

      if (inputType === 'DATETIME') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueDateTime: normalized === '' ? null : normalized,
        });
        continue;
      }

      if (inputType === 'GPS') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueText: normalized === '' ? null : normalized,
        });
        continue;
      }

      if (inputType === 'IMAGE') {
        supportedResults.push({
          templateItemId: item.id,
          valueJson: null,
        });
        continue;
      }

      unsupportedLabels.push(item.label);
    }
  }

  return { supportedResults, unsupportedLabels };
}

export function buildChecklistItemsPayloadFromDraft(
  form: InspectionFormResponse,
  draftValues: DraftValues,
  options: {
    includeEmpty?: boolean;
    emergencyByItemId?: Record<string, boolean>;
  } = {},
) {
  const items: SaveInspectionItemResultInput[] = [];
  const sections = options.includeEmpty
    ? form.template.sections
    : getVisibleInspectionSections(form, draftValues);

  for (const section of sections) {
    for (const item of section.items) {
      if (!normalizeInspectionInputType(item.inputType)) {
        continue;
      }

      const rawValue = getDraftValue(item.id, draftValues);

      if (!options.includeEmpty && !hasInspectionDraftValue(item, rawValue)) {
        continue;
      }

      const remark = getInspectionDraftDisplayValue(item, rawValue);

      items.push({
        checklistItemId: item.id,
        label: item.label,
        result: getInspectionItemResultValue(item, rawValue),
        remark,
        isEmergency: options.emergencyByItemId?.[item.id] ?? false,
      });
    }
  }

  return items;
}

/**
 * Seed the per-item emergency map from a loaded form so re-opening a saved
 * draft restores the inspector's emergency flags (and a later save doesn't
 * silently clear them). Keyed by checklist template item id.
 */
export function createInitialEmergencyMap(
  form: InspectionFormResponse,
): Record<string, boolean> {
  const emergencyByItemId: Record<string, boolean> = {};

  for (const storedItem of form.items ?? []) {
    if (storedItem.isEmergency && storedItem.checklistItemId) {
      emergencyByItemId[storedItem.checklistItemId] = true;
    }
  }

  return emergencyByItemId;
}

export function hasAnyInspectionDraftValue(
  form: InspectionFormResponse,
  draftValues: DraftValues,
) {
  for (const section of getVisibleInspectionSections(form, draftValues)) {
    for (const item of section.items) {
      if (hasInspectionDraftValue(item, getDraftValue(item.id, draftValues))) {
        return true;
      }
    }
  }

  return false;
}

export function getInspectionDraftDisplayValue(
  item: InspectionTemplateItem,
  rawValue: DraftValues[string],
) {
  const inputType = normalizeInspectionInputType(item.inputType);

  if (inputType === 'BOOLEAN') {
    if (rawValue === true) {
      return 'Yes';
    }

    if (rawValue === false) {
      return 'No';
    }

    return null;
  }

  if (inputType === 'SELECT') {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return null;
    }

    return getSelectOptionLabel(item, rawValue) ?? rawValue.trim();
  }

  if (inputType === 'MULTI_SELECT') {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
      return null;
    }

    // Render the "Other" sentinel as its plain typed text (no internal token
    // leaks into the remark/report); configured picks render as their labels.
    const parts = rawValue
      .map((value) =>
        value.startsWith(OTHER_VALUE_PREFIX)
          ? value.slice(OTHER_VALUE_PREFIX.length).trim()
          : getSelectOptionLabel(item, value) ?? value,
      )
      .filter((part) => part.length > 0);

    return parts.length > 0 ? parts.join(', ') : null;
  }

  if (inputType === 'IMAGE') {
    return null;
  }

  if (typeof rawValue !== 'string') {
    return null;
  }

  const normalized = (isOperationalTemplateTextItem(item)
    ? normalizeOperationalText(rawValue)
    : rawValue
  ).trim();

  return normalized || null;
}

export function hasInspectionDraftValue(
  item: InspectionTemplateItem,
  rawValue: DraftValues[string],
) {
  const inputType = normalizeInspectionInputType(item.inputType);

  if (inputType === 'BOOLEAN') {
    return typeof rawValue === 'boolean';
  }

  if (
    inputType === 'TEXT' ||
    inputType === 'NUMBER' ||
    inputType === 'SELECT' ||
    inputType === 'DATE' ||
    inputType === 'DATETIME' ||
    inputType === 'GPS' ||
    inputType === 'READING' ||
    inputType === 'OCR'
  ) {
    return typeof rawValue === 'string' && rawValue.trim() !== '';
  }

  if (inputType === 'MULTI_SELECT') {
    return Array.isArray(rawValue) && rawValue.length > 0;
  }

  return false;
}

export function normalizeInspectionInputType(inputType: string) {
  const normalizedInputType = inputType.trim().toUpperCase();

  if (normalizedInputType === 'YES_NO') {
    return 'BOOLEAN';
  }

  if (normalizedInputType === 'DROPDOWN') {
    return 'SELECT';
  }

  if (normalizedInputType === 'DATE_TIME') {
    return 'DATETIME';
  }

  if (normalizedInputType === 'READING_MEASUREMENT' || normalizedInputType === 'MEASUREMENT') {
    return 'READING';
  }

  if (
    normalizedInputType === 'TEXT' ||
    normalizedInputType === 'NUMBER' ||
    normalizedInputType === 'BOOLEAN' ||
    normalizedInputType === 'SELECT' ||
    normalizedInputType === 'MULTI_SELECT' ||
    normalizedInputType === 'IMAGE' ||
    normalizedInputType === 'DATE' ||
    normalizedInputType === 'DATETIME' ||
    normalizedInputType === 'GPS' ||
    normalizedInputType === 'READING' ||
    normalizedInputType === 'OCR'
  ) {
    return normalizedInputType;
  }

  return null;
}

export function getAssetInspections(visit: SiteVisit, assetId: string) {
  const inspections = visit.inspections ?? [];

  return inspections
    .filter((inspection) => inspection.assetId === assetId)
    .slice()
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);

      return rightTime - leftTime;
    });
}

export function getDefaultOperationalQueueInspections(
  visit: SiteVisit,
  assetId?: string,
) {
  const inspections = assetId
    ? getAssetInspections(visit, assetId)
    : (visit.inspections ?? []);

  return inspections.filter((inspection) =>
    canShowInInspectionMobileQueue(inspection.completionStatus),
  );
}

export function getLatestSubmittedInspection(visit: SiteVisit, assetId: string) {
  return getAssetInspections(visit, assetId).find(
    (inspection) => inspection.completionStatus === 'SUBMITTED',
  );
}

export function getNextInspectionCycle(visit: SiteVisit, assetId: string) {
  const latestSubmittedInspection = getLatestSubmittedInspection(visit, assetId);

  // Mobile hides abandoned drafts from technicians, so visible cycle numbers
  // should continue from the last completed inspection.
  return latestSubmittedInspection ? latestSubmittedInspection.inspectionCycle + 1 : 1;
}

export function getInspectionStatusTone(
  inspection: InspectionSummary | undefined,
): 'neutral' | 'success' | 'warning' {
  if (!inspection) {
    return 'neutral';
  }

  return getInspectionQueueStatusGroup(inspection.completionStatus) === 'COMPLETED'
    ? 'success'
    : 'warning';
}

export function findItemById(
  sections: InspectionTemplateSection[],
  itemId: string,
): InspectionTemplateItem | undefined {
  for (const section of sections) {
    const item = section.items.find((entry) => entry.id === itemId);

    if (item) {
      return item;
    }
  }

  return undefined;
}

/**
 * For a defect-trigger BOOLEAN item, returns which answer means "a defect exists".
 * ASCURE SAVR checklists ask whether the defect is present (e.g. "TIANG - CONDONG"
 * → YES = defect), so YES (true) is the defect by default. An optional
 * `optionsJson.defectWhen` value ('TRUE' | 'FALSE', or a boolean) overrides it for
 * any positively-phrased item without requiring a schema change.
 */
export function getBooleanDefectValue(item: InspectionTemplateItem): boolean {
  const optionsJson = item.optionsJson;

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

export function getInspectionItemResultValue(
  item: InspectionTemplateItem,
  rawValue: DraftValues[string],
): InspectionItemResultValue {
  const inputType = normalizeInspectionInputType(item.inputType);

  if (inputType === 'BOOLEAN') {
    if (rawValue !== true && rawValue !== false) {
      return 'NA';
    }

    // Defect-trigger booleans follow the ASCURE SAVR rule: the inspector states
    // whether the defect exists, so the "defect" answer maps to FAIL (which the
    // API turns into isDefect=true → one Defect). Non-defect-trigger booleans keep
    // the legacy pass/fail mapping (YES = PASS, NO = FAIL).
    if (item.isDefectTrigger !== false) {
      return rawValue === getBooleanDefectValue(item) ? 'FAIL' : 'PASS';
    }

    return rawValue === true ? 'PASS' : 'FAIL';
  }

  if (inputType === 'SELECT') {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return 'NA';
    }

    return inferSelectInspectionResult(item, rawValue);
  }

  if (inputType === 'MULTI_SELECT') {
    const entries = Array.isArray(rawValue) ? rawValue : [];
    // The free-text "Other" entry (sentinel) is recorded only — it NEVER drives
    // PASS/FAIL, so typed Other text can't raise a defect (v1). Only configured
    // picks are inferred; an Other-only answer still counts as answered (PASS).
    const picks = entries.filter((entry) => !entry.startsWith(OTHER_VALUE_PREFIX));
    const hasOther = entries.some((entry) => entry.startsWith(OTHER_VALUE_PREFIX));

    if (picks.length === 0) {
      return hasOther ? 'PASS' : 'NA';
    }

    return picks.some((value) => inferSelectInspectionResult(item, value) === 'FAIL')
      ? 'FAIL'
      : 'PASS';
  }

  if (inputType === 'IMAGE') {
    return 'NA';
  }

  return hasInspectionDraftValue(item, rawValue) ? 'PASS' : 'NA';
}

// Best-effort defect keywords used ONLY when a template item has no option
// explicitly flagged as a defect (see inferSelectInspectionResult). Covers both
// English and Bahasa Malaysia / utility-field vocabulary so legacy templates
// authored before per-option defect flags still surface defects in the field.
const INSPECTION_DEFECT_KEYWORD_TOKENS = new Set<string>([
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

function inferSelectInspectionResult(
  item: InspectionTemplateItem,
  selectedValue: string,
): InspectionItemResultValue {
  const options = normalizeSelectOptions(item.optionsJson);
  const selectedOption = options.find((option) => option.value === selectedValue);

  // 1) Explicit, admin-configured defect marker is authoritative and
  //    language-independent — it always wins over keyword inference.
  if (selectedOption?.isDefect) {
    return 'FAIL';
  }

  const normalizedSelection = [selectedValue, selectedOption?.label ?? '']
    .join(' ')
    .toLowerCase();

  // N/A is about applicability, not pass/fail — honour it regardless of config.
  if (isNotApplicableSelection(normalizedSelection)) {
    return 'NA';
  }

  // 2) If the item has ANY explicitly flagged option, trust that configuration
  //    fully: an unflagged selection is a PASS (no keyword guessing, which could
  //    otherwise produce false positives against an intentional setup).
  if (options.some((option) => option.isDefect)) {
    return 'PASS';
  }

  // 3) Legacy / unconfigured templates: best-effort EN + Malay keyword inference.
  const tokens = normalizedSelection.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some((token) => INSPECTION_DEFECT_KEYWORD_TOKENS.has(token))) {
    return 'FAIL';
  }

  return 'PASS';
}

function getSelectOptionLabel(item: InspectionTemplateItem, selectedValue: string) {
  const selectedOption = normalizeSelectOptions(item.optionsJson).find(
    (option) => option.value === selectedValue,
  );

  return selectedOption?.label;
}
