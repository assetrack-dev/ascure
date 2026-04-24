import {
  DraftValues,
  InspectionFormResponse,
  InspectionTemplateItem,
  InspectionTemplateSection,
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

export function createInitialDraftValues(form: InspectionFormResponse): DraftValues {
  const values: DraftValues = {};

  for (const section of form.template.sections) {
    for (const item of section.items) {
      if (item.inputType === 'BOOLEAN') {
        values[item.id] = item.value?.valueBoolean ?? null;
        continue;
      }

      if (item.inputType === 'NUMBER') {
        values[item.id] =
          item.value?.valueNumber === null || item.value?.valueNumber === undefined
            ? ''
            : String(item.value.valueNumber);
        continue;
      }

      if (item.inputType === 'SELECT') {
        values[item.id] = item.value?.valueText ?? '';
        continue;
      }

      values[item.id] = item.value?.valueText ?? '';
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

export function validateInspectionDraft(form: InspectionFormResponse, draftValues: DraftValues) {
  const invalidNumbers: string[] = [];

  for (const section of form.template.sections) {
    for (const item of section.items) {
      if (item.inputType !== 'NUMBER') {
        continue;
      }

      const rawValue = getDraftValue(item.id, draftValues);
      const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

      if (!normalized) {
        continue;
      }

      if (!Number.isFinite(Number(normalized))) {
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
      const rawValue = getDraftValue(item.id, draftValues);

      if (item.inputType === 'TEXT') {
        supportedResults.push({
          templateItemId: item.id,
          valueText: typeof rawValue === 'string' ? rawValue : '',
        });
        continue;
      }

      if (item.inputType === 'NUMBER') {
        const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
        supportedResults.push({
          templateItemId: item.id,
          valueNumber: normalized === '' ? null : Number(normalized),
        });
        continue;
      }

      if (item.inputType === 'BOOLEAN') {
        supportedResults.push({
          templateItemId: item.id,
          valueBoolean: typeof rawValue === 'boolean' ? rawValue : null,
        });
        continue;
      }

      if (item.inputType === 'SELECT') {
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

export function getLatestDraftInspection(visit: SiteVisit, assetId: string) {
  const inspections = visit.inspections ?? [];

  return inspections.find(
    (inspection) =>
      inspection.assetId === assetId && inspection.completionStatus === 'DRAFT',
  );
}

export function getNextInspectionCycle(visit: SiteVisit, assetId: string) {
  const inspections = visit.inspections ?? [];
  const highestCycle = inspections
    .filter((inspection) => inspection.assetId === assetId)
    .reduce((currentMax, inspection) => Math.max(currentMax, inspection.inspectionCycle), 0);

  return highestCycle + 1;
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
