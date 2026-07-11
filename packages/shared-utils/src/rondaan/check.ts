/**
 * Pre-completion NO TIANG RONDAAN check — the "lint the rondaan before it leaves
 * the field" pass. It wraps the canonical sequence validator
 * (`validateFeederSequences`) and adds a raw-formatting check, then classifies
 * every issue as a blocking `error` (malformed, duplicate, extra spaces/casing —
 * all fixable on the spot) or an acknowledge-able `warning` (a skipped/missing
 * pole, which can be legitimate when a pole was removed).
 *
 * Pure + offline so it runs on the mobile "Complete Visit" gate; the SAME
 * function runs server-side so DC sees the identical verdict on the admin Site
 * Visit page. Single source of truth across mobile / API / admin.
 */
import {
  validateFeederSequences,
  normalizePoleInput,
  parsePoleCode,
  getAssetId,
  type AssetLike,
  type FeederValidationIssue,
  type FeederValidationIssueType,
} from './parse';

export type RondaanCheckSeverity = 'error' | 'warning';

export type RondaanCheckIssueType = FeederValidationIssueType | 'FORMATTING';

export interface RondaanCheckIssue {
  severity: RondaanCheckSeverity;
  type: RondaanCheckIssueType;
  /** Short, field-crew-facing description of the problem. */
  message: string;
  /** The asset the issue anchors to (invalid/formatting/branch), when there is
   *  a single one. Sequence gaps sit *between* poles and carry no assetId. */
  assetId?: string;
  /** Assets sharing a duplicate code. */
  assetIds?: string[];
  /** The offending pole code as stored. */
  code?: string;
  /** For FORMATTING: the cleaned-up code to one-tap apply. */
  suggestedCode?: string;
  /** For gaps: the missing pole code. */
  missingCode?: string;
}

export interface RondaanCheckResult {
  /** No issues at all. */
  ok: boolean;
  /** Any blocking error — completion should be blocked until these are fixed. */
  hasErrors: boolean;
  /** Any warning — completion may proceed once the inspector acknowledges. */
  hasWarnings: boolean;
  errors: RondaanCheckIssue[];
  warnings: RondaanCheckIssue[];
  /** All issues, errors first. */
  issues: RondaanCheckIssue[];
}

// A malformed or duplicated code is always an error; every "missing pole" type
// is a gap that can be legitimate (a pole was removed) → warning.
const ERROR_TYPES: ReadonlySet<FeederValidationIssueType> = new Set([
  'INVALID_CODE_FORMAT',
  'DUPLICATE_NORMALIZED_KEY',
]);

const POLE_CODE_FIELDS = ['noTiangRondaan', 'assetCode', 'code', 'name'] as const;

/** The pole code EXACTLY as stored (untrimmed) so the formatting check can see
 *  stray leading/trailing/internal spaces and casing. Mirrors getPoleCode's
 *  field precedence but does not clean the value; numeric codes have nothing to
 *  normalise so they're skipped. */
function getRawPoleCodeString(asset: AssetLike): string | undefined {
  for (const field of POLE_CODE_FIELDS) {
    const value = asset[field];

    if (typeof value === 'string' && value.trim()) {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return undefined;
    }
  }

  return undefined;
}

function isParseableCode(code: string): boolean {
  const parsed = parsePoleCode(code);

  return parsed.length > 0 && parsed.every((entry) => entry.isValid);
}

/** Turn a validator issue into a short field-facing sentence. */
function toFieldMessage(issue: FeederValidationIssue): string {
  const code = issue.code ?? issue.key ?? '';

  switch (issue.type) {
    case 'INVALID_CODE_FORMAT':
      return code ? `Bad pole-number format: "${code}".` : 'A pole has no NO TIANG RONDAAN.';
    case 'DUPLICATE_NORMALIZED_KEY':
      return `Duplicate pole number "${issue.key ?? ''}" used more than once.`;
    case 'MISSING_PREVIOUS_BASE_SEQUENCE':
      return `Missing "${issue.missingKey ?? ''}" — the sequence jumps to "${issue.key ?? ''}".`;
    case 'MISSING_BRANCH_PARENT':
      return `"${issue.key ?? ''}" has no parent pole "${issue.missingKey ?? ''}".`;
    case 'MISSING_BRANCH_PREVIOUS_SEQUENCE':
      return `"${issue.key ?? ''}" skips "${issue.missingKey ?? ''}".`;
    default:
      return `Sequence issue near "${code}".`;
  }
}

/**
 * Run the full pre-completion check over a visit's poles.
 *
 * Errors (block completion): bad format, duplicate numbers, extra spaces/casing.
 * Warnings (acknowledge to proceed): skipped/missing numbers and missing branch
 * parents — a pole may have been legitimately removed.
 */
export function checkRondaanForCompletion(assets: AssetLike[]): RondaanCheckResult {
  const issues: RondaanCheckIssue[] = [];

  // 1) Canonical sequence + structural validation.
  const sequence = validateFeederSequences(assets);

  for (const issue of sequence.issues) {
    issues.push({
      severity: ERROR_TYPES.has(issue.type) ? 'error' : 'warning',
      type: issue.type,
      message: toFieldMessage(issue),
      assetId: issue.assetId,
      assetIds: issue.assetIds,
      code: issue.code,
      missingCode: issue.missingKey,
    });
  }

  // 2) Formatting: a VALID code that isn't in canonical form (extra spaces,
  //    casing, letter/digit spacing). Malformed codes are already reported above
  //    as INVALID_CODE_FORMAT, so only flag ones that clean up to a valid code.
  assets.forEach((asset, index) => {
    const raw = getRawPoleCodeString(asset);

    if (raw === undefined) {
      return;
    }

    const cleaned = normalizePoleInput(raw);

    if (!cleaned || cleaned === raw || !isParseableCode(cleaned)) {
      return;
    }

    issues.push({
      severity: 'error',
      type: 'FORMATTING',
      message: `"${raw}" should be "${cleaned}" (extra space or casing).`,
      assetId: getAssetId(asset, `asset-${index + 1}`),
      code: raw,
      suggestedCode: cleaned,
    });
  });

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return {
    ok: issues.length === 0,
    hasErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
    errors,
    warnings,
    issues: [...errors, ...warnings],
  };
}
