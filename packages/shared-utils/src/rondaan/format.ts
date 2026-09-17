/**
 * Canonical NO TIANG RONDAAN formatter — the inverse of the parser in `parse.ts`.
 *
 * North-star §3: "store the structure, render the label." A pole holds a set of
 * (feeder, index, branch) memberships; its NO TIANG RONDAAN is *rendered* from
 * them here. This is the single source of truth for the pole string shown on
 * screen and printed in reports, so it MUST reproduce TNB's exact grammar (the
 * round-trip property below is how we hold it to that).
 *
 * Grammar (north-star §3):
 *   - Basic:                 A 1, A 2, A 3
 *   - Feeders sharing a run: CD 1, CD 2          (same poles, same indices)
 *   - Feeders converging:    E 4 & F 2           (per-feeder indices, joined by " & ")
 *   - Junction / T-off:      B 2/1, B 2/2, B 4/1A
 *
 * Note on feeder identity: a stored Feeder is a single canonical token ("C",
 * "D", "E"…). "CD" is NOT a stored feeder — it is a render-time *combine* of the
 * C and D memberships that share an index. The parser splits "CD 1" into
 * {C,1}+{D,1}; this formatter recombines them. Keep that symmetry.
 */

import type { ParsedPoleCode, PoleBranchPart, PoleOrigin } from './parse';
import { formatPoleOrigin, normalizePoleInput, parsePoleCode } from './parse';

/**
 * One feeder membership of a pole: which feeder, the per-feeder index, and the
 * optional branch lineage off that feeder's trunk. Mirrors a stored
 * PoleFeederMembership row (feeder.code, sequenceIndex, branch).
 */
export interface PoleMembership {
  feeder: string;
  index: number;
  /** Structured branch lineage (e.g. straight from the parser). */
  branchParts?: PoleBranchPart[];
  /** Canonical branch suffix as stored (e.g. "/1A"); takes precedence over
   *  branchParts when set, so DB rows render without re-parsing. */
  branchSuffix?: string;
  /** Optional power origin (`FP<n>` Feeder Pillar, or `TX<n>` a specific
   *  outgoing transformer) of THIS membership's feeder line. Rendered as a
   *  per-segment prefix; memberships on a direct line carry none, so one pole
   *  can mix origin and direct lines ("D 13 & FP1 C 1"). */
  origin?: PoleOrigin;
}

interface MembershipGroup {
  index: number;
  branchSuffix: string;
  feeders: string[];
  origin?: PoleOrigin;
}

const SINGLE_LETTER_FEEDER = /^[A-Z]$/;

/** Two origins match when both are absent, or both name the same kind AND
 *  number. ⚠ Never compare origins with `===` — they are objects now, so that
 *  is reference equality and would fail for every separately-parsed segment. */
function sameOrigin(a?: PoleOrigin, b?: PoleOrigin): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }

  return a.kind === b.kind && a.number === b.number;
}

/**
 * Render the branch lineage suffix: [] -> "", [{1}] -> "/1",
 * [{2},{1,'A'}] -> "/2/1A". This is the canonical persisted `branchSuffix`.
 */
export function formatBranchSuffix(branchParts?: PoleBranchPart[]): string {
  if (!branchParts || branchParts.length === 0) {
    return '';
  }

  return branchParts
    .map((part) => `/${part.number}${(part.suffix ?? '').trim().toUpperCase()}`)
    .join('');
}

/** The branch suffix to render: the explicit stored `branchSuffix` if provided,
 *  otherwise derived from structured `branchParts`. */
function resolveBranchSuffix(membership: PoleMembership): string {
  return membership.branchSuffix !== undefined
    ? membership.branchSuffix
    : formatBranchSuffix(membership.branchParts);
}

/** Render a single membership, e.g. {feeder:'B', index:4, branch:[{1,'A'}]} -> "B 4/1A". */
export function formatMembership(membership: PoleMembership): string {
  const feeder = membership.feeder.trim().toUpperCase();

  return `${feeder} ${membership.index}${resolveBranchSuffix(membership)}`;
}

/**
 * The display token for a feeder LINE: the bare letter for a direct line
 * ("A"), the origin-prefixed form for a line running from a Feeder Pillar or
 * transformer ("FP1 A", "TX2 C"). This is what feeder chips, legends, and
 * reports should print once origin lines are stored as their own Feeder rows.
 */
export function formatFeederLineCode(code: string, origin?: PoleOrigin | null): string {
  const feeder = code.trim().toUpperCase();

  return origin && Number.isInteger(origin.number) && origin.number > 0
    ? `${formatPoleOrigin(origin)} ${feeder}`
    : feeder;
}

/**
 * Render a pole's full NO TIANG RONDAAN from its memberships.
 *
 * Memberships sharing the same (index, branch) collapse into a single
 * letter-run (C + D at index 1 -> "CD 1"); memberships with differing indices
 * are joined by " & " (E 4 & F 2). Output is canonicalised — groups sorted by
 * feeder, then index, then branch — so the rendered string is stable regardless
 * of membership insertion order.
 */
