import {
  formatFeederLineCode,
  formatRondaan,
  isPoleOriginKind,
  type PoleMembership,
  type PoleOrigin,
} from '@ascure/shared-utils';

/**
 * Server-side NO TIANG RONDAAN rendering — north-star §3 "store the structure,
 * render the label". The canonical grammar lives in `@ascure/shared-utils`; this
 * is the thin API-side adapter from stored `PoleFeederMembership` rows to the
 * rendered string.
 */

/** A pole's feeder membership as stored: Feeder line + per-feeder index +
 *  branch. `originKind`/`originNumber` are the Feeder row's power origin
 *  (''/0 sentinel = direct line); optional so pre-origin call sites keep
 *  compiling, rendering as direct when absent. */
export interface StoredMembership {
  sequenceIndex: number;
  branchSuffix: string;
  feeder: { code: string; originKind?: string; originNumber?: number };
}

/** The stored sentinel pair as a grammar origin (undefined = direct line). */
export function feederOrigin(feeder: {
  originKind?: string;
  originNumber?: number;
}): PoleOrigin | undefined {
  return isPoleOriginKind(feeder.originKind)
    ? {
        kind: feeder.originKind,
        number: feeder.originNumber ?? 0,
      }
    : undefined;
}

/** Display token for a stored Feeder line: "A", "FP1 A", "TX2 C". */
export function feederLineCode(feeder: {
  code: string;
  originKind?: string;
  originNumber?: number;
}): string {
  return formatFeederLineCode(feeder.code, feederOrigin(feeder));
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
    memberships.map<PoleMembership>((m) => {
      const origin = feederOrigin(m.feeder);

      return {
        feeder: m.feeder.code,
        index: m.sequenceIndex,
        branchSuffix: m.branchSuffix,
        ...(origin !== undefined ? { origin } : {}),
      };
    }),
  );

  return rendered || null;
}
