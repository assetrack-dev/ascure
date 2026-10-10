/**
 * Automatic "TIDAK PATUH GROUND CLEARANCE" (TNB feedback #3, 2026-10-10).
 *
 * A pure port of the QR AUTO rule (docs/qr_auto/Kuantan/run_kuantan.py:
 * `classify_slot`, `grade_pole` sentinels, §9 `generate_spans` +
 * `build_ground_clearance`, and the "every pole that is the receiving end of a
 * TAK PATUH span" reconcile), so ASCURE flags exactly the poles the QR AUTO
 * would — maintenance works straight from ASCURE, not from the generated report.
 *
 * Unit = one Pencawang's SAVR poles (the same rows the checklist export hands
 * the QR AUTO). Each span grades ONE slot of its receiving (TO) pole:
 *   BACAAN/GAMBAR KELEGAAN N  vs  the minimum for  KEADAAN DI TAPAK N.
 * A pole is TIDAK PATUH when any span it receives grades TAK PATUH.
 *
 * Only the span TARGETS are ported (which pole + slot each span lands on); the
 * QR's sort order only decides a branch's FROM pole, never what gets graded.
 */

export const GC_ITEM_LABEL = 'TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE';

/** Terrain → minimum clearance in metres, inclusive (≥ passes). */
export const TERRAIN_MIN: Record<string, number> = {
  'MELINTASI JALAN RAYA': 5.49,
  'BAHU JALAN': 5.18,
  'KAWASAN TIDAK DIMASUKI KENDERAAN': 4.57,
};

const READING_MAX = 20;
const READING_MIN = 0;
const BLANKS = new Set(['', 'NAN', 'NONE']);
/** Terminator poles produce no span (old QR `_BANNED`). */
const BANNED_SUFFIXES = ['/0', '/0A', '/0B', '/ 0'];
const FEEDER_PREFIX = /^((?:FP|TX|LV)\s*\d*)\s+/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

export type SlotStatus =
  | 'EMPTY'
  | 'TIADA BACAAN'
  | 'TIADA KAWASAN'
  | '#ERROR'
  | 'PATUH'
  | 'TAK PATUH'
  | 'UT'
  | 'P2P'
  | 'NO ACCESS'
  | 'END';

export interface SlotGrade {
  slot: number;
  status: SlotStatus;
  reading: string;
  terrain: string;
  detail: string | null;
}

export interface SlotInput {
  reading: string;
  terrain: string;
}

export interface GcPoleInput {
  /** Caller's id for the row (e.g. the inspection id). */
  key: string;
  /** NO TIANG RONDAAN (the asset code). */
  code: string;
  /** GAMBAR KELEGAAN 1–3 + KEADAAN DI TAPAK 1–3. */
  slots: SlotInput[];
  /** UMBANG - TERBANG / SUPPORT POLE answer. */
  umbang: string;
  /** CATITAN. */
  catatan: string;
}

export interface GcSpan {
  /** The receiving pole's code and the slot graded on it. */
  to: string;
  slot: number;
  grade: SlotGrade | null;
  /** Why the span was not graded (support pole, P2P/UG, no access). */
  skipped: string | null;
}

export interface GcPoleResult {
  key: string;
  code: string;
  /** Receives at least one TAK PATUH span → TIDAK PATUH GROUND CLEARANCE. */
  fail: boolean;
  spans: GcSpan[];
}

function isBlank(value: unknown): boolean {
  return BLANKS.has(String(value ?? '').trim().toUpperCase());
}