export function formatRondaan(memberships: PoleMembership[]): string {
  const groups = new Map<string, MembershipGroup>();

  for (const membership of memberships) {
    const feeder = membership.feeder.trim().toUpperCase();

    if (!feeder || !Number.isInteger(membership.index) || membership.index <= 0) {
      continue;
    }

    const origin =
      membership.origin !== undefined &&
      Number.isInteger(membership.origin.number) &&
      membership.origin.number > 0
        ? membership.origin
        : undefined;

    const branchSuffix = resolveBranchSuffix(membership);
    // Origin is part of the group identity: `FP1 A 1` and a direct `A 1` are
    // different lines and must never collapse into one letter-run. The
    // separator is the \u0000 ESCAPE, not a raw NUL byte - a literal NUL made
    // this file read as BINARY to grep/ripgrep (same fix as originLineKey in
    // parse.ts).
    const key = `${origin ? formatPoleOrigin(origin) : ''}\u0000${membership.index}${branchSuffix}`;
    const group: MembershipGroup = groups.get(key) ?? {
      index: membership.index,
      branchSuffix,
      feeders: [],
      ...(origin !== undefined ? { origin } : {}),
    };

    if (!group.feeders.includes(feeder)) {
      group.feeders.push(feeder);
    }

    groups.set(key, group);
  }

  const sorted = Array.from(groups.values())
    .map((group) => ({ ...group, feeders: [...group.feeders].sort() }))
    .sort(
      (left, right) =>
        // Bare-line (direct) groups FIRST, then origin lines by token — a
        // stable canonical order, kept from the pre-2026-09 grammar so
        // existing canonical labels don't churn.
        Number(left.origin !== undefined) - Number(right.origin !== undefined) ||
        (left.origin ? formatPoleOrigin(left.origin) : '').localeCompare(
          right.origin ? formatPoleOrigin(right.origin) : '',
        ) ||
        compareGroups(left, right),
    );

  if (sorted.length === 0) {
    return '';
  }

  // EVERY origin segment carries its own prefix — "D 13 & FP1 C 1",
  // "FP1 E 4 & FP1 F 2", "FP1 A 2 & FP2 B 1". The old grammar hoisted a
  // uniform origin to one leading prefix ("FP1 E 4 & F 2"), but that form is
  // indistinguishable from an origin line converging with a DIRECT line — the
  // parser had to guess, and guessed wrong on real field data (SG ULAR JAYA's
  // "FP1 C 1 & D 13"). A bare segment now ALWAYS means the direct line, so
  // the render must spell the origin out on every origin segment.
  return sorted
    .map((group) => {
      const prefix = group.origin !== undefined ? `${formatPoleOrigin(group.origin)} ` : '';

      return `${prefix}${combineFeeders(group.feeders)} ${group.index}${group.branchSuffix}`;
    })
    .join(' & ');
}

/**
 * Suggest the next NO TIANG RONDAAN after `lastCode`, for the field "tag the
 * next pole" helper. It advances each feeder line at its FINEST active level by
 * one, preserving everything above that level and any FP<n> origin:
 *   - a trunk pole bumps its base index ......... "A 4"        -> "A 5"
 *   - feeders on a shared run bump together ..... "CD 2"       -> "CD 3"
 *   - converging feeders advance per feeder ..... "A 4 & B 1"  -> "A 5 & B 2"
 *   - a branch bumps only its DEEPEST level ..... "D 5/1/2/5"  -> "D 5/1/2/6"
 *     (its leg suffix is preserved) ............. "C 4/4/1A"   -> "C 4/4/2A"
 *   - a pole on several lineages walks them all:
 *                              "D 5/1/2 & C 3/4/1" -> "D 5/1/3 & C 3/4/2"
 * The suggestion mirrors the order the crew typed the feeders in (it is NOT
 * canonicalised), so whatever they tag flows straight into the next suggestion.
 * Returns null only when there's nothing safe to advance: an unparseable code,
 * or a partially-mistyped one (so a typo can never silently drop a feeder).
 * Always just a suggestion; callers keep the field editable. Topology forks — a
 * brand-new branch leg, going deeper, or jumping to a sibling — are left for the
 * crew to type and the sequence checker to validate.
 */
export function suggestNextPoleCode(lastCode: string): string | null {
  const parsed = parsePoleCode(lastCode);

  // Suggest only when EVERY segment is well-formed (a partially-mistyped code
  // like "A 4 & garbage" must not silently drop the bad feeder). Segments may
  // sit on different lines (an origin leg converging with a direct leg, or two
  // pillars) — each advances along its OWN line and keeps its own prefix.
  if (parsed.length === 0 || parsed.some((entry) => !entry.isValid)) {
    return null;
  }

  return renderPreservingOrder(parsed.map(advanceToNextPole)) || null;
}

