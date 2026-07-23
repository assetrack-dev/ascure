import { InspectionItemInputType, Prisma } from '@prisma/client';
import { normalizeTemplateSelectOptions } from '../templates/template-builder.constants';

/**
 * Shared vocabulary for surfacing a checklist template's fields as data columns
 * — used by the Site Visit Linked-Assets table and the map's asset panel, which
 * must agree on the column key or a value recorded under one would not resolve
 * under the other.
 */

/** A checklist field surfaced as a column. `key` is the normalized (upper,
 *  single-spaced) label used to match recorded values; `label` is shown as-is;
 *  `section` is the template group. */
export type ChecklistColumnDef = {
  key: string;
  label: string;
  section: string | null;
  // The item's input type, so the client renders a type-aware editor
  // (number / boolean / date vs free text).
  inputType: InspectionItemInputType;
  // Dropdown options for the editor, matching the checklist template: SELECT items
  // expose their configured options; BOOLEAN gets a synthetic Yes/No; null = the
  // editor stays a free-text/number/date input.
  options: { label: string; value: string }[] | null;
  // Every template item id behind this column (>1 when several templates define
  // the same label). An IMAGE column resolves its photo through these.
  templateItemIds: string[];
};

/** A photo captured against a specific checklist item, as surfaced on an IMAGE
 *  column (same shape as the pinned Gambar Kelegaan cell). */
export type ChecklistImage = {
  url: string;
  filename: string;
  latitude: number | null;
  longitude: number | null;
  timestamp: string | null;
  createdAt: string;
};

/**
 * The canonical column key for a checklist label: uppercased and single-spaced.
 * `PATCH /inspections/:id/checklist-result` resolves the item to edit with the
 * same normalization, so a column key round-trips to exactly one template item.
 */
export function normalizeChecklistLabel(label: string): string {
  return label.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Dropdown options for a checklist column's inline editor, mirroring how the
 *  checklist template defines the item: a SELECT exposes its configured options
 *  (via the canonical template parser), a BOOLEAN gets a synthetic Yes/No, and
 *  every other type has none (edits as free text / number / date). */
export function checklistColumnOptions(
  inputType: InspectionItemInputType,
  optionsJson: Prisma.JsonValue | null,
): { label: string; value: string }[] | null {
  if (inputType === InspectionItemInputType.BOOLEAN) {
    return [
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ];
  }
  // SELECT and MULTI_SELECT both draw from the template's configured options.
  // MULTI_SELECT was omitted here, so its rows fell back to a free-text box with
  // no options at all — the editor could not offer what the crew picked from.
  if (
    inputType === InspectionItemInputType.SELECT ||
    inputType === InspectionItemInputType.MULTI_SELECT
  ) {
    const parsed = normalizeTemplateSelectOptions(optionsJson);
    return parsed ? parsed.map((o) => ({ label: o.label, value: o.value })) : null;
  }
  return null;
}

/** The typed columns an InspectionResult may carry a value in. */
export type ChecklistResultValueRow = {
  valueText: string | null;
  valueNumber: Prisma.Decimal | number | null;
  valueBoolean: boolean | null;
  valueDate: Date | null;
  valueDateTime: Date | null;
  /** MULTI_SELECT stores its picks here as a string array — nowhere else. */
  valueJson?: Prisma.JsonValue | null;
};

/**
 * The displayed value of a recorded checklist result, reading the typed columns
 * in the same priority the Download Checklist / Linked-Assets table use: text
 * first (readings like "LO" are stored as text), then number, boolean, date,
 * and finally the MULTI_SELECT picks.
 *
 * ⚠ `valueJson` MUST be read here. MULTI_SELECT writes its answer ONLY to
 * valueJson (see inspections.service coerce), so omitting it made every
 * multi-select item render BLANK everywhere this function feeds — the map's
 * asset panel and the Site Visit Linked-Assets table both.
 */
export function checklistResultValue(
  row: ChecklistResultValueRow | null | undefined,
): string | null {
  if (!row) {
    return null;
  }
  const text = row.valueText?.trim();
  const picks = readMultiSelectPicks(row.valueJson);
  if (picks) {
    // An item that allows "Other (free text)" keeps that answer in valueText
    // alongside the validated picks — show both rather than dropping one.
    return text ? `${picks}, ${text}` : picks;
  }
  if (text) {
    return text;
  }
  if (row.valueNumber != null) {
    return row.valueNumber.toString();
  }
  if (row.valueBoolean != null) {
    return row.valueBoolean ? 'Yes' : 'No';
  }
  if (row.valueDate != null) {
    return row.valueDate.toISOString().slice(0, 10);
  }
  if (row.valueDateTime != null) {
    return row.valueDateTime.toISOString();
  }
  return null;
}

/** MULTI_SELECT picks as a readable list, or null when there are none. */
function readMultiSelectPicks(value: Prisma.JsonValue | null | undefined): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const picks = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return picks.length > 0 ? picks.join(', ') : null;
}
