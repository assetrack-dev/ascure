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

      if (inputType === 'NUMBER') {
        values[item.id] =
          item.value?.valueNumber === null || item.value?.valueNumber === undefined
            ? ''
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
        values[item.id] = normalizeStoredMultiSelectValue(item.value?.valueJson);
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

    if (label && value) {
      options.push(prefix ? { label, value, prefix } : { label, value });
    }
  }

  return options;
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

export function validateInspectionDraft(form: InspectionFormResponse, draftValues: DraftValues) {
  const missingRequiredItems: string[] = [];
  const invalidNumbers: string[] = [];

  for (const section of getVisibleInspectionSections(form, draftValues)) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);
      const rawValue = getDraftValue(item.id, draftValues);

      if (item.isRequired) {
        if (inputType === 'BOOLEAN') {
          if (typeof rawValue !== 'boolean') {
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (inputType === 'NUMBER' || inputType === 'READING') {
          const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

          if (!normalized) {
            missingRequiredItems.push(item.label);
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
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (inputType === 'MULTI_SELECT' && (!Array.isArray(rawValue) || rawValue.length === 0)) {
          missingRequiredItems.push(item.label);
          continue;
        }
      }

      if (inputType !== 'NUMBER' && inputType !== 'READING') {
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
  }

  if (missingRequiredItems.length > 0) {
    return `Please complete required items: ${missingRequiredItems.join(', ')}`;
  }

  if (invalidNumbers.length === 0) {
    return null;
  }

  return `Please enter a valid number for: ${invalidNumbers.join(', ')}`;
}

export function validateInspectionDraftForSave(
  form: InspectionFormResponse,
  draftValues: DraftValues,
) {
  const invalidNumbers: string[] = [];

  for (const section of getVisibleInspectionSections(form, draftValues)) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);

      if (inputType !== 'NUMBER' && inputType !== 'READING') {
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

      if (inputType === 'NUMBER') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueNumber: normalized === '' ? null : Number(normalized),
        });
        continue;
      }

      if (inputType === 'READING') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueNumber: normalized === '' ? null : Number(normalized),
        });
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
        supportedResults.push({
          templateItemId: item.id,
          valueJson: Array.isArray(rawValue) && rawValue.length > 0 ? rawValue : null,
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
  options: { includeEmpty?: boolean } = {},
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
      });
    }
  }

  return items;
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

    return rawValue
      .map((value) => getSelectOptionLabel(item, value) ?? value)
      .join(', ');
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
    inputType === 'READING'
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
    normalizedInputType === 'READING'
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

function getInspectionItemResultValue(
  item: InspectionTemplateItem,
  rawValue: DraftValues[string],
): InspectionItemResultValue {
  const inputType = normalizeInspectionInputType(item.inputType);

  if (inputType === 'BOOLEAN') {
    if (rawValue === true) {
      return 'PASS';
    }

    if (rawValue === false) {
      return 'FAIL';
    }

    return 'NA';
  }

  if (inputType === 'SELECT') {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      return 'NA';
    }

    return inferSelectInspectionResult(item, rawValue);
  }

  if (inputType === 'MULTI_SELECT') {
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
      return 'NA';
    }

    return rawValue.some((value) => inferSelectInspectionResult(item, value) === 'FAIL')
      ? 'FAIL'
      : 'PASS';
  }

  if (inputType === 'IMAGE') {
    return 'NA';
  }

  return hasInspectionDraftValue(item, rawValue) ? 'PASS' : 'NA';
}

function inferSelectInspectionResult(
  item: InspectionTemplateItem,
  selectedValue: string,
): InspectionItemResultValue {
  const selectedLabel = getSelectOptionLabel(item, selectedValue);
  const normalizedSelection = [selectedValue, selectedLabel ?? ''].join(' ').toLowerCase();
  const tokens = normalizedSelection
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  if (
    /\bn\/?a\b/.test(normalizedSelection) ||
    normalizedSelection.includes('not applicable') ||
    normalizedSelection.includes('not_applicable')
  ) {
    return 'NA';
  }

  if (
    tokens.some((token) =>
      [
        'no',
        'fail',
        'failed',
        'defect',
        'defective',
        'bad',
        'abnormal',
        'reject',
        'rejected',
        'unsatisfactory',
      ].includes(token),
    )
  ) {
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
