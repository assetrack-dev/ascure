import { formatRondaan, type PoleMembership } from '@ascure/shared-utils';

/**
 * Server-side NO TIANG RONDAAN rendering — north-star §3 "store the structure,
 * render the label". The canonical grammar lives in `@ascure/shared-utils`; this
 * is the thin API-side adapter from stored `PoleFeederMembership` rows to the
 * rendered string.
 */

/** A pole's feeder membership as stored: Feeder.code + per-feeder index + branch. */
export interface StoredMembership {
  sequenceIndex: number;
  branchSuffix: string;
  feeder: { code: string };
}

/**
 * Render a pole's NO TIANG RONDAAN from its stored memberships. Returns `null`
 * when the pole has no memberships yet (e.g. not backfilled / structure not
 * captured), so callers can fall back to the legacy `assetCode` mirror.
 */
export function renderNoTiangRondaan(
  memberships: StoredMembership[] | null | undefined,
): string | null {
  if (!memberships || memberships.length === 0) {
    return null;
  }

  const rendered = formatRondaan(
    memberships.map<PoleMembership>((m) => ({
      feeder: m.feeder.code,
      index: m.sequenceIndex,
      branchSuffix: m.branchSuffix,
    })),
  );

  return rendered || null;
}