function normTerrain(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Grade one slot (QR `classify_slot`). */
export function classifySlot(readingRaw: unknown, terrainRaw: unknown, slot: number): SlotGrade {
  const r = String(readingRaw ?? '').trim();
  const t = String(terrainRaw ?? '').trim();
  const rBlank = isBlank(r);
  const tBlank = isBlank(t);
  const base = { slot, reading: rBlank ? '' : r, terrain: tBlank ? '' : t };

  if (rBlank && tBlank) return { ...base, status: 'EMPTY', detail: null };
  if (rBlank) {
    return { ...base, status: 'TIADA BACAAN', detail: `slot ${slot}: terrain '${t}' set but reading blank` };
  }

  let rv = r.toUpperCase();
  if (rv === 'LOW') rv = 'LO';
  if (rv === 'LO') {
    return { ...base, status: 'TAK PATUH', detail: `slot ${slot}: TAK PATUH (LO — low clearance marked)` };
  }
  if (rv === 'UT' || rv === 'P2P' || rv === 'NO ACCESS' || rv === 'END') {
    return { ...base, status: rv, detail: `slot ${slot}: ${rv} (from reading)` };
  }

  const val = rv.replace(/,/g, '.');
  if ((val.match(/\./g) ?? []).length > 1 || !NUMBER.test(val)) {
    return { ...base, status: '#ERROR', detail: `slot ${slot}: #ERROR — unparseable reading '${r}'` };
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num < READING_MIN || num > READING_MAX) {
    return { ...base, status: '#ERROR', detail: `slot ${slot}: #ERROR — reading ${r} out of range` };
  }

  if (tBlank) {
    return { ...base, status: 'TIADA KAWASAN', detail: `slot ${slot}: reading ${r} set but terrain blank` };
  }
  const min = TERRAIN_MIN[normTerrain(t)];
  if (min === undefined) {
    return { ...base, status: 'TIADA KAWASAN', detail: `slot ${slot}: unrecognized terrain '${t}'` };
  }
  return num >= min
    ? { ...base, status: 'PATUH', detail: `slot ${slot}: PATUH (${r} ≥ ${min} · ${normTerrain(t)})` }
    : { ...base, status: 'TAK PATUH', detail: `slot ${slot}: TAK PATUH (${r} < ${min} · ${normTerrain(t)})` };
}

/** Feeder letter(s) → pole number for one leg (QR `extract_feeder_data`). */
export function extractFeederData(part: string): Record<string, number> {
  const data: Record<string, number> = {};
  const clean = part.split('/')[0].trim();
  const fp = clean.match(FEEDER_PREFIX);
  const fpPrefix = fp ? `${fp[1].toUpperCase()} ` : '';
  const tempNoSpace = clean.slice(fpPrefix.length).replace(/ /g, '');
  const match = tempNoSpace.match(/^([A-Za-z]+)?(\d+)/);
  if (match) {
    const letters = match[1] ? match[1].toUpperCase() : 'MAIN';
    const num = Number.parseInt(match[2], 10);
    if (letters === 'MAIN') {
      data[`${fpPrefix}MAIN`.trim()] = num;
    } else {
      for (const char of letters) data[`${fpPrefix}${char}`.trim()] = num;
    }
  }
  return data;
}

function splitLegs(pole: string): string[] {
  return pole.split('&').map((leg) => leg.trim());
}

function resolveSubSlot(pole: string): number {
  const index = splitLegs(pole).findIndex((leg) => leg.includes('/'));
  return index >= 0 ? index + 1 : 1;
}

function resolveFeederSlot(pole: string, feeder: string): number {
  const index = splitLegs(pole).findIndex((leg) => feeder in extractFeederData(leg));
  return index >= 0 ? index + 1 : 1;
}

function isTerminator(pole: string): boolean {
  return BANNED_SUFFIXES.some((suffix) => pole.endsWith(suffix));
}

/**
 * Where every span lands (QR `generate_spans`, TO side only): a main pole's
 * span goes forward to the nearest main pole on a shared feeder (graded on the
 * leg carrying that feeder); a branch pole's span ends on itself (graded on its
 * '/'-leg). A feeder's first pole receives no span.
 */
export function generateSpanTargets(codes: string[]): Array<{ to: string; slot: number }> {
  const poles = codes.map((code) => code.trim());
  const allMain = new Map<string, Record<string, number>>();
  for (const pole of poles) {
    if (isTerminator(pole)) continue;
    const feeders: Record<string, number> = {};
    for (const part of pole.split('&')) {
      if (!part.includes('/')) Object.assign(feeders, extractFeederData(part.trim()));
    }
    if (Object.keys(feeders).length > 0) allMain.set(pole, feeders);
  }

  const targets: Array<{ to: string; slot: number }> = [];
  for (const pole of poles) {
    if (isTerminator(pole)) continue;
    if (pole.includes('/')) {
      targets.push({ to: pole, slot: resolveSubSlot(pole) });
      continue;
    }
    const current = allMain.get(pole) ?? {};
    const candidates: Array<{ pole: string; diff: number; feeder: string }> = [];
    for (const [feeder, number] of Object.entries(current)) {
      for (const [candidate, candidateFeeders] of allMain) {
        if (candidate === pole) continue;
        const candidateNumber = candidateFeeders[feeder];
        if (candidateNumber !== undefined && candidateNumber > number) {
          candidates.push({ pole: candidate, diff: candidateNumber - number, feeder });
        }
      }
    }
    if (candidates.length === 0) continue; // span ends → END, nothing to grade
    // Stable sort, like Python's: ties keep feeder-then-pole order.
    const best = candidates
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => left.candidate.diff - right.candidate.diff || left.index - right.index)[0]
      .candidate;
    targets.push({ to: best.pole, slot: resolveFeederSlot(best.pole, best.feeder) });
  }
  return targets;
}


