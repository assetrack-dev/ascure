/**
 * SAVR KLB masterlist EXPORT — the inverse of the F2 importer
 * ([[../imports/savr-klb-masterlist.ts]]). Emits the same wide layout AppSheet
 * produced (metadata columns + one column per checklist item, 1 pole = 1 row),
 * so the file round-trips back through the importer. Pure: takes shaped rows,
 * returns an .xlsx buffer.
 */
import { Workbook } from 'exceljs';
import {
  DATA_ITEMS,
  DEFECT_ITEMS,
  META,
} from '../imports/savr-klb-masterlist';

/** Metadata column headers in column order (mirrors the importer's META). */
const META_HEADERS: string[] = [
  META.uniqueId,
  META.inspectorEmail,
  META.mainheadText,
  META.teamText,
  META.functionalLocation,
  META.location,
  META.pencawangName,
  META.pencawangCode,
  META.assetCode,
  META.noTiangLama,
  META.date,
  META.dateTime,
];

/** A recorded data value, kept as the importer's stored shape (one per column key). */
export interface MasterlistRawValue {
  text: string | null;
  number: number | null;
  bool: boolean | null;
  json: unknown;
}

export interface MasterlistRow {
  uniqueId: string;
  userEmail: string;
  mainhead: string;
  team: string;
  functionalLocation: string;
  location: string;
  pencawangName: string;
  pencawangCode: string;
  assetCode: string;
  noTiangLama: string;
  date: Date | null;
  dateTime: Date | null;
  /** Template-item keys whose result is a defect (FAIL) for this pole. */
  defectKeys: Set<string>;
  /** Data-item key → recorded value. */
  valuesByKey: Map<string, MasterlistRawValue>;
}

type Cell = string | number | Date | null;

/** Reverse one data item's stored value into its cell(s), per the column spec. */
function dataCells(
  spec: (typeof DATA_ITEMS)[number],
  raw: MasterlistRawValue | undefined,
): Cell[] {
  // saiz_tiang: a single SELECT one-hot encoded across 3 columns.
  if (spec.key === 'saiz_tiang') {
    const selected = raw?.text ?? null;
    return spec.headers.map((h) => (selected && h === selected ? 1 : null));
  }

  if (!raw) {
    return spec.headers.map(() => null);
  }

  switch (spec.type) {
    case 'NUMBER':
      return [raw.number ?? null];
    case 'BOOLEAN':
      // marker '/' for the keadaan/kawasan ticks, '1' otherwise.
      return [raw.bool ? spec.marker ?? '1' : null];
    case 'MULTI_SELECT':
      return [Array.isArray(raw.json) ? (raw.json as string[]).join(', ') : raw.text ?? null];
    case 'SELECT':
    case 'TEXT':
    default:
      return [raw.text ?? null];
  }
}

export async function buildMasterlistWorkbook(
  rows: MasterlistRow[],
): Promise<Buffer> {
  const workbook = new Workbook();
  workbook.creator = 'ASCURE';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('MASTERLIST');

  const dataHeaders = DATA_ITEMS.flatMap((d) => d.headers);
  sheet.addRow([
    ...META_HEADERS,
    ...DEFECT_ITEMS.map((d) => d.header),
    ...dataHeaders,
  ]);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const meta: Cell[] = [
      row.uniqueId,
      row.userEmail,
      row.mainhead,
      row.team,
      row.functionalLocation,
      row.location,
      row.pencawangName,
      row.pencawangCode,
      row.assetCode,
      row.noTiangLama,
      row.date,
      row.dateTime,
    ];
    const defects: Cell[] = DEFECT_ITEMS.map((d) =>
      row.defectKeys.has(d.key) ? 1 : null,
    );
    const data: Cell[] = DATA_ITEMS.flatMap((spec) =>
      dataCells(spec, row.valuesByKey.get(spec.key)),
    );
    sheet.addRow([...meta, ...defects, ...data]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

/** `[NAMA PENCAWANG]_MASTERLIST.xlsx`, every non-alphanumeric run → `_`. */
export function buildMasterlistFilename(pencawang: string): string {
  const safe =
    (pencawang || 'PENCAWANG')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'PENCAWANG';
  return `${safe}_MASTERLIST.xlsx`;
}
