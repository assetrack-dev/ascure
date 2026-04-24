import { InspectionItemInputType } from '@prisma/client';

export const TEMPLATE_BUILDER_INPUT_TYPES = [
  InspectionItemInputType.TEXT,
  InspectionItemInputType.BOOLEAN,
  InspectionItemInputType.NUMBER,
  InspectionItemInputType.DATE,
  InspectionItemInputType.DATETIME,
  InspectionItemInputType.SELECT,
] as const;

export type TemplateBuilderInputType = (typeof TEMPLATE_BUILDER_INPUT_TYPES)[number];

export interface TemplateSelectOption {
  label: string;
  value: string;
}

export function isTemplateBuilderInputType(
  inputType: InspectionItemInputType,
): inputType is TemplateBuilderInputType {
  return TEMPLATE_BUILDER_INPUT_TYPES.includes(inputType as TemplateBuilderInputType);
}

export function normalizeTemplateSelectOptions(optionsJson: unknown): TemplateSelectOption[] | null {
  if (!Array.isArray(optionsJson) || optionsJson.length === 0) {
    return null;
  }

  const normalizedOptions: TemplateSelectOption[] = [];
  const seenValues = new Set<string>();

  for (const option of optionsJson) {
    if (typeof option === 'string') {
      const trimmedValue = option.trim();

      if (!trimmedValue || seenValues.has(trimmedValue)) {
        return null;
      }

      normalizedOptions.push({
        label: trimmedValue,
        value: trimmedValue,
      });
      seenValues.add(trimmedValue);
      continue;
    }

    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      return null;
    }

    const maybeLabel = 'label' in option ? option.label : undefined;
    const maybeValue = 'value' in option ? option.value : undefined;
    const label = typeof maybeLabel === 'string' ? maybeLabel.trim() : '';
    const value = typeof maybeValue === 'string' ? maybeValue.trim() : '';

    if (!label || !value || seenValues.has(value)) {
      return null;
    }

    normalizedOptions.push({ label, value });
    seenValues.add(value);
  }

  return normalizedOptions;
}
