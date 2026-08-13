export interface PoleBranchPart {
  number: number;
  suffix?: string;
}

/**
 * Where a feeder line takes its power from, when it is not straight off the
 * Pencawang busbar:
 *   - `FP` — a Feeder Pillar (Pencawang→FP→pole).
 *   - `TX` — a specific outgoing TRANSFORMER, for a Pencawang that has more than
 *     one and where TNB wants each feeder attributed to the right one.
 *
 * Both behave identically: a pure LABEL that namespaces the feeder line, so
 * `TX1 A 1`, `FP1 A 1` and `A 1` are three different poles on three different
 * lines, each with its own sequence.
 *
 * ⚠ ONE origin per pole code. `TX1 FP1 A 1` (a pillar fed by a transformer) is
 * NOT grammar today — if TNB needs to record both levels, this becomes two
 * slots rather than a kind, and `buildNormalizedKey` has to render both.
 */
export type PoleOriginKind = 'FP' | 'TX';

export interface PoleOrigin {
  kind: PoleOriginKind;
  number: number;
}

/** Origin tokens, longest-first, safe to drop into a regex alternation. */
const ORIGIN_KINDS: PoleOriginKind[] = ['FP', 'TX'];
const ORIGIN_TOKEN = ORIGIN_KINDS.join('|');

/** Render an origin back to its canonical prefix token, e.g. `TX2`. */
export function formatPoleOrigin(origin: PoleOrigin): string {
  return `${origin.kind}${origin.number}`;
}

export interface ParsedPoleCode {
  original: string;
  feeder: string;
  baseNumber: number;
  branchParts: PoleBranchPart[];
  /** Optional power origin (the `FP<n>` / `TX<n>` prefix), set when the pole's
   *  feeder runs from a Feeder Pillar or a specific outgoing transformer rather
   *  than straight off the Pencawang. Undefined = direct. It namespaces the
   *  feeder line, so `FP1 A 1` ≠ `TX1 A 1` ≠ `A 1` ≠ `FP2 A 1`. */
  origin?: PoleOrigin;
  normalizedKey: string;
  parentKey?: string;
  isValid: boolean;
  errors: string[];
}

export interface AssetLike {
  id?: string | number | null;
  name?: string | number | null;
  code?: string | number | null;
  assetCode?: string | number | null;
  noTiangRondaan?: string | number | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  [key: string]: unknown;
}

export interface AssetCoordinate {
  latitude: number;
  longitude: number;
}

export interface ParsedAssetPoleCode {
  asset: AssetLike;
  assetId: string;
  poleCode: string;
  coordinate: AssetCoordinate | null;
  parsed: ParsedPoleCode;
}

export type FeederValidationIssueType =
  | 'INVALID_CODE_FORMAT'
  | 'DUPLICATE_NORMALIZED_KEY'
  | 'MISSING_PREVIOUS_BASE_SEQUENCE'
  | 'MISSING_BRANCH_PARENT'
  | 'MISSING_BRANCH_PREVIOUS_SEQUENCE';

export interface FeederValidationIssue {
  type: FeederValidationIssueType;
  message: string;
  assetId?: string;
  assetIds?: string[];
  feeder?: string;
  key?: string;
  missingKey?: string;
  expectedKey?: string;
  code?: string;
}

export interface FeederValidationResult {
  isValid: boolean;
  issues: FeederValidationIssue[];
  entries: ParsedAssetPoleCode[];
  invalidEntries: ParsedAssetPoleCode[];
  duplicateKeys: string[];
  missingKeys: string[];
}

export interface FeederLine {
  id: string;
  feeder: string;
  fromAssetId: string;
  toAssetId: string;
  fromKey: string;
  toKey: string;
  coordinates: [AssetCoordinate, AssetCoordinate];
  warning?: string;
}

