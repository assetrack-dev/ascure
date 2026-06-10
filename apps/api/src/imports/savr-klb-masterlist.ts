/**
 * SAVR KLB AppSheet masterlist parser + column map (pure, no DB).
 *
 * Maps the AppSheet `RAW` sheet to ASCURE shapes per docs/F2-appsheet-importer-spec.md.
 * Match is by NORMALISED header text (not column letter), with an explicit
 * header→key map — so spelling/spacing quirks (e.g. "PENGEBUMIAN" → pembumian_*,
 * "UMBANG -Terbang /Support Pole") are handled deterministically.
 */
import { Workbook } from 'exceljs';

export type ItemType = 'BOOLEAN' | 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT';

export interface CellNote {
  column: string;
  code: string;
  message: string;
}

export interface ParsedValue {
  key: string;
  type: ItemType;
  value: string | number | boolean | string[] | null;
}

export interface ParsedRow {
  rowNumber: number;
  uniqueId: string | null;
  inspectorEmail: string | null;
  mainheadText: string | null;
  teamText: string | null;
  functionalLocation: string | null;
  latitude: number | null;
  longitude: number | null;
  pencawangName: string | null;
  pencawangCode: string | null;
  assetCode: string | null;
  noTiangLama: string | null;
  inspectedAt: Date | null;
  /** Items 1–24 (M–AJ): present === true => FAIL (defect). */
  defects: { key: string; present: boolean }[];
  /** Items 25–48 (AK–BJ): typed capture values. */
  values: ParsedValue[];
  warnings: CellNote[];
  errors: CellNote[];
}

export interface ParseResult {
  rows: ParsedRow[];
  structuralErrors: CellNote[];
  matchedColumns: number;
  unmappedHeaders: string[];
}

// --- Column map (raw human headers; normalised at match time) ---------------

const META = {
  uniqueId: 'UNIQUEID',
  inspectorEmail: 'USER EMAIL',
  mainheadText: 'MAINHEAD',
  teamText: 'TEAM',
  functionalLocation: 'FUNCTIONAL LOCATION',
  location: 'LOCATION',
  pencawangName: 'NAMA PENCAWANG',
  pencawangCode: 'KOD PENCAWANG',
  assetCode: 'No Tiang RONDAAN',
  noTiangLama: 'No Tiang LAMA',
  date: 'DATE',
  dateTime: 'DATE / TIME',
} as const;

const REQUIRED_META_HEADERS: string[] = [META.pencawangCode, META.assetCode];

// Items 1–24 (defect booleans, truthy marker '1'), in column order M→AJ.
export const DEFECT_ITEMS: { header: string; key: string }[] = [
  { header: 'TIANG - Reput/Retak', key: 'tiang_reput_retak' },
  { header: 'TIANG - Condong', key: 'tiang_condong' },
  { header: 'TIANG - Nombor Pudar', key: 'tiang_nombor_pudar' },
  { header: 'PENGALIR - Mid-Span Joint', key: 'pengalir_mid_span_joint' },
  { header: 'PENGALIR - Kawasan Perlu Rentis', key: 'pengalir_kawasan_perlu_rentis' },
  { header: 'PENGALIR - Rendah', key: 'pengalir_rendah' },
  { header: 'UMBANG - Kendur', key: 'umbang_kendur' },
  { header: 'UMBANG - Ulan (Creepers)', key: 'umbang_ulan_creepers' },
  { header: 'UMBANG - Tiada Stay Insulator /Rosak', key: 'umbang_tiada_stay_insulator_rosak' },
  { header: 'UMBANG - Terbongkar', key: 'umbang_terbongkar' },
  { header: 'IPC - Kesan Bakar', key: 'ipc_kesan_bakar' },
  { header: 'IPC - Tidak cukup', key: 'ipc_tidak_cukup' },
  { header: 'BLACKBOX - Kesan Bakar', key: 'blackbox_kesan_bakar' },
  { header: 'JUMPER - Tiada Uv Sleeve', key: 'jumper_tiada_uv_sleeve' },
  { header: 'JUMPER - Kesan Bakar', key: 'jumper_kesan_bakar' },
  { header: 'PENANGKAP KILAT - Rosak', key: 'penangkap_kilat_rosak' },
  { header: 'SERVICE - TALIAN Berada Atas Bumbung/Tidak Selamat', key: 'service_talian_berada_atas_bumbung_tidak_selamat' },
  { header: 'SERVICE - Wonpiece Tanggal', key: 'service_wonpiece_tanggal' },
  { header: 'PENGEBUMIAN - Kejanggalan', key: 'pembumian_kejanggalan' },
  { header: 'NOP - Papan Tanda TIADA /Pudar', key: 'nop_papan_tanda_tiada_pudar' },
  { header: 'SESALUR KAKI LIMA - Wayar Tanggal', key: 'sesalur_kaki_lima_wayar_tanggal' },
  { header: 'SESALUR KAKI LIMA - Dalam rumah/renovation', key: 'sesalur_kaki_lima_dalam_rumah_renovation' },
  { header: 'SESALUR KAKI LIMA - JUNCTION BOX/IPC', key: 'sesalur_kaki_lima_junction_box_ipc' },
  { header: 'SESALUR KAKI LIMA - Junction Box Tanggal /Kesan Bakar', key: 'sesalur_kaki_lima_junction_box_tanggal_kesan_bakar' },
];

