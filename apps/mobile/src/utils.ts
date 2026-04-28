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

export function formatInspectionStatus(status: 'DRAFT' | 'SUBMITTED') {
  return status === 'SUBMITTED' ? 'Completed' : 'Draft';
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

      const remark = draftValue.remark.trim();

      items.push({
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
      const rawValue = getDraftValue(item.id, draftValues);

      if (
        item.isRequired &&
        item.inputType !== 'TEXT' &&
        item.inputType !== 'BOOLEAN' &&
        item.inputType !== 'NUMBER' &&
        item.inputType !== 'SELECT'
      ) {
        unsupportedRequiredItems.push(item.label);
        continue;
      }

      if (item.isRequired) {
        if (item.inputType === 'BOOLEAN') {
          if (typeof rawValue !== 'boolean') {
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (item.inputType === 'NUMBER') {
          const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

          if (!normalized) {
            missingRequiredItems.push(item.label);
            continue;
          }
        }

        if (item.inputType === 'TEXT' || item.inputType === 'SELECT') {
          const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';

          if (!normalized) {
            missingRequiredItems.push(item.label);
            continue;
          }
        }
      }

      if (item.inputType !== 'NUMBER') {
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