// ── QR masterlist sort (run_kuantan.py `build_family_map` + `masterlist_sort_key`)
// The QR grades poles in this order; it decides which of two equally near poles
// a span lands on and which row a repeated code resolves to, so the port sorts
// the same way. Ties keep the caller's order (stable) — feed the checklist
// export's order (asset code) to match the QR's input exactly.

const SUFFIX_RANK: Map<string, number> = (() => {
  const order = ['0'];
  for (let i = 1; i < 200; i += 1) order.push(String(i));
  for (let i = 1; i <= 20; i += 1) order.push(`S${i}`);
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F']) {
    for (let i = 1; i <= 100; i += 1) order.push(`${i}${letter}`);
  }
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') order.push(letter);
  return new Map(order.map((suffix, index) => [suffix, index]));
})();

const FP_SORT = /^(FP|TX|LV)\s*(\d+)\s*([A-Za-z]+)?(?:\s+(\d+))?(?:\s+(.*))?$/i;

type FamilyInfo = {
  family: Map<string, string>;
  combinedPos: Map<string, Set<number>>;
  primaryCombinedCount: number;
};

function buildFamilyMap(codes: string[]): FamilyInfo {
  const parent = new Map<string, string>();
  const combinedPos = new Map<string, Set<number>>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let node = x;
    while (parent.get(node) !== node) {
      parent.set(node, parent.get(parent.get(node)!)!);
      node = parent.get(node)!;
    }
    return node;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra > rb ? ra : rb, ra < rb ? ra : rb);
  };
  for (const code of codes) {
    const prim = code.split('&')[0].trim();
    if (/^(?:FP|TX|LV)/i.test(prim)) continue;
    const match = prim.match(/^([A-Za-z]+)\s*(\d+)?/);
    if (!match) continue;
    const letters = match[1].toUpperCase();
    const mainNum = match[2] ? Number.parseInt(match[2], 10) : 0;
    if (letters.length > 1) {
      for (const ch of letters.slice(1)) union(letters[0], ch);
      for (const ch of letters) {
        const set = combinedPos.get(ch) ?? new Set<number>();
        set.add(mainNum);
        combinedPos.set(ch, set);
      }
    }
  }
  const roots = [...parent.keys()].map(find);
  const sitePrimary = roots.length > 0 ? roots.reduce((min, root) => (root < min ? root : min)) : 'A';
  const family = new Map([...parent.keys()].map((ch) => [ch, find(ch)]));
  return { family, combinedPos, primaryCombinedCount: combinedPos.get(sitePrimary)?.size ?? 0 };
}

type SortKey = [string, number, number, string, number, number[], number];