type DataItemSpec = { key: string; type: ItemType; headers: string[]; marker?: '/' };

// Items 25–48 (data capture). saiz_tiang is a 3-column one-hot → single SELECT.
export const DATA_ITEMS: DataItemSpec[] = [
  { key: 'saiz_tiang', type: 'SELECT', headers: ['7.5 Meter', '9 Meter', '10 Meter'] },
  { key: 'jenis_tiang', type: 'SELECT', headers: ['JENIS TIANG'] },
  { key: 'cable_185_nmp', type: 'NUMBER', headers: ['Cable 185 Nmp'] },
  { key: 'cable_95_nmp', type: 'NUMBER', headers: ['Cable 95 Nmp'] },
  { key: 'cable_3x16_nmp', type: 'NUMBER', headers: ['Cable 3 X 16 Nmp'] },
  { key: 'cable_1x16_nmp', type: 'NUMBER', headers: ['Cable 1 X 16 Nmp'] },
  { key: 'cable_pvc_9064_4_cable', type: 'NUMBER', headers: ['Cable Pvc (9064) / 4 Cable'] },
  { key: 'cable_pvc_7083_2_cable_1_cable', type: 'NUMBER', headers: ['Cable Pvc (7083) /2 Cable /1 Cable'] },
  { key: 'cable_pvc_7044', type: 'NUMBER', headers: ['Cable Pvc (7044)'] },
  { key: 'bare_7173', type: 'NUMBER', headers: ['Bare (7173)'] },
  { key: 'bare_7122', type: 'NUMBER', headers: ['Bare (7122)'] },
  { key: 'jumlah_umbang', type: 'NUMBER', headers: ['JUMLAH UMBANG'] },
  { key: 'jumlah_blackbox', type: 'MULTI_SELECT', headers: ['JUMLAH BLACKBOX'] },
  { key: 'lvpt', type: 'NUMBER', headers: ['LVPT'] },
  { key: 'jumlah_service', type: 'NUMBER', headers: ['JUMLAH SERVICE'] },
  { key: 'umbang_terbang_support_pole', type: 'TEXT', headers: ['UMBANG -Terbang /Support Pole'] },
  { key: 'catatan_cable', type: 'TEXT', headers: ['CATATAN CABLE'] },
  { key: 'keadaan_di_tapak_jalanraya', type: 'BOOLEAN', headers: ['KEADAAN DI TAPAK Jalanraya'], marker: '/' },
  { key: 'keadaan_di_tapak_bahu_jalan', type: 'BOOLEAN', headers: ['KEADAAN DI TAPAK Bahu Jalan'], marker: '/' },
  { key: 'keadaan_di_tapak_kawasan_tidak_dimasuki_kenderaan', type: 'BOOLEAN', headers: ['KEADAAN DI TAPAK Kawasan tidak dimasuki kenderaan'], marker: '/' },
  { key: 'kawasan_bendang', type: 'BOOLEAN', headers: ['KAWASAN Bendang'], marker: '/' },
  { key: 'kawasan_crossing_jalan', type: 'BOOLEAN', headers: ['KAWASAN Crossing jalan'], marker: '/' },
  { key: 'kawasan_hutan', type: 'BOOLEAN', headers: ['KAWASAN Hutan'], marker: '/' },
  { key: 'kawasan_lain_lain_sila_nyatakan', type: 'TEXT', headers: ['KAWASAN Lain-lain (sila nyatakan)'] },
];

export const ALL_TEMPLATE_KEYS: string[] = [
  ...DEFECT_ITEMS.map((d) => d.key),
  ...DATA_ITEMS.map((d) => d.key),
];

