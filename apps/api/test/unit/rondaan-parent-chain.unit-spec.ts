import {
  canonicalSegmentsPerFeeder,
  expectedParentKeyChain,
  formatFeederLineCode,
  formatRondaan,
  membershipsFromRondaan,
  parsePoleCode,
} from '@ascure/shared-utils';

/**
 * The expected-parent CHAIN (2026-08-13): every candidate parent key for a
 * pole, nearest first, walked up the grammar's lineage. The fed-from resolvers
 * (assets.service reresolvePencawangParents + the repair script) attach a pole
 * to the FIRST key in this chain that exists in its Pencawang.
 *
 * Pinned because the previous behavior — exact parent, else nearest bare TRUNK
 * pole — drew every child of an unrecorded intermediate pole as a long line
 * straight back to the trunk (the "everything fans back to A 4" field report).
 */

const chainOf = (code: string): string[] => {
  const [parsed] = parsePoleCode(code).filter((entry) => entry.isValid);
  expect(parsed).toBeDefined();
  return expectedParentKeyChain(parsed);
};

describe('rondaan expectedParentKeyChain', () => {
  it('walks a deep branch up its own lineage before ever touching the trunk', () => {
    expect(chainOf('A 4/2/2')).toEqual([
      'A 4/2/1',
      'A 4/2',
      'A 4/1',
      'A 4',
      'A 3',
      'A 2',
      'A 1',
    ]);
  });

  it('a sub-branch pole reaches its junction pole first', () => {
    expect(chainOf('A 4/2/1/1').slice(0, 3)).toEqual(['A 4/2/1', 'A 4/2', 'A 4/1']);
  });

  it('a suffixed sequence decrements WITH its suffix (2A -> 1A), then pops', () => {
    expect(chainOf('A 4/2/2A').slice(0, 3)).toEqual(['A 4/2/1A', 'A 4/2', 'A 4/1']);
  });

  it('a first branch pole pops straight to its junction', () => {
    expect(chainOf('A 4/2/1A').slice(0, 2)).toEqual(['A 4/2', 'A 4/1']);
  });

  it('a trunk pole descends the trunk', () => {
    expect(chainOf('A 5')).toEqual(['A 4', 'A 3', 'A 2', 'A 1']);
  });

  it('the feeder head has no candidates', () => {
    expect(chainOf('A 1')).toEqual([]);
  });

  it('the nearest candidate matches getExpectedParentKey semantics (parser parentKey)', () => {
    const [parsed] = parsePoleCode('B 7/3/2').filter((entry) => entry.isValid);
    expect(expectedParentKeyChain(parsed)[0]).toBe(parsed.parentKey);
  });

  it('an FP/TX origin namespaces every candidate', () => {
    expect(chainOf('FP1 A 4/2').slice(0, 2)).toEqual(['FP1 A 4/1', 'FP1 A 4']);
    expect(chainOf('TX2 B 3')).toEqual(['TX2 B 2', 'TX2 B 1']);
  });
});

/**
 * A code holding TWO positions on the SAME feeder ("B 18 & B 23/5B" — a field
 * loop) can persist only ONE membership row per (asset, feeder). The canonical
 * pick must be deterministic and shared by the live sync AND the repair script:
 * the 2026-08-13 prod repair left 13 such rows oscillating between their two
 * positions on every pass because the writers disagreed.
 */
describe('rondaan canonicalSegmentsPerFeeder', () => {
  const keysOf = (code: string): string[] =>
    canonicalSegmentsPerFeeder(
      parsePoleCode(code).filter((entry) => entry.isValid),
    ).map((entry) => entry.normalizedKey);

  it('keeps the lowest position of a same-feeder loop pole', () => {
    expect(keysOf('B 18 & B 23/5B')).toEqual(['B 18']);
  });

  it('a trunk position beats a branch at the same base', () => {
    expect(keysOf('D 4 & D 4/1')).toEqual(['D 4']);
  });

  it('same base and depth compares the branch lineage', () => {
    expect(keysOf('A 8/2/1 & A 8/1/1')).toEqual(['A 8/1/1']);
  });

  it('different feeders are untouched', () => {
    expect(keysOf('E 4 & F 2')).toEqual(['E 4', 'F 2']);
    expect(keysOf('CD 1')).toEqual(['C 1', 'D 1']);
  });

  it('an origin namespaces the feeder line, so FP1-A and FP2-A both stay', () => {
    expect(keysOf('FP1 A 5 & FP2 A 9')).toEqual(['FP1 A 5', 'FP2 A 9']);
  });
});

/**
 * Origin lines became first-class Feeder rows on 2026-08-13, which makes the
 * formatter's origin handling load-bearing: stored origin memberships render
 * the NO TIANG label, and a wrong render silently renames a pole.
 */
describe('rondaan formatRondaan with origins', () => {
  const roundTrip = (code: string) => formatRondaan(membershipsFromRondaan(code));

  it('renders a display token per feeder line', () => {
    expect(formatFeederLineCode('A')).toBe('A');
    expect(formatFeederLineCode('a', { kind: 'FP', number: 1 })).toBe('FP1 A');
    expect(formatFeederLineCode('C', { kind: 'TX', number: 2 })).toBe('TX2 C');
  });

  it('a uniform origin hoists to ONE leading prefix (canonical)', () => {
    expect(roundTrip('FP1 E 4 & FP1 F 2')).toBe('FP1 E 4 & F 2');
    expect(roundTrip('TX2 B 3')).toBe('TX2 B 3');
  });

  it('MIXED origins prefix per segment and never collapse across lines', () => {
    // Hoisting only the first origin would have rewritten the FP2 segment
    // onto the FP1 line — a silent pole rename.
    expect(roundTrip('FP1 A 2 & FP2 B 1')).toBe('FP1 A 2 & FP2 B 1');
  });

  it('a mixed render leads with the BARE segments so re-parsing cannot poison them', () => {
    // A leading origin token is the parser's default for bare segments — the
    // direct-line segment must render first.
    const rendered = formatRondaan(membershipsFromRondaan('A 9 & FP1 C 1'));
    expect(rendered).toBe('A 9 & FP1 C 1');
    expect(roundTrip(rendered)).toBe(rendered);
  });

  it('an origin line and a direct line with the same letter stay distinct groups', () => {
    const rendered = formatRondaan(membershipsFromRondaan('FP1 A 1 & FP2 A 1'));
    expect(rendered).toBe('FP1 A 1 & FP2 A 1');
  });
});
