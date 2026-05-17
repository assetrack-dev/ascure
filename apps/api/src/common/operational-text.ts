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
