import { expectedParentKeyChain, parsePoleCode } from '@ascure/shared-utils';

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
