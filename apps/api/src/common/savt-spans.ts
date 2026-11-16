/**
 * SAVT cable span distances (TNB ask 2026-11-16). Pure, no Nest/Prisma wiring.
 *
 * No span length is captured in the field: the SAVT checklist has only a span
 * PHOTO and the KELEGAAN clearance reading. So a span is the straight-line GPS
 * distance between a pole and its PARENT ON THE SAME ROUTE
 * (`PoleFeederMembership.fedFromAssetId`): trunk pole N → the nearest lower
 * trunk pole, a branch (`/1`) → its trunk pole. Using the stored parent (not
 * "the previous row") means branches measure to their trunk pole and a shared
 * pole gets one span per route it carries.
 *
 * Each span gets at most one flag (most serious first):
 *  - NO_GPS  either end has no usable fix → no number
 *  - GAP     the No. Tiang jumps (130 → 262): a straight line over poles
 *            nobody surveyed — shown, but kept out of the route length
 *  - SHORT   under 5 m → possibly the same pole added twice
 *  - LONG    over 60 m AND over 2.5 × the route's median span → check the GPS
 *            or the numbering
 *
 * Pole 1 has no span: the From Pencawang has no stored coordinates.
 */

export const SPAN_SHORT_METRES = 5;
export const SPAN_LONG_MIN_METRES = 60;
export const SPAN_LONG_MEDIAN_FACTOR = 2.5;

export type SavtSpanFlag = 'NO_GPS' | 'GAP' | 'SHORT' | 'LONG';

