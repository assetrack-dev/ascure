/**
 * Pure helpers for the Google Sheet repair-date sync
 * (docs/PLAN-google-sheet-repair-sync.md): reading the QR03 layout, mapping a
 * checklist item to its "Tarikh Pembaikan" group, and matching rows to poles.
 */

/** The 16 date groups of TNB's QR03 (Kuantan SZC1 layout). */
export type SheetGroupId =
  | 'TIANG'
  | 'PEMBUMIAN'
  | 'NOMBOR_TIANG'
  | 'SAMBUNGAN'
  | 'TALIAN'
  | 'RENTIS'
  | 'UMBANG'
  | 'IPC'
  | 'AKSESORI'
  | 'BLACK_BOX'
  | 'PENANGKAP_KILAT'
  | 'SERVIS'
  | 'PAPAN_TANDA'
  | 'SESALUR'
  | 'LAMPU_JALAN'
  | 'LAIN_LAIN';

/** Letters + digits only, upper-case: "Sambungan UG-OH/Jumper" → "SAMBUNGANUGOHJUMPER". */
export const compact = (value: unknown) =>
  String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

// Order matters: NOMBORTIANG before TIANG. JUMPER items sit under Sambungan.
const GROUP_PREFIXES: Array<[string, SheetGroupId]> = [
  ['NOMBORTIANG', 'NOMBOR_TIANG'],
  ['TIANG', 'TIANG'],
  ['PEMBUMIAN', 'PEMBUMIAN'],
  ['SAMBUNGAN', 'SAMBUNGAN'],
  ['JUMPER', 'SAMBUNGAN'],
  ['TALIAN', 'TALIAN'],
  ['RENTIS', 'RENTIS'],
  ['UMBANG', 'UMBANG'],
  ['IPC', 'IPC'],
  ['AKSESORI', 'AKSESORI'],
  ['BLACKBOX', 'BLACK_BOX'],
  ['PENANGKAPKILAT', 'PENANGKAP_KILAT'],
  ['SERVIS', 'SERVIS'],
  ['PAPANTANDA', 'PAPAN_TANDA'],
  ['SESALUR', 'SESALUR'],
  ['LAMPUJALAN', 'LAMPU_JALAN'],
  ['LAINLAIN', 'LAIN_LAIN'],
];

const groupFromPrefix = (text: string): SheetGroupId | null => {
  const key = compact(text);
  if (!key) return null;
  return GROUP_PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1] ?? null;
};

/** A sheet group heading ("Tiang", "Papan Tanda - OFF Point / …") → its id. */
export const sheetGroupId = (heading: string) => groupFromPrefix(heading);

/**
 * A checklist item ("Umbang - Kendur / Putus", section "Umbang") → the QR03
 * group whose date it fills. Mirrors run_kuantan.py's QR03 COL_MAP, which
 * files these under a group other than their label prefix:
 *   • "Tiang - No. Tiang Pudar / Tiada" → Nombor Tiang
 *   • any Ulan (Creepers) / Perlu Rentis → Rentis
 */
export const groupForItem = (label: string, sectionTitle?: string | null): SheetGroupId | null => {
  const key = compact(label);
  if (key.includes('NOTIANGPUDAR') || key.includes('NOMBORTIANG')) return 'NOMBOR_TIANG';
  if (/\bULAN\b/i.test(label) || key.includes('PERLURENTIS')) return 'RENTIS';
  const prefix = label.includes(' - ') ? label.split(' - ')[0] : '';
  return groupFromPrefix(prefix) ?? groupFromPrefix(sectionTitle ?? '') ?? (prefix ? null : groupFromPrefix(label));
};

/** Pole numbers compare without spaces: "FP1 B 15/1" = "FP1 B15/1". "/" and "&" stay. */
export const poleKey = (value: unknown) => String(value ?? '').toUpperCase().replace(/\s+/g, '');

export type SheetLayout = {
  headerRow: number; // 0-based
  flCol: number;
  nameCol: number;
  poleCol: number;
  coordCol: number;
  groups: Array<{ id: SheetGroupId; heading: string; dateCol: number }>;
  unknownGroups: string[];
};

const findCol = (row: string[], pattern: RegExp) => row.findIndex((cell) => pattern.test(cell ?? ''));

/**
 * Finds the QR03 header row (the one holding "Lokasi Kejanggalan" and the
 * "Tarikh Pembaikan" columns) and every date column's group, by TEXT — a
 * column inserted later doesn't break the sync. The group heading is on the
 * row above, at the group's first column (merged cells), so walk left.
 */
export const parseLayout = (values: string[][]): SheetLayout => {
  const headerRow = values.findIndex(
    (row) => findCol(row, /Lokasi Kejanggalan/i) >= 0 && findCol(row, /Tarikh Pembaikan/i) >= 0,
  );
  if (headerRow < 1) {
    throw new Error('No QR03 header row (with "Lokasi Kejanggalan" and "Tarikh Pembaikan") found.');
  }
  const header = values[headerRow];
  const headings = values[headerRow - 1] ?? [];
  const required = {
    flCol: findCol(header, /^\s*FL Pencawang/i),
    nameCol: findCol(header, /Nama Pencawang/i),
    poleCol: findCol(header, /Lokasi Kejanggalan/i),
    coordCol: findCol(header, /COORDINATE TIANG/i),
  };
  const missing = Object.entries(required).filter(([, col]) => col < 0);
  if (missing.length) {
    throw new Error(`QR03 columns not found: ${missing.map(([name]) => name).join(', ')}.`);
  }

  const groups: SheetLayout['groups'] = [];
  const unknownGroups: string[] = [];
  header.forEach((cell, col) => {
    if (!/Tarikh Pembaikan/i.test(cell ?? '')) return;
    let start = col - 1;
    while (start >= 0 && !(headings[start] ?? '').trim()) start -= 1;
    const heading = (headings[start] ?? '').trim();
    const id = sheetGroupId(heading);
    if (id && !groups.some((group) => group.id === id)) groups.push({ id, heading, dateCol: col });
    else unknownGroups.push(heading || `column ${col + 1}`);
  });
  return { headerRow, ...required, groups, unknownGroups };
};

/** "4.03752, 103.394947" → {lat, lng}; null when unreadable. */
export const parseCoordinate = (value: unknown) => {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(value ?? ''));
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};

export const distanceMetres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};

const MYT_OFFSET_MS = 8 * 3600 * 1000;

/** A moment → its Malaysia calendar date as "dd/mm/yyyy" + the Sheets date serial. */
export const malaysiaDate = (at: Date) => {
  const local = new Date(at.getTime() + MYT_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    text: `${pad(d)}/${pad(m + 1)}/${y}`,
    serial: Date.UTC(y, m, d) / 86_400_000 + 25_569,
  };
};

/**
 * A cell's displayed value, made comparable with malaysiaDate().text: "5/10/2026"
 * → "05/10/2026". TNB's typed dates DISPLAY as dd/mm (whatever the stored
 * value), so the displayed text is what the sync compares.
 */
export const normaliseCellDate = (value: unknown) => {
  const text = String(value ?? '').trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  return match ? `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}` : text;
};
