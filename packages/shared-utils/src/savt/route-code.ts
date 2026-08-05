/** Every unicode dash a crew's keyboard can produce for the KOD TIANG separator. */
const DASH_VARIANTS = /[‐‑‒–—―−]/g;

/**
 * Canonicalize a KOD TIANG route code so equal routes compare equal:
 * uppercase, single internal spaces, unicode dashes to "-", and exactly one
 * space around each dash ("MI-KUK", "MI – KUK", "mi -  kuk" -> "MI - KUK").
 *
 * Note this also spaces a dash INSIDE a Pencawang code ("SG-BULOH - KK" ->
 * "SG - BULOH - KK"). That changes such a label, but changes it the same way
 * for every writer — and identity-key equality is what matters here.
 *
 * Returns null for blank input.
 */
export function canonicalizeSavtRouteCode(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const canonical = value
    .replace(DASH_VARIANTS, '-')
    .toUpperCase()
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  return canonical.length > 0 ? canonical : null;
}

/** The KOD TIANG for a route is derived, not typed: `{from} - {to}`. */
export function composeSavtRouteCode(
  fromPencawangCode: string | null | undefined,
  toPencawangCode: string | null | undefined,
): string | null {
  const from = canonicalizeSavtRouteCode(fromPencawangCode);
  const to = canonicalizeSavtRouteCode(toPencawangCode);

  if (!from || !to) {
    return null;
  }

  return `${from} - ${to}`;
}

export interface SavtPoleIdentity {
  /** The trunk pole number on the route (membership sequenceIndex). */
  noTiang: number;
  /** Branch tail after the trunk number, e.g. "/1"; "" on the trunk itself. */
  branchSuffix: string;
}

/**
 * Split a SAVT pole code into its route-local identity, given the route it is
 * being read against: `"MI - KUK 33/1"` on route `"MI - KUK"` ->
 * `{ noTiang: 33, branchSuffix: "/1" }`. Both sides are canonicalized first,
 * so a legacy code typed as "MI-KUK 33/1" still parses. Returns null when the
 * code is not on the route or has no leading trunk number.
 */
export function parseSavtPoleCode(
  assetCode: string | null | undefined,
  routeCode: string | null | undefined,
): SavtPoleIdentity | null {
  const canonicalCode = canonicalizeSavtRouteCode(assetCode);
  const canonicalRoute = canonicalizeSavtRouteCode(routeCode);

  if (!canonicalCode || !canonicalRoute) {
    return null;
  }

  const prefix = `${canonicalRoute} `;

  if (!canonicalCode.startsWith(prefix)) {
    return null;
  }

  const match = canonicalCode.slice(prefix.length).match(/^(\d+)(.*)$/);

  if (!match) {
    return null;
  }

  return {
    noTiang: Number.parseInt(match[1], 10),
    branchSuffix: match[2].trim(),
  };
}

/** Render a pole's code ON a given route: `"MI - KUK" + 33 + "/1"` -> `"MI - KUK 33/1"`. */
export function composeSavtPoleCode(
  routeCode: string,
  noTiang: number,
  branchSuffix = '',
): string {
  return `${routeCode} ${noTiang}${branchSuffix}`;
}