type BranchAddress = Pick<ParsedPoleCode, 'feeder' | 'baseNumber' | 'branchParts' | 'origin'>;
type DrawableParsedAssetPoleCode = Omit<ParsedAssetPoleCode, 'coordinate'> & {
  coordinate: AssetCoordinate;
};

const POLE_SEGMENT_PATTERN = /^([A-Z]+)\s*([1-9]\d*)((?:\/[1-9]\d*[A-Z]*)*)$/;
const BRANCH_PART_PATTERN = /\/([1-9]\d*)([A-Z]*)/g;
const POLE_CODE_FIELDS = ['noTiangRondaan', 'assetCode', 'code', 'name'] as const;

export function getAssetId(asset: AssetLike, fallback?: string | number): string {
  const id = asset.id;

  if (typeof id === 'string') {
    const normalizedId = id.trim();

    if (normalizedId) {
      return normalizedId;
    }
  }

  if (typeof id === 'number' && Number.isFinite(id)) {
    return String(id);
  }

  return fallback === undefined ? '' : String(fallback);
}

export function getPoleCode(asset: AssetLike): string | undefined {
  for (const field of POLE_CODE_FIELDS) {
    const value = asset[field];

    if (typeof value === 'string') {
      const normalizedValue = value.trim();

      if (normalizedValue) {
        return normalizedValue;
      }
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

export function getAssetCoordinate(asset: AssetLike): AssetCoordinate | null {
  const latitude = toFiniteNumber(asset.latitude);
  const longitude = toFiniteNumber(asset.longitude);

  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function normalizePoleInput(input: string): string {
  const normalized = String(input ?? '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/\s*[&]\s*/g, ' & ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/([A-Z]+)\s*(?=\d)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();

  // Collapse an origin token back to its canonical `FP<n>` / `TX<n>` form: the
  // letter→digit spacer above splits `FP1` into `FP 1`. An origin prefix may sit
  // at the front OR on any `&`-joined segment — a pole shared across feeder lines
  // that run from one is written per-segment, e.g. `FP1 C 1 & FP1 G 1` (or
  // `FP1 A 1 & FP2 B 1` for two different pillars). Only collapse when it
  // prefixes a feeder line, so a bare `FP 1` (feeders F & P at index 1) — or
  // `TX 1` (feeders T & X) — is left as the normal feeder grammar.
  return normalized.replace(
    new RegExp(`(^|& )(${ORIGIN_TOKEN})\\s+([1-9]\\d*)\\s+(?=[A-Z])`, 'g'),
    '$1$2$3 ',
  );
}

/**
 * Split a normalized pole code into its optional leading power origin
 * (`FP<n>` / `TX<n>`) and the remaining feeder grammar:
 *   "FP1 A 1"      -> { origin: {kind:'FP', number:1}, rest: "A 1" }
 *   "TX2 AB 1"     -> { origin: {kind:'TX', number:2}, rest: "AB 1" }
 *   "A 1"          -> { rest: "A 1" }
 * Only a leading origin token that prefixes a feeder line is taken, so a bare
 * "FP 1" (feeders F & P at index 1) or "TX 1" (feeders T & X) is left as-is for
 * the normal feeder grammar.
 */
export function extractOrigin(normalizedInput: string): {
  origin?: PoleOrigin;
  rest: string;
} {
  const match = normalizedInput.match(
    new RegExp(`^(${ORIGIN_TOKEN})\\s*([1-9]\\d*)\\s+([A-Z].*)$`),
  );

  if (!match) {
    return { rest: normalizedInput };
  }

  const number = Number(match[2]);

  if (!Number.isSafeInteger(number) || number <= 0) {
    return { rest: normalizedInput };
  }

  return { origin: { kind: match[1] as PoleOriginKind, number }, rest: match[3] };
}

export function buildNormalizedKey(
  feeder: string,
  baseNumber: number,
  branchParts: PoleBranchPart[] = [],
  origin?: PoleOrigin,
): string {
  const prefix =
    origin !== undefined && origin.number > 0 ? `${formatPoleOrigin(origin)} ` : '';
  const normalizedFeeder = feeder.trim().toUpperCase();
  const branchKey = branchParts
    .map((part) => {
      const suffix = part.suffix ? part.suffix.trim().toUpperCase() : '';

      return `/${part.number}${suffix}`;
    })
    .join('');

  return `${prefix}${normalizedFeeder} ${baseNumber}${branchKey}`;
}

export function getExpectedParentKey(code: BranchAddress): string | undefined {
  if (code.branchParts.length === 0) {
    return undefined;
  }

  const parentBranchParts = code.branchParts.map((part) => ({ ...part }));
  const lastPart = parentBranchParts[parentBranchParts.length - 1];

  if (!lastPart) {
    return undefined;
  }

  if (lastPart.number > 1) {
    lastPart.number -= 1;

    return buildNormalizedKey(code.feeder, code.baseNumber, parentBranchParts, code.origin);
  }

  parentBranchParts.pop();

  return buildNormalizedKey(code.feeder, code.baseNumber, parentBranchParts, code.origin);
}

/** Backstop against a pathological index (e.g. "A 99999/50000") spinning the
 *  ancestor walk — real feeders hold a few hundred poles at most. */
const PARENT_CHAIN_MAX_KEYS = 10_000;

/**
 * Every candidate parent key for a pole, NEAREST FIRST, walking the grammar up
 * the lineage until the feeder head:
 *
 *   "A 4/2/2"  ->  A 4/2/1, A 4/2, A 4/1, A 4, A 3, A 2, A 1
 *   "A 4/2/1A" ->  A 4/2 (a first branch pole pops to its junction), A 4/1, …
 *   "A 5"      ->  A 4, A 3, A 2, A 1
 *
 * The first key that EXISTS in a Pencawang is the nearest recorded pole to hang
 * this one from. Resolving against this chain (instead of "exact parent, else
 * any lower TRUNK pole") keeps a child on its own branch when an intermediate
 * pole is merely unrecorded — the trunk-only fallback drew every such child as
 * a long line straight back to the trunk.
 */
export function expectedParentKeyChain(code: BranchAddress): string[] {
  const keys: string[] = [];
  const branchParts = code.branchParts.map((part) => ({ ...part }));

  while (branchParts.length > 0 && keys.length < PARENT_CHAIN_MAX_KEYS) {
    const lastPart = branchParts[branchParts.length - 1];

    if (lastPart.number > 1) {
      lastPart.number -= 1;
    } else {
      branchParts.pop();
    }

    keys.push(buildNormalizedKey(code.feeder, code.baseNumber, branchParts, code.origin));
  }

  for (let base = code.baseNumber - 1; base >= 1 && keys.length < PARENT_CHAIN_MAX_KEYS; base -= 1) {
    keys.push(buildNormalizedKey(code.feeder, base, [], code.origin));
  }

  return keys;
}

/**
 * Collapse a pole's parsed segments to ONE per feeder — the LOWEST position
 * (base index, then branch lineage) wins deterministically.
 *
 * A code like "B 18 & B 23/5B" puts one pole at TWO positions on the SAME
 * feeder (a field loop the radial model can't hold): the stored graph keys a
 * membership by (asset, feeder), so only one position can persist. Without a
 * deterministic pick, writers disagree run-to-run and the stored row
 * oscillates between the two positions (seen on the 2026-08-13 prod repair:
 * 13 edges flip-flopped on every pass). Lowest keeps the trunk-most position —
 * the better spine for the drawn graph; a real loop belongs in a NOP tie.
 */
export function canonicalSegmentsPerFeeder(parsed: ParsedPoleCode[]): ParsedPoleCode[] {
  const byFeeder = new Map<string, ParsedPoleCode>();

  for (const segment of parsed) {
    const key = originLineKey(segment);
    const current = byFeeder.get(key);

    if (
      !current ||
      segment.baseNumber < current.baseNumber ||
      (segment.baseNumber === current.baseNumber &&
        compareBranchParts(segment.branchParts, current.branchParts) < 0)
    ) {
      byFeeder.set(key, segment);
    }
  }

  return parsed.filter((segment) => byFeeder.get(originLineKey(segment)) === segment);
}

export function parsePoleCode(input: string): ParsedPoleCode[] {
  const original = String(input ?? '').trim();
  const normalizedInput = normalizePoleInput(input);

  if (!normalizedInput) {
    return [createInvalidParsed(original, '', ['Pole code is required.'])];
  }

  // Each `&`-joined segment may carry its own `FP<n>` origin: a pole shared
  // across feeder lines is written per-segment (`FP1 C 1 & FP1 G 1`), and the
  // lines can even run from different Feeder Pillars (`FP1 A 1 & FP2 B 1`). A
  // single `FP<n>` at the FRONT is the default origin for any bare segment, so
  // `FP1 C 1 & G 1` still reads both lines as FP1 (backward-compatible). Still no
  // nesting — at most one `FP<n>` per segment.
  const { origin: frontOrigin, rest } = extractOrigin(normalizedInput);
  const segments = rest.split('&').map((segment) => segment.trim());
  const parsedCodes: ParsedPoleCode[] = [];

  for (const segment of segments) {
    const { origin: segmentOrigin, rest: segmentRest } = extractOrigin(segment);
    parsedCodes.push(
      ...parsePoleSegment(original, segmentRest, segmentOrigin ?? frontOrigin),
    );
  }

  return parsedCodes;
}

export function validateFeederSequences(assets: AssetLike[]): FeederValidationResult {
  const entries = parseAssetPoleCodes(assets);
  const issues: FeederValidationIssue[] = [];
  const invalidEntries = entries.filter((entry) => !entry.parsed.isValid);
  const entriesByKey = groupValidEntriesByKey(entries);
  const validKeySet = new Set(entriesByKey.keys());
  const duplicateKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const entry of invalidEntries) {
    issues.push({
      type: 'INVALID_CODE_FORMAT',
      message: `Invalid pole code format: "${entry.poleCode}".`,
      assetId: entry.assetId,
      key: entry.parsed.normalizedKey,
      code: entry.poleCode,
    });
  }

  for (const [key, matchingEntries] of entriesByKey.entries()) {
    if (matchingEntries.length <= 1) {
      continue;
    }

    const assetIds = matchingEntries.map((entry) => entry.assetId);
    duplicateKeys.push(key);
    issues.push({
      type: 'DUPLICATE_NORMALIZED_KEY',
      message: `Duplicate pole code "${key}" found on assets ${assetIds.join(', ')}.`,
      assetIds,
      key,
    });
  }

  for (const issue of findMissingBaseSequenceIssues(entries)) {
    issues.push(issue);
    addUnique(missingKeys, issue.missingKey);
  }

  for (const entry of entries) {
    if (!entry.parsed.isValid || entry.parsed.branchParts.length === 0) {
      continue;
    }

    const expectedParentKey = getExpectedParentKey(entry.parsed);

    if (!expectedParentKey || validKeySet.has(expectedParentKey)) {
      continue;
    }

    const issueType = hasEarlierBranchSequence(entry.parsed, validKeySet)
      ? 'MISSING_BRANCH_PREVIOUS_SEQUENCE'
      : 'MISSING_BRANCH_PARENT';

    issues.push({
      type: issueType,
      message:
        issueType === 'MISSING_BRANCH_PREVIOUS_SEQUENCE'
          ? `Missing branch previous sequence "${expectedParentKey}" before "${entry.parsed.normalizedKey}".`
          : `Missing branch parent "${expectedParentKey}" for "${entry.parsed.normalizedKey}".`,
      assetId: entry.assetId,
      feeder: entry.parsed.feeder,
      key: entry.parsed.normalizedKey,
      missingKey: expectedParentKey,
      expectedKey: expectedParentKey,
      code: entry.poleCode,
    });
    addUnique(missingKeys, expectedParentKey);
  }

  return {
    isValid: issues.length === 0,
    issues,
    entries,
    invalidEntries,
    duplicateKeys,
    missingKeys,
  };
}

export function buildFeederLines(assets: AssetLike[]): FeederLine[] {
  const entries = parseAssetPoleCodes(assets);
  const drawableEntriesByFeeder = groupDrawableEntriesByFeeder(entries);
  const lines: FeederLine[] = [];
  const lineIds = new Set<string>();

  for (const entriesByKey of drawableEntriesByFeeder.values()) {
    const sortedEntries = Array.from(entriesByKey.values()).sort(compareParsedEntries);

    for (const entry of sortedEntries) {
      const parsed = entry.parsed;

      if (parsed.branchParts.length !== 0) {
        continue;
      }

      const nextBaseKey = buildNormalizedKey(
        parsed.feeder,
        parsed.baseNumber + 1,
        [],
        parsed.origin,
      );
      const nextBaseEntry = entriesByKey.get(nextBaseKey);

      if (nextBaseEntry) {
        addFeederLine(lines, lineIds, entry, nextBaseEntry);
      }
    }

    for (const entry of sortedEntries) {
      const parsed = entry.parsed;

      if (parsed.branchParts.length === 0 || !parsed.parentKey) {
        continue;
      }

      const parentEntry = entriesByKey.get(parsed.parentKey);

      if (parentEntry) {
        addFeederLine(lines, lineIds, parentEntry, entry);
      }
    }
  }

  return lines;
}

function parsePoleSegment(
  original: string,
  segment: string,
  origin?: PoleOrigin,
): ParsedPoleCode[] {
  const normalizedSegment = normalizePoleInput(segment);

  if (!normalizedSegment) {
    return [createInvalidParsed(original, normalizedSegment, ['Pole code segment is empty.'])];
  }

  const match = normalizedSegment.match(POLE_SEGMENT_PATTERN);

  if (!match) {
    return [
      createInvalidParsed(original, normalizedSegment, [
        'Pole code must use feeder letters followed by a positive pole number.',
      ]),
    ];
  }

  const feederLetters = match[1];
  const baseNumber = Number(match[2]);
  const branchText = match[3] ?? '';
  const branchParts = parseBranchParts(branchText);

  if (!Number.isSafeInteger(baseNumber) || baseNumber <= 0) {
    return [createInvalidParsed(original, normalizedSegment, ['Pole number is out of range.'])];
  }

  if (!branchParts) {
    return [
      createInvalidParsed(original, normalizedSegment, [
        'Branch parts must use a positive number with an optional suffix.',
      ]),
    ];
  }

  return feederLetters.split('').map((feeder) => {
    const normalizedKey = buildNormalizedKey(feeder, baseNumber, branchParts, origin);
    const parsed: ParsedPoleCode = {
      original,
      feeder,
      baseNumber,
      branchParts: branchParts.map((part) => ({ ...part })),
      ...(origin !== undefined ? { origin } : {}),
      normalizedKey,
      isValid: true,
      errors: [],
    };
    const parentKey = getExpectedParentKey(parsed);

    return parentKey ? { ...parsed, parentKey } : parsed;
  });
}

function parseBranchParts(branchText: string): PoleBranchPart[] | null {
  if (!branchText) {
    return [];
  }

  const branchParts: PoleBranchPart[] = [];
  let matchedText = '';
  let match: RegExpExecArray | null;

  BRANCH_PART_PATTERN.lastIndex = 0;

  while ((match = BRANCH_PART_PATTERN.exec(branchText)) !== null) {
    const number = Number(match[1]);

    if (!Number.isSafeInteger(number) || number <= 0) {
      return null;
    }

    const suffix = match[2] || undefined;
    branchParts.push(suffix ? { number, suffix } : { number });
    matchedText += match[0];
  }

  return matchedText === branchText ? branchParts : null;
}

function createInvalidParsed(original: string, normalizedKey: string, errors: string[]): ParsedPoleCode {
  return {
    original,
    feeder: '',
    baseNumber: Number.NaN,
    branchParts: [],
    normalizedKey,
    isValid: false,
    errors,
  };
}

function parseAssetPoleCodes(assets: AssetLike[]): ParsedAssetPoleCode[] {
  const entries: ParsedAssetPoleCode[] = [];

  assets.forEach((asset, index) => {
    const assetId = getAssetId(asset, `asset-${index + 1}`);
    const poleCode = getPoleCode(asset) ?? '';
    const coordinate = getAssetCoordinate(asset);
    const parsedCodes = poleCode
      ? parsePoleCode(poleCode)
      : [createInvalidParsed('', '', ['Pole code is required.'])];

    for (const parsed of parsedCodes) {
      entries.push({
        asset,
        assetId,
        poleCode,
        coordinate,
        parsed,
      });
    }
  });

  return entries;
}

function groupValidEntriesByKey(entries: ParsedAssetPoleCode[]): Map<string, ParsedAssetPoleCode[]> {
  const entriesByKey = new Map<string, ParsedAssetPoleCode[]>();

  for (const entry of entries) {
    if (!entry.parsed.isValid) {
      continue;
    }

    const existingEntries = entriesByKey.get(entry.parsed.normalizedKey) ?? [];
    existingEntries.push(entry);
    entriesByKey.set(entry.parsed.normalizedKey, existingEntries);
  }

  return entriesByKey;
}

function groupDrawableEntriesByFeeder(
  entries: ParsedAssetPoleCode[],
): Map<string, Map<string, DrawableParsedAssetPoleCode>> {
  const validEntriesByKey = groupValidEntriesByKey(entries);
  const entriesByLine = new Map<string, Map<string, DrawableParsedAssetPoleCode>>();

  for (const [key, matchingEntries] of validEntriesByKey.entries()) {
    if (matchingEntries.length !== 1) {
      continue;
    }

    const entry = matchingEntries[0];

    if (!entry.coordinate) {
      continue;
    }

    const lineKey = originLineKey(entry.parsed);
    const lineEntries = entriesByLine.get(lineKey) ?? new Map<string, DrawableParsedAssetPoleCode>();
    lineEntries.set(key, { ...entry, coordinate: entry.coordinate });
    entriesByLine.set(lineKey, lineEntries);
  }

  return entriesByLine;
}

function findMissingBaseSequenceIssues(entries: ParsedAssetPoleCode[]): FeederValidationIssue[] {
  const linesByKey = new Map<
    string,
    { feeder: string; origin?: PoleOrigin; baseNumbers: Set<number> }
  >();
  const issues: FeederValidationIssue[] = [];

  for (const entry of entries) {
    const parsed = entry.parsed;

    if (!parsed.isValid || parsed.branchParts.length > 0) {
      continue;
    }

    const lineKey = originLineKey(parsed);
    let line = linesByKey.get(lineKey);

    if (!line) {
      line = { feeder: parsed.feeder, origin: parsed.origin, baseNumbers: new Set<number>() };
      linesByKey.set(lineKey, line);
    }

    line.baseNumbers.add(parsed.baseNumber);
  }

  for (const line of linesByKey.values()) {
    const sortedBaseNumbers = Array.from(line.baseNumbers).sort((left, right) => left - right);

    for (let index = 1; index < sortedBaseNumbers.length; index += 1) {
      const previousNumber = sortedBaseNumbers[index - 1];
      const currentNumber = sortedBaseNumbers[index];

      for (let missingNumber = previousNumber + 1; missingNumber < currentNumber; missingNumber += 1) {
        const missingKey = buildNormalizedKey(line.feeder, missingNumber, [], line.origin);
        const currentKey = buildNormalizedKey(line.feeder, currentNumber, [], line.origin);

        issues.push({
          type: 'MISSING_PREVIOUS_BASE_SEQUENCE',
          message: `Missing previous base sequence "${missingKey}" before "${currentKey}".`,
          feeder: line.feeder,
          key: currentKey,
          missingKey,
          expectedKey: missingKey,
        });
      }
    }
  }

  return issues;
}

/** Identity of one feeder line within a Pencawang, namespaced by its
 *  Feeder-Pillar origin: the `FP1 A` line and the direct `A` line are distinct,
 *  so their base/branch sequences validate and draw independently. */
function originLineKey(parsed: Pick<ParsedPoleCode, 'feeder' | 'origin'>): string {
  // \u0000 as an escape, NOT a raw NUL byte: a literal NUL made this file read
  // as BINARY to grep/ripgrep and every editor tool that guards against it.
  return `${parsed.origin ? formatPoleOrigin(parsed.origin) : ''}\u0000${parsed.feeder}`;
}

function hasEarlierBranchSequence(parsed: ParsedPoleCode, validKeySet: Set<string>): boolean {
  const lastPart = parsed.branchParts[parsed.branchParts.length - 1];

  if (!lastPart || lastPart.number <= 1) {
    return false;
  }

  const prefixParts = parsed.branchParts.slice(0, -1);

  for (let number = 1; number < lastPart.number; number += 1) {
    const key = buildNormalizedKey(
      parsed.feeder,
      parsed.baseNumber,
      [
        ...prefixParts,
        lastPart.suffix ? { number, suffix: lastPart.suffix } : { number },
      ],
      parsed.origin,
    );

    if (validKeySet.has(key)) {
      return true;
    }
  }

  return false;
}

function createFeederLine(
  fromEntry: DrawableParsedAssetPoleCode,
  toEntry: DrawableParsedAssetPoleCode,
): FeederLine {
  return {
    id: `${fromEntry.parsed.normalizedKey}->${toEntry.parsed.normalizedKey}`,
    feeder: toEntry.parsed.feeder,
    fromAssetId: fromEntry.assetId,
    toAssetId: toEntry.assetId,
    fromKey: fromEntry.parsed.normalizedKey,
    toKey: toEntry.parsed.normalizedKey,
    coordinates: [fromEntry.coordinate, toEntry.coordinate],
  };
}

function addFeederLine(
  lines: FeederLine[],
  lineIds: Set<string>,
  fromEntry: DrawableParsedAssetPoleCode,
  toEntry: DrawableParsedAssetPoleCode,
): void {
  const line = createFeederLine(fromEntry, toEntry);

  if (lineIds.has(line.id)) {
    return;
  }

  lineIds.add(line.id);
  lines.push(line);
}

function compareParsedEntries(left: ParsedAssetPoleCode, right: ParsedAssetPoleCode): number {
  const leftParsed = left.parsed;
  const rightParsed = right.parsed;
  const feederComparison = leftParsed.feeder.localeCompare(rightParsed.feeder);

  if (feederComparison !== 0) {
    return feederComparison;
  }

  if (leftParsed.baseNumber !== rightParsed.baseNumber) {
    return leftParsed.baseNumber - rightParsed.baseNumber;
  }

  return compareBranchParts(leftParsed.branchParts, rightParsed.branchParts);
}

function compareBranchParts(left: PoleBranchPart[], right: PoleBranchPart[]): number {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];

    if (!leftPart && !rightPart) {
      return 0;
    }

    if (!leftPart) {
      return -1;
    }

    if (!rightPart) {
      return 1;
    }

    if (leftPart.number !== rightPart.number) {
      return leftPart.number - rightPart.number;
    }

    const suffixComparison = (leftPart.suffix ?? '').localeCompare(rightPart.suffix ?? '');

    if (suffixComparison !== 0) {
      return suffixComparison;
    }
  }

  return 0;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      return null;
    }

    const numericValue = Number(normalizedValue);

    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function addUnique(values: string[], value: string | undefined): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}