// --- helpers ---------------------------------------------------------------

function normHeader(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (v instanceof Date) return v.toISOString();
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result);
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText.map((t: { text?: string }) => t.text ?? '').join('');
    }
    return '';
  }
  return String(value);
}

function excelToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial: days since 1899-12-30 (UTC).
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  const text = String(value).trim();
  const asNumber = Number(text);
  if (!Number.isNaN(asNumber) && text !== '') {
    return new Date(Date.UTC(1899, 11, 30) + asNumber * 86400000);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

export function buildExternalRef(uniqueId: string): string {
  return `appsheet:savr-klb:${uniqueId}`;
}

// --- parser ----------------------------------------------------------------

export async function parseMasterlist(buffer: Buffer): Promise<ParseResult> {
  const structuralErrors: CellNote[] = [];
  const workbook = new Workbook();
  try {
    // @types/node Buffer generic vs exceljs's Buffer typing — runtime is a Node Buffer.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch (err) {
    return {
      rows: [],
      structuralErrors: [{ column: '-', code: 'PARSE_FAILED', message: `Unable to read workbook: ${err instanceof Error ? err.message : String(err)}` }],
      matchedColumns: 0,
      unmappedHeaders: [],
    };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], structuralErrors: [{ column: '-', code: 'NO_SHEET', message: 'Workbook has no worksheet.' }], matchedColumns: 0, unmappedHeaders: [] };
  }

  // header (normalised) -> { index, letter }
  const headerMap = new Map<string, { index: number; letter: string }>();
  const headerRow = sheet.getRow(1);
  const usedHeaders = new Set<string>();
  for (let c = 1; c <= sheet.columnCount; c++) {
    const raw = cellText(headerRow.getCell(c).value).trim();
    if (!raw) continue;
    const norm = normHeader(raw);
    usedHeaders.add(norm);
    if (!headerMap.has(norm)) headerMap.set(norm, { index: c, letter: sheet.getColumn(c).letter });
  }

  const locate = (rawHeader: string) => headerMap.get(normHeader(rawHeader)) ?? null;
  const matchedNorms = new Set<string>();
  const requireHeader = (rawHeader: string, required: boolean): { index: number; letter: string } | null => {
    const found = locate(rawHeader);
    if (found) {
      matchedNorms.add(normHeader(rawHeader));
      return found;
    }
    structuralErrors.push({
      column: '-',
      code: required ? 'MISSING_REQUIRED_COLUMN' : 'MISSING_COLUMN',
      message: `${required ? 'Required ' : ''}column "${rawHeader}" not found in the sheet header.`,
    });
    return null;
  };

  // Resolve metadata columns
  const metaCols: Record<keyof typeof META, { index: number; letter: string } | null> = {} as never;
  (Object.keys(META) as (keyof typeof META)[]).forEach((field) => {
    metaCols[field] = requireHeader(META[field], REQUIRED_META_HEADERS.includes(META[field]));
  });

  // Resolve defect + data columns (all required for a complete import)
  const defectCols = DEFECT_ITEMS.map((d) => ({ ...d, col: requireHeader(d.header, true) }));
  const dataCols = DATA_ITEMS.map((d) => ({ ...d, cols: d.headers.map((h) => requireHeader(h, true)) }));

  for (const norm of usedHeaders) if (!matchedNorms.has(norm)) { /* unmapped, reported below */ }
  const unmappedHeaders = [...usedHeaders].filter((n) => !matchedNorms.has(n));

  // If a required key column is missing, abort before reading rows.
  if (structuralErrors.some((e) => e.code === 'MISSING_REQUIRED_COLUMN')) {
    return { rows: [], structuralErrors, matchedColumns: matchedNorms.size, unmappedHeaders };
  }

  const rows: ParsedRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const excelRow = sheet.getRow(r);
    const get = (loc: { index: number } | null) => (loc ? cellText(excelRow.getCell(loc.index).value).trim() : '');
    const rawAt = (loc: { index: number } | null) => (loc ? excelRow.getCell(loc.index).value : null);

    const pencawangCode = get(metaCols.pencawangCode) || null;
    const assetCode = get(metaCols.assetCode) || null;
    const uniqueId = get(metaCols.uniqueId) || null;

    // Skip fully-empty trailing rows.
    if (!pencawangCode && !assetCode && !uniqueId && !get(metaCols.inspectorEmail)) continue;

    const warnings: CellNote[] = [];
    const errors: CellNote[] = [];

    if (!pencawangCode) errors.push({ column: metaCols.pencawangCode?.letter ?? 'H', code: 'REQUIRED', message: 'KOD PENCAWANG is required.' });
    if (!assetCode) errors.push({ column: metaCols.assetCode?.letter ?? 'I', code: 'REQUIRED', message: 'No Tiang RONDAAN (asset code) is required.' });

    // GPS
    let latitude: number | null = null;
    let longitude: number | null = null;
    const loc = get(metaCols.location);
    if (loc) {
      const parts = loc.split(',').map((p) => Number(p.trim()));
      if (parts.length === 2 && parts.every((n) => !Number.isNaN(n)) && Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
        [latitude, longitude] = parts;
      } else {
        warnings.push({ column: metaCols.location?.letter ?? 'F', code: 'BAD_GPS', message: `Could not parse LOCATION "${loc}".` });
      }
    }

    const inspectedAt = excelToDate(rawAt(metaCols.date)) ?? excelToDate(rawAt(metaCols.dateTime));
    if (!inspectedAt && (rawAt(metaCols.date) || rawAt(metaCols.dateTime))) {
      warnings.push({ column: metaCols.date?.letter ?? 'K', code: 'BAD_DATE', message: 'Could not parse DATE; will fall back to import time.' });
    }

    // Defects (M–AJ): truthy '1'
    const defects = defectCols.map(({ key, col }) => {
      const text = get(col);
      const present = text !== '';
      if (present && text !== '1') {
        warnings.push({ column: col?.letter ?? '?', code: 'TRUTHY_MARKER', message: `${key}: expected "1", got "${text}" (treated as present).` });
      }
      return { key, present };
    });

    // Data (AK–BJ)
    const values: ParsedValue[] = dataCols.map((spec): ParsedValue => {
      if (spec.key === 'saiz_tiang') {
        const set = spec.headers
          .map((h, i) => ({ label: h, on: get(spec.cols[i]) !== '' }))
          .filter((x) => x.on);
        if (set.length === 1) return { key: spec.key, type: 'SELECT', value: set[0].label };
        if (set.length === 0) return { key: spec.key, type: 'SELECT', value: null };
        warnings.push({ column: spec.cols[0]?.letter ?? '?', code: 'ONE_HOT', message: `saiz_tiang has ${set.length} columns set; using "${set[0].label}".` });
        return { key: spec.key, type: 'SELECT', value: set[0].label };
      }

      const text = get(spec.cols[0]);
      if (spec.type === 'BOOLEAN') {
        const present = text !== '';
        if (present && spec.marker && text !== spec.marker) {
          warnings.push({ column: spec.cols[0]?.letter ?? '?', code: 'TRUTHY_MARKER', message: `${spec.key}: expected "${spec.marker}", got "${text}".` });
        }
        return { key: spec.key, type: 'BOOLEAN', value: present };
      }
      if (spec.type === 'NUMBER') {
        if (text === '') return { key: spec.key, type: 'NUMBER', value: null };
        const n = Number(text);
        if (Number.isNaN(n)) {
          warnings.push({ column: spec.cols[0]?.letter ?? '?', code: 'NOT_NUMERIC', message: `${spec.key}: "${text}" is not numeric.` });
          return { key: spec.key, type: 'NUMBER', value: null };
        }
        return { key: spec.key, type: 'NUMBER', value: n };
      }
      if (spec.type === 'MULTI_SELECT') {
        return { key: spec.key, type: 'MULTI_SELECT', value: text === '' ? null : [text] };
      }
      if (spec.type === 'SELECT') {
        return { key: spec.key, type: 'SELECT', value: text === '' ? null : text };
      }
      // TEXT — drop a bare slash tick (used inconsistently on BJ)
      const cleaned = text === '/' ? '' : text;
      return { key: spec.key, type: 'TEXT', value: cleaned === '' ? null : cleaned };
    });

    rows.push({
      rowNumber: r,
      uniqueId,
      inspectorEmail: get(metaCols.inspectorEmail) || null,
      mainheadText: get(metaCols.mainheadText) || null,
      teamText: get(metaCols.teamText) || null,
      functionalLocation: get(metaCols.functionalLocation) || null,
      latitude,
      longitude,
      pencawangName: get(metaCols.pencawangName) || null,
      pencawangCode,
      assetCode,
      noTiangLama: get(metaCols.noTiangLama) || null,
      inspectedAt,
      defects,
      values,
      warnings,
      errors,
    });
  }

  return { rows, structuralErrors, matchedColumns: matchedNorms.size, unmappedHeaders };
}
