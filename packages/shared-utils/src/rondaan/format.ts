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

import type { ParsedPoleCode, PoleBranchPart } from './parse';
import { normalizePoleInput, parsePoleCode } from './parse';

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
}

interface MembershipGroup {
  index: number;
  branchSuffix: string;
  feeders: string[];
}

const SINGLE_LETTER_FEEDER = /^[A-Z]$/;

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

    const branchSuffix = resolveBranchSuffix(membership);
    const key = `${membership.index}${branchSuffix}`;
    const group = groups.get(key) ?? { index: membership.index, branchSuffix, feeders: [] };

    if (!group.feeders.includes(feeder)) {
      group.feeders.push(feeder);
    }

    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => ({ ...group, feeders: [...group.feeders].sort() }))
    .sort(compareGroups)
    .map((group) => `${combineFeeders(group.feeders)} ${group.index}${group.branchSuffix}`)
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