function masterlistSortKey(code: string, info: FamilyInfo): SortKey {
  const poleStr = code.trim();
  const isJunction = poleStr.includes('&') ? 1 : 0;
  const flat = poleStr.split('&')[0].trim().replace(/\//g, ' ');
  let group: string;
  let branch = 0;
  let feederNum = 0;
  let feederWay = '';
  let main = 0;
  let rawSuffix: string;
  const fp = flat.match(FP_SORT);
  if (fp) {
    group = 'FP';
    feederNum = Number.parseInt(fp[2], 10);
    feederWay = fp[3] ? fp[3].toUpperCase()[0] : '';
    main = fp[4] ? Number.parseInt(fp[4], 10) : 0;
    rawSuffix = fp[5] ? fp[5].trim().toUpperCase() : '0';
  } else {
    const parts = flat.split(/\s+/).filter(Boolean);
    const letters = parts.length > 0 ? parts[0].toUpperCase() : 'ZZZ';
    const primary = info.family.get(letters[0]) ?? letters[0];
    group = primary;
    main = parts.length > 1 && /^\d+$/.test(parts[1]) ? Number.parseInt(parts[1], 10) : 0;
    const singleJunction = info.primaryCombinedCount <= 1;
    if (letters.length === 1 && letters[0] !== primary) {
      const onTrunk = info.combinedPos.get(letters[0])?.has(main) ?? false;
      branch = onTrunk ? 0 : 1;
      feederWay = onTrunk && !singleJunction ? '' : letters;
    } else if (letters.length > 1 && letters[0] !== primary && singleJunction) {
      feederWay = letters[0];
    }
    rawSuffix = parts.length > 2 ? parts.slice(2).join(' ').toUpperCase() : '0';
  }
  const suffixParts = rawSuffix.split(/\s+/).filter(Boolean);
  const suffix = (suffixParts.length > 0 ? suffixParts : ['0']).map((part) => SUFFIX_RANK.get(part) ?? 999);
  return [group, branch, feederNum, feederWay, main, suffix, isJunction];
}

function compareValues(left: string | number, right: string | number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareKeys(left: SortKey, right: SortKey): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        const c = compareValues(a[i], b[i]);
        if (c !== 0) return c;
      }
      if (a.length !== b.length) return a.length - b.length;
      continue;
    }
    const c = compareValues(a as string | number, b as string | number);
    if (c !== 0) return c;
  }
  return 0;
}

/** Stable sort of poles into the QR's masterlist order. */
export function sortPolesLikeQr<T extends { code: string }>(rows: T[]): T[] {
  const info = buildFamilyMap(rows.map((row) => row.code));
  return rows
    .map((row, index) => ({ row, index, key: masterlistSortKey(row.code, info) }))
    .sort((left, right) => compareKeys(left.key, right.key) || left.index - right.index)
    .map((entry) => entry.row);
}

/**
 * Grade one Pencawang's poles. Mirrors `build_ground_clearance` + the GC
 * reconcile: per span, a receiving support pole (UMBANG TERBANG) or a P2P / UG /
 * NO ACCESS remark is not graded; an empty second/third slot inherits slot 1
 * (parallel line); any TAK PATUH span flags its receiving pole. Results come
 * back in the QR's masterlist order.
 */
export function gradeGroundClearance(input: GcPoleInput[]): GcPoleResult[] {
  const poles = sortPolesLikeQr(input);
  // QR keys rows by NO TIANG RONDAAN; a repeated code resolves to the last row.
  const byCode = new Map<string, GcPoleInput>();
  for (const pole of poles) byCode.set(pole.code.trim(), pole);

  const spansByCode = new Map<string, GcSpan[]>();
  for (const target of generateSpanTargets(poles.map((pole) => pole.code))) {
    const row = byCode.get(target.to);
    if (!row) continue;
    const spans = spansByCode.get(target.to) ?? [];
    spansByCode.set(target.to, spans);

    const umbang = String(row.umbang ?? '').trim().toUpperCase();
    const catatan = String(row.catatan ?? '').trim().toUpperCase();
    const skipped = umbang.includes('UMBANG TERBANG')
      ? 'support pole (UMBANG TERBANG)'
      : catatan.includes('P2P') || catatan.includes('UG')
        ? `CATITAN '${catatan}' (P2P/UG)`
        : catatan.includes('NO ACCESS')
          ? 'CATITAN NO ACCESS'
          : null;
    if (skipped) {
      spans.push({ to: target.to, slot: target.slot, grade: null, skipped });
      continue;
    }

    const at = (slot: number) => row.slots[slot - 1] ?? { reading: '', terrain: '' };
    let { reading, terrain } = at(target.slot);
    if (target.slot !== 1 && isBlank(reading) && isBlank(terrain)) {
      ({ reading, terrain } = at(1));
    }
    spans.push({ to: target.to, slot: target.slot, grade: classifySlot(reading, terrain, target.slot), skipped: null });
  }

  return poles.map((pole) => {
    const code = pole.code.trim();
    const spans = byCode.get(code) === pole ? spansByCode.get(code) ?? [] : [];
    return {
      key: pole.key,
      code,
      fail: spans.some((span) => span.grade?.status === 'TAK PATUH'),
      spans,
    };
  });
}
