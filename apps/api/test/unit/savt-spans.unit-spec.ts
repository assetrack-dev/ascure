import {
  SavtSpanPole,
  computeSavtRouteSpans,
  haversineMetres,
  parseSavtRouteKey,
  savtRouteKey,
  savtSpanFlagText,
} from '../../src/common/savt-spans';

/**
 * SAVT span distances (TNB ask 2026-11-16): GPS distance from each pole to its
 * parent on the same route, with GAP / SHORT / LONG / NO_GPS flags.
 */

// ~1 m of latitude in degrees (1° ≈ 111,195 m on the 6371 km sphere).
const M = 1 / 111_195;

/** A pole `metresNorth` of the origin, on the given route numbering. */
function pole(
  id: string,
  no: number,
  metresNorth: number | null,
  parent: string | null,
  branch = '',
  metresEast = 0,
): SavtSpanPole {
  return {
    assetId: id,
    sequenceIndex: no,
    branchSuffix: branch,
    fedFromAssetId: parent,
    latitude: metresNorth == null ? null : 3 + metresNorth * M,
    longitude: metresNorth == null ? null : 103 + metresEast * M,
  };
}

describe('haversineMetres', () => {
  it('measures a north-south distance in metres', () => {
    expect(haversineMetres(3, 103, 3 + 100 * M, 103)).toBeCloseTo(100, 1);
  });
});

describe('computeSavtRouteSpans', () => {
  it('measures each trunk pole to the one before it; pole 1 has no span', () => {
    const { spans, summary } = computeSavtRouteSpans([
      pole('c', 3, 55, 'b'),
      pole('a', 1, 0, null),
      pole('b', 2, 25, 'a'),
    ]);
    expect(spans.map((s) => [s.fromNoTiang, s.toNoTiang, s.metres, s.flag])).toEqual([
      ['1', '2', 25, null],
      ['2', '3', 30, null],
    ]);
    expect(summary).toMatchObject({
      poleCount: 3,
      spanCount: 2,
      measuredLength: 55,
      medianSpan: 27.5,
      longest: { metres: 30, fromNoTiang: '2', toNoTiang: '3' },
      flaggedCount: 0,
      gapCount: 0,
    });
  });

  it('measures a branch to its trunk pole, not to the previous row', () => {
    const { spans } = computeSavtRouteSpans([
      pole('a', 1, 0, null),
      pole('b', 2, 25, 'a'),
      pole('b1', 2, 25, 'b', '/1', 12),
      pole('c', 3, 50, 'b'),
    ]);
    expect(spans.map((s) => [s.fromNoTiang, s.toNoTiang, s.metres, s.branch])).toEqual([
      ['1', '2', 25, false],
      ['2', '2/1', 12, true],
      ['2', '3', 25, false],
    ]);
  });

  it('flags a No. Tiang jump as a GAP and keeps it out of the route length', () => {
    const { spans, summary } = computeSavtRouteSpans([
      pole('a', 129, 0, null),
      pole('b', 130, 30, 'a'),
      pole('c', 262, 3030, 'b'),
    ]);
    const gap = spans[1];
    expect(gap).toMatchObject({ flag: 'GAP', missing: [131, 261], metres: 3000 });
    expect(savtSpanFlagText(gap)).toBe('GAP - No. Tiang 131-261 not recorded');
    expect(summary).toMatchObject({
      spanCount: 1,
      measuredLength: 30,
      gapCount: 1,
      gapLength: 3000,
      flaggedCount: 1,
    });
  });

  it('flags a branch whose own trunk pole is missing as a GAP', () => {
    const { spans } = computeSavtRouteSpans([
      pole('a', 4, 0, null),
      pole('b', 5, 20, 'a', '/1', 10),
    ]);
    expect(spans[0]).toMatchObject({ flag: 'GAP', missing: [5, 5] });
    expect(savtSpanFlagText(spans[0])).toBe('GAP - No. Tiang 5 not recorded');
  });

  it('flags SHORT (possible duplicate) and LONG (relative to the route median)', () => {
    const poles = [pole('p1', 1, 0, null)];
    let north = 0;
    // Nine normal ~27 m spans, then a 2 m one, then a 300 m one.
    for (let no = 2; no <= 10; no++) {
      north += 27;
      poles.push(pole(`p${no}`, no, north, `p${no - 1}`));
    }
    poles.push(pole('p11', 11, north + 2, 'p10'));
    poles.push(pole('p12', 12, north + 302, 'p11'));
    const { spans, summary } = computeSavtRouteSpans(poles);
    expect(spans.find((s) => s.toNoTiang === '11')?.flag).toBe('SHORT');
    expect(spans.find((s) => s.toNoTiang === '12')?.flag).toBe('LONG');
    expect(spans.filter((s) => s.flag == null)).toHaveLength(9);
    expect(summary.medianSpan).toBe(27);
    // SHORT and LONG are still real measurements — they count in the length.
    expect(summary.spanCount).toBe(11);
    expect(summary.measuredLength).toBe(27 * 9 + 2 + 300);
    expect(summary.longest).toEqual({ metres: 300, fromNoTiang: '11', toNoTiang: '12' });
    expect(summary.flaggedCount).toBe(2);
  });

  it('does not flag a long span on a route whose spans are all long', () => {
    const { spans } = computeSavtRouteSpans([
      pole('a', 1, 0, null),
      pole('b', 2, 70, 'a'),
      pole('c', 3, 145, 'b'),
      pole('d', 4, 225, 'c'),
    ]);
    expect(spans.every((s) => s.flag == null)).toBe(true);
  });

  it('gives no number and a NO_GPS flag when either end has no fix (incl. 0,0)', () => {
    const zero: SavtSpanPole = { ...pole('c', 3, 0, 'b'), latitude: 0, longitude: 0 };
    const { spans, summary } = computeSavtRouteSpans([
      pole('a', 1, 0, null),
      pole('b', 2, null, 'a'),
      zero,
    ]);
    expect(spans.map((s) => [s.metres, s.flag])).toEqual([
      [null, 'NO_GPS'],
      [null, 'NO_GPS'],
    ]);
    expect(summary).toMatchObject({ spanCount: 0, measuredLength: 0, noGpsCount: 2, longest: null });
  });

  it('skips a pole whose parent is not on this route', () => {
    const { spans } = computeSavtRouteSpans([pole('b', 2, 25, 'gone')]);
    expect(spans).toEqual([]);
  });
});

describe('SAVT route key', () => {
  const owner = '0b6f6c9e-2b36-4f8e-9a6d-7d2a4c1e9f10';

  it('round-trips owner Pencawang + KOD TIANG', () => {
    const key = savtRouteKey(owner, 'TK - KC');
    expect(key).toBe(`${owner}:TK - KC`);
    expect(parseSavtRouteKey(key)).toEqual({ ownerSubstationId: owner, routeCode: 'TK - KC' });
  });

  it('treats a bare code (old links) as code-only', () => {
    expect(savtRouteKey(null, 'TK')).toBe('TK');
    expect(parseSavtRouteKey(' TK ')).toEqual({ ownerSubstationId: null, routeCode: 'TK' });
    // A code that itself contains ":" is not mistaken for a key.
    expect(parseSavtRouteKey('A:B')).toEqual({ ownerSubstationId: null, routeCode: 'A:B' });
  });
});