export interface SavtSpanPole {
  assetId: string;
  /** No. Tiang on THIS route. */
  sequenceIndex: number;
  /** '' for a trunk pole, '/1' etc. for a branch. */
  branchSuffix: string;
  /** The parent pole on THIS route; null for pole 1 / the head. */
  fedFromAssetId: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SavtSpan {
  fromAssetId: string;
  toAssetId: string;
  /** "12", "12/1" — this route's numbering. */
  fromNoTiang: string;
  toNoTiang: string;
  /** Straight-line metres, 1 dp; null when either end has no GPS. */
  metres: number | null;
  /** A branch pole measured to its trunk pole. */
  branch: boolean;
  flag: SavtSpanFlag | null;
  /** GAP only: the No. Tiang range nobody recorded, e.g. [131, 261]. */
  missing: [number, number] | null;
}

export interface SavtSpanSummary {
  poleCount: number;
  /** Measured spans (everything except GAP and NO_GPS). */
  spanCount: number;
  /** Sum of the measured spans, metres, 1 dp. */
  measuredLength: number;
  /** Median of the measured trunk spans; null when there are none. */
  medianSpan: number | null;
  longest: { metres: number; fromNoTiang: string; toNoTiang: string } | null;
  /** Spans with any flag. */
  flaggedCount: number;
  gapCount: number;
  /** Straight-line metres across the gaps (under-reads the real cable). */
  gapLength: number;
  noGpsCount: number;
}

export interface SavtRouteSpans {
  spans: SavtSpan[];
  summary: SavtSpanSummary;
}

const EARTH_RADIUS_METRES = 6_371_000;

/** Great-circle distance in metres. */
export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A usable fix: both numbers present, finite, and not the 0,0 placeholder. */
function hasFix(pole: SavtSpanPole): boolean {
  const { latitude: lat, longitude: lng } = pole;
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function noTiangLabel(pole: Pick<SavtSpanPole, 'sequenceIndex' | 'branchSuffix'>): string {
  return `${pole.sequenceIndex}${pole.branchSuffix}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Order poles along the route: No. Tiang, branches right after their trunk. */
export function compareNoTiang(
  a: Pick<SavtSpanPole, 'sequenceIndex' | 'branchSuffix'>,
  b: Pick<SavtSpanPole, 'sequenceIndex' | 'branchSuffix'>,
): number {
  return (
    a.sequenceIndex - b.sequenceIndex ||
    a.branchSuffix.localeCompare(b.branchSuffix, undefined, { numeric: true })
  );
}

/**
 * Every span on ONE route (the poles of one SAVT Feeder), ordered by the TO
 * pole's No. Tiang, plus the route totals.
 */
export function computeSavtRouteSpans(poles: SavtSpanPole[]): SavtRouteSpans {
  const byId = new Map(poles.map((pole) => [pole.assetId, pole]));
  const ordered = [...poles].sort(compareNoTiang);

  // Pass 1: geometry + the flags that don't depend on the route median.
  const spans: SavtSpan[] = [];
  for (const to of ordered) {
    const from = to.fedFromAssetId ? byId.get(to.fedFromAssetId) : undefined;
    if (!from) {
      continue; // pole 1, or a parent that is no longer on the route
    }
    const branch = to.branchSuffix.length > 0;
    // A branch hangs off the trunk pole with the same number; a trunk pole
    // follows N-1. Anything lower means poles in between were never recorded.
    const expectedParent = branch ? to.sequenceIndex : to.sequenceIndex - 1;
    const missing: [number, number] | null =
      from.sequenceIndex < expectedParent
        ? [from.sequenceIndex + 1, expectedParent]
        : null;
    const metres =
      hasFix(from) && hasFix(to)
        ? round1(
            haversineMetres(
              from.latitude as number,
              from.longitude as number,
              to.latitude as number,
              to.longitude as number,
            ),
          )
        : null;
    let flag: SavtSpanFlag | null = null;
    if (metres == null) {
      flag = 'NO_GPS';
    } else if (missing) {
      flag = 'GAP';
    } else if (metres < SPAN_SHORT_METRES) {
      flag = 'SHORT';
    }
    spans.push({
      fromAssetId: from.assetId,
      toAssetId: to.assetId,
      fromNoTiang: noTiangLabel(from),
      toNoTiang: noTiangLabel(to),
      metres,
      branch,
      flag,
      missing,
    });
  }

  // Pass 2: LONG is relative to this route's typical trunk span.
  const medianSpan = median(
    spans
      .filter((span) => !span.branch && span.flag == null)
      .map((span) => span.metres as number),
  );
  for (const span of spans) {
    if (
      span.flag == null &&
      span.metres != null &&
      span.metres > SPAN_LONG_MIN_METRES &&
      (medianSpan == null || span.metres > SPAN_LONG_MEDIAN_FACTOR * medianSpan)
    ) {
      span.flag = 'LONG';
    }
  }

  const measured = spans.filter(
    (span) => span.flag !== 'GAP' && span.flag !== 'NO_GPS',
  );
  const gaps = spans.filter((span) => span.flag === 'GAP');
  let longest: SavtSpanSummary['longest'] = null;
  for (const span of measured) {
    if (!longest || (span.metres as number) > longest.metres) {
      longest = {
        metres: span.metres as number,
        fromNoTiang: span.fromNoTiang,
        toNoTiang: span.toNoTiang,
      };
    }
  }

  return {
    spans,
    summary: {
      poleCount: poles.length,
      spanCount: measured.length,
      measuredLength: round1(
        measured.reduce((sum, span) => sum + (span.metres as number), 0),
      ),
      medianSpan: medianSpan == null ? null : round1(medianSpan),
      longest,
      flaggedCount: spans.filter((span) => span.flag != null).length,
      gapCount: gaps.length,
      gapLength: round1(gaps.reduce((sum, span) => sum + (span.metres as number), 0)),
      noGpsCount: spans.filter((span) => span.flag === 'NO_GPS').length,
    },
  };
}

/** The export's SEMAKAN SPAN text for a flagged span (blank when fine). */
export function savtSpanFlagText(span: Pick<SavtSpan, 'flag' | 'missing'>): string {
  switch (span.flag) {
    case 'NO_GPS':
      return 'NO GPS - span not measured';
    case 'GAP':
      return span.missing
        ? `GAP - No. Tiang ${span.missing[0] === span.missing[1] ? span.missing[0] : `${span.missing[0]}-${span.missing[1]}`} not recorded`
        : 'GAP - No. Tiang not in sequence';
    case 'SHORT':
      return 'SHORT - possible duplicate pole';
    case 'LONG':
      return 'LONG - check GPS / numbering';
    default:
      return '';
  }
}

/**
 * A SAVT route is a Feeder owned by its From Pencawang with code = KOD TIANG;
 * the code alone is NOT unique (TK, KC, PBA… each name two lines). Reports key a
 * route by both: "<owner substation id>:<KOD TIANG>". A bare code (old links,
 * visits with no Pencawang) still works and matches by code only.
 */
export function savtRouteKey(ownerSubstationId: string | null, routeCode: string): string {
  return ownerSubstationId ? `${ownerSubstationId}:${routeCode}` : routeCode;
}

const UUID_PREFIX = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.*)$/i;

export function parseSavtRouteKey(key: string): {
  ownerSubstationId: string | null;
  routeCode: string;
} {
  const trimmed = key.trim();
  const match = UUID_PREFIX.exec(trimmed);
  return match
    ? { ownerSubstationId: match[1].toLowerCase(), routeCode: match[2].trim() }
    : { ownerSubstationId: null, routeCode: trimmed };
}
