/**
 * Smart Sensor device sentinels — tokens the meter's LCD shows INSTEAD of a
 * number.
 *
 * `LO` means the target sits below the meter's minimum measurable distance
 * (cable ground clearance under ~3 m). That is a HAZARD, not a missing reading,
 * so it must be captured and recorded rather than silently dropped.
 *
 * Storage contract (shared by mobile + API): a sentinel is written to
 * `InspectionResult.valueText` with `valueNumber` left null. Every downstream
 * reader — the Excel checklist export, the DOCX visual report, and the admin
 * "Linked Assets" table — already prefers `valueText` over `valueNumber`, so the
 * sentinel surfaces everywhere without further changes.
 */
export const READING_SENTINEL_LO = 'LO';

/** Accepted sentinels. The API rejects any other text on a reading field. */
export const READING_SENTINELS = [READING_SENTINEL_LO] as const;

export type ReadingSentinel = (typeof READING_SENTINELS)[number];

/**
 * Normalize a raw value to a known sentinel, tolerating case, surrounding
 * whitespace, and the dashes the LCD draws around it ("-LO-").
 *
 * Also tolerates the seven-segment OCR confusion `L0` (letter-L + zero) for
 * `LO` — unambiguous, because a sentinel always carries a letter prefix while a
 * misread reading (e.g. "10") never does.
 *
 * Returns null when the value is not a sentinel (a number, blank, or free text).
 */
export function normalizeReadingSentinel(
  value: string | null | undefined,
): ReadingSentinel | null {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value.trim().replace(/^[-\s]+|[-\s]+$/g, '').toUpperCase();

  if (/^L[O0]$/.test(token)) {
    return READING_SENTINEL_LO;
  }

  return null;
}

/** True when a reading field holds a device sentinel rather than a number. */
export function isReadingSentinel(value: string | null | undefined): boolean {
  return normalizeReadingSentinel(value) !== null;
}
