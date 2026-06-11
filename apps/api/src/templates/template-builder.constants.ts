import { InspectionItemInputType } from '@prisma/client';

export const TEMPLATE_BUILDER_INPUT_TYPES = [
  InspectionItemInputType.TEXT,
  InspectionItemInputType.BOOLEAN,
  InspectionItemInputType.NUMBER,
  InspectionItemInputType.DATE,
  InspectionItemInputType.DATETIME,
  InspectionItemInputType.SELECT,
  InspectionItemInputType.MULTI_SELECT,
  InspectionItemInputType.IMAGE,
  InspectionItemInputType.GPS,
  InspectionItemInputType.READING,
  InspectionItemInputType.OCR,
] as const;

export type TemplateBuilderInputType = (typeof TEMPLATE_BUILDER_INPUT_TYPES)[number];

export interface TemplateSelectOption {
  label: string;
  value: string;
  prefix?: string;
  /**
   * When true, selecting this option marks the checklist answer as a defect
   * (result = FAIL) regardless of the option's wording. This is the
   * language-independent, explicit signal that replaces keyword guessing for
   * non-English (e.g. Bahasa Malaysia) and utility-specific option labels.
   */
  isDefect?: boolean;
}

export function isTemplateBuilderInputType(
  inputType: InspectionItemInputType,
): inputType is TemplateBuilderInputType {
  return TEMPLATE_BUILDER_INPUT_TYPES.includes(inputType as TemplateBuilderInputType);
}

export function normalizeTemplateSelectOptions(optionsJson: unknown): TemplateSelectOption[] | null {
  const rawOptions = readOptionsArray(optionsJson);

  if (!rawOptions || rawOptions.length === 0) {
    return null;
  }

  const normalizedOptions: TemplateSelectOption[] = [];
  const seenValues = new Set<string>();

  for (const option of rawOptions) {
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
    const maybePrefix = 'prefix' in option ? option.prefix : undefined;
    const maybeIsDefect = 'isDefect' in option ? option.isDefect : undefined;
    const label = typeof maybeLabel === 'string' ? maybeLabel.trim() : '';
    const value = typeof maybeValue === 'string' ? maybeValue.trim() : '';
    const prefix = typeof maybePrefix === 'string' ? maybePrefix.trim() : '';
    const isDefect = maybeIsDefect === true;

    if (!label || !value || seenValues.has(value)) {
      return null;
    }

    const normalizedOption: TemplateSelectOption = { label, value };
    if (prefix) {
      normalizedOption.prefix = prefix;
    }
    if (isDefect) {
      normalizedOption.isDefect = true;
    }

    normalizedOptions.push(normalizedOption);
    seenValues.add(value);
  }

  return normalizedOptions;
}

function readOptionsArray(optionsJson: unknown) {
  if (Array.isArray(optionsJson)) {
    return optionsJson;
  }

  if (!optionsJson || typeof optionsJson !== 'object' || Array.isArray(optionsJson)) {
    return null;
  }

  const options = 'options' in optionsJson ? optionsJson.options : undefined;

  return Array.isArray(options) ? options : null;
}