/**
 * Advance one parsed feeder segment to the next pole along its current line: a
 * trunk segment (no branch) bumps its base index; a branch segment keeps its
 * base and upper lineage and bumps only the deepest level, preserving that
 * level's leg suffix.
 */
function advanceToNextPole(entry: ParsedPoleCode): PoleMembership {
  const origin = entry.origin !== undefined ? { origin: entry.origin } : {};
  const deepest = entry.branchParts[entry.branchParts.length - 1];

  if (!deepest) {
    return { feeder: entry.feeder, index: entry.baseNumber + 1, ...origin };
  }

  const branchParts = entry.branchParts.map((part) => ({ ...part }));
  branchParts[branchParts.length - 1] = { ...deepest, number: deepest.number + 1 };

  return { feeder: entry.feeder, index: entry.baseNumber, branchParts, ...origin };
}

/**
 * Render memberships back to a RONDAAN string PRESERVING the order the crew
 * typed them — unlike `formatRondaan`, which canonicalises (sorts) for a stable
 * stored label. Used only by the field suggestion so the offered code mirrors
 * the crew's own sequence. Consecutive feeders that share an (index, branch,
 * origin) still collapse into one letter-run (CD), differing groups join with
 * " & " in encounter order, and each origin segment carries its own prefix (a
 * bare segment is the direct line).
 */
function renderPreservingOrder(memberships: PoleMembership[]): string {
  const groups: MembershipGroup[] = [];

  for (const membership of memberships) {
    const feeder = membership.feeder.trim().toUpperCase();

    if (!feeder || !Number.isInteger(membership.index) || membership.index <= 0) {
      continue;
    }

    const origin =
      membership.origin !== undefined &&
      Number.isInteger(membership.origin.number) &&
      membership.origin.number > 0
        ? membership.origin
        : undefined;
    const branchSuffix = resolveBranchSuffix(membership);
    const last = groups[groups.length - 1];

    if (
      last &&
      last.index === membership.index &&
      last.branchSuffix === branchSuffix &&
      sameOrigin(last.origin, origin)
    ) {
      if (!last.feeders.includes(feeder)) {
        last.feeders.push(feeder);
      }
    } else {
      groups.push({
        index: membership.index,
        branchSuffix,
        feeders: [feeder],
        ...(origin !== undefined ? { origin } : {}),
      });
    }
  }

  return groups
    .map((group) => {
      const prefix = group.origin !== undefined ? `${formatPoleOrigin(group.origin)} ` : '';

      return `${prefix}${combineFeeders(group.feeders)} ${group.index}${group.branchSuffix}`;
    })
    .join(' & ');
}

/** Map a parsed pole code (one feeder segment) to a membership. The backfill
 *  that migrates the legacy assetCode string into stored memberships uses
 *  exactly this. */
export function membershipFromParsed(parsed: ParsedPoleCode): PoleMembership {
  return {
    feeder: parsed.feeder,
    index: parsed.baseNumber,
    branchParts: parsed.branchParts,
    ...(parsed.origin !== undefined ? { origin: parsed.origin } : {}),
  };
}

/** Parse a RONDAAN string into the memberships it encodes (skipping invalid
 *  segments): "E 4 & F 2" -> [{E,4},{F,2}]; "CD 1" -> [{C,1},{D,1}]. */
export function membershipsFromRondaan(input: string): PoleMembership[] {
  return parsePoleCode(input)
    .filter((parsed) => parsed.isValid)
    .map(membershipFromParsed);
}

/**
 * The property the canonical formatter must satisfy: re-rendering the
 * memberships parsed out of a *canonically-ordered* RONDAAN string reproduces
 * that string. (The formatter canonicalises feeder order, so inputs whose
 * feeders are not already in canonical order are expected to differ.)
 */
export function isRondaanRoundTripStable(input: string): boolean {
  const memberships = membershipsFromRondaan(input);

  if (memberships.length === 0) {
    return false;
  }

  return formatRondaan(memberships) === normalizePoleInput(input);
}

/** Combine a group's feeders into the displayed token: single-letter feeders
 *  concatenate into a run ("C","D" -> "CD"); anything unexpected falls back to
 *  an explicit join so nothing is silently dropped. */
function combineFeeders(feeders: string[]): string {
  if (feeders.every((feeder) => SINGLE_LETTER_FEEDER.test(feeder))) {
    return feeders.join('');
  }

  return feeders.join('&');
}

function compareGroups(left: MembershipGroup, right: MembershipGroup): number {
  const feederComparison = (left.feeders[0] ?? '').localeCompare(right.feeders[0] ?? '');

  if (feederComparison !== 0) {
    return feederComparison;
  }

  if (left.index !== right.index) {
    return left.index - right.index;
  }

  return left.branchSuffix.localeCompare(right.branchSuffix);
}
