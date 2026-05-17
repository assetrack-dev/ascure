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

      if (inputType === 'SELECT') {
        values[item.id] = item.value?.valueText ?? '';
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
  if (!Array.isArray(optionsJson)) {
    return [];
  }

  const options: SelectOption[] = [];

  for (const option of optionsJson) {
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

    if (label && value) {
      options.push({ label, value });
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

export function validateInspectionDraft(form: InspectionFormResponse, draftValues: DraftValues) {
  const missingRequiredItems: string[] = [];
  const invalidNumbers: string[] = [];
  const unsupportedRequiredItems: string[] = [];

  for (const section of form.template.sections) {
    for (const item of section.items) {
      const inputType = normalizeInspectionInputType(item.inputType);
      const rawValue = getDraftValue(item.id, draftValues);

      if (
        item.isRequired &&
        inputType !== 'TEXT' &&
        inputType !== 'BOOLEAN' &&
        inputType !== 'NUMBER' &&
        inputType !== 'SELECT'
      ) {
        unsupportedRequiredItems.push(item.label);
        continue;
      }

      if (item.isRequired) {
        if (inputType === 'BOOLEAN') {
          if (typeof rawValue !== 'boolean') {
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (inputType === 'NUMBER') {
          const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

          if (!normalized) {
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (inputType === 'TEXT' || inputType === 'SELECT') {
          const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

          if (!normalized) {
            missingRequiredItems.push(item.label);
            continue;
          }
        }
      }

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
  }

  if (unsupportedRequiredItems.length > 0) {
    return `This inspection contains unsupported required items: ${unsupportedRequiredItems.join(', ')}`;
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

  for (const section of form.template.sections) {
    for (const item of section.items) {
      if (normalizeInspectionInputType(item.inputType) !== 'NUMBER') {
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

  for (const section of form.template.sections) {
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

  for (const section of form.template.sections) {
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
  for (const section of form.template.sections) {
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

  if (inputType === 'TEXT' || inputType === 'NUMBER' || inputType === 'SELECT') {
    return typeof rawValue === 'string' && rawValue.trim() !== '';
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

  if (
    normalizedInputType === 'TEXT' ||
    normalizedInputType === 'NUMBER' ||
    normalizedInputType === 'BOOLEAN' ||
    normalizedInputType === 'SELECT'
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

  return inspection.completionStatus === 'SUBMITTED' ? 'success' : 'warning';
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
