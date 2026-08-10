import {
  formatRondaan,
  membershipsFromRondaan,
  normalizePoleInput,
  parsePoleCode,
  suggestNextPoleCode,
  validateFeederSequences,
} from '@ascure/shared-utils';

/**
 * NO TIANG RONDAAN power-origin grammar (`FP<n>` Feeder Pillar, `TX<n>` a
 * specific outgoing transformer).
 *
 * TX was added 2026-08-10: a Pencawang with more than one outgoing transformer
 * needs each feeder attributed to the right one, and crews typing "TX1 A 1" were
 * being rejected as "Bad pole-number format". TX is a sibling of FP, not a
 * special case — these tests pin BOTH so the two can never drift, and pin the
 * bare-letter readings (`FP 1` = feeders F&P, `TX 1` = feeders T&X) that the
 * origin grammar must not swallow.
 *
 * ⚠ This module had NO test coverage before this file, despite being the single
 * source of truth for pole numbering across API, mobile and admin.
 */

const parseOne = (code: string) => {
  const [first] = parsePoleCode(code);
  return first;
};

describe('rondaan power origin — FP and TX', () => {
  describe('accepts an origin prefix, spaced or not', () => {
    it.each([
      ['TX1 A 1', 'TX', 1],
      ['TX 1 A 1', 'TX', 1],
      ['tx2 a 3', 'TX', 2],
      ['FP1 A 1', 'FP', 1],
      ['FP 1 A 1', 'FP', 1],
      ['TX10 AB 7', 'TX', 10],
    ])('%s -> %s%s', (code, kind, number) => {
      const parsed = parseOne(code);
      expect(parsed.isValid).toBe(true);
      expect(parsed.origin).toEqual({ kind, number });
    });

    // The exact codes from the owner's screenshot that were being rejected.
    it.each(['TX 1 A 1', 'TX 1 A 2', 'TX 1 A 3', 'TX 1 A 3/1', 'TX 1 A 3/2', 'TX 1 A 4'])(
      'the reported field code %s is valid',
      (code) => {
        expect(parseOne(code).isValid).toBe(true);
      },
    );
  });

  describe('an origin namespaces the feeder line', () => {
    it('TX1, FP1 and a direct pole are three different keys', () => {
      const keys = ['TX1 A 1', 'FP1 A 1', 'A 1'].map((c) => parseOne(c).normalizedKey);
      expect(new Set(keys).size).toBe(3);
    });

    it('TX1 A 1 and TX2 A 1 are different poles', () => {
      expect(parseOne('TX1 A 1').normalizedKey).not.toBe(parseOne('TX2 A 1').normalizedKey);
    });

    it('so two lines can each start at 1 without a duplicate or a gap', () => {
      const assets = [
        { id: '1', noTiangRondaan: 'TX1 A 1' },
        { id: '2', noTiangRondaan: 'TX1 A 2' },
        { id: '3', noTiangRondaan: 'TX2 A 1' },
        { id: '4', noTiangRondaan: 'TX2 A 2' },
      ];
      const result = validateFeederSequences(assets);
      expect(result.issues).toEqual([]);
      expect(result.isValid).toBe(true);
    });

    it('and a gap INSIDE one transformer line is still caught', () => {
      const result = validateFeederSequences([
        { id: '1', noTiangRondaan: 'TX1 A 1' },
        { id: '2', noTiangRondaan: 'TX1 A 3' },
      ]);
      expect(result.issues.map((issue) => issue.type)).toContain(
        'MISSING_PREVIOUS_BASE_SEQUENCE',
      );
    });
  });

  describe('round-trips through the formatter', () => {
    it.each(['TX1 A 1', 'FP2 B 4/1A', 'TX3 CD 2'])('%s renders back to itself', (code) => {
      expect(formatRondaan(membershipsFromRondaan(code))).toBe(code);
    });

    it('the origin is prefixed ONCE across converging feeders', () => {
      expect(formatRondaan(membershipsFromRondaan('TX1 E 4 & F 2'))).toBe('TX1 E 4 & F 2');
    });
  });

  describe('the next-pole suggestion carries the origin', () => {
    it.each([
      ['TX1 A 4', 'TX1 A 5'],
      ['FP1 A 4', 'FP1 A 5'],
      ['TX2 D 5/1/2', 'TX2 D 5/1/3'],
    ])('%s -> %s', (from, to) => {
      expect(suggestNextPoleCode(from)).toBe(to);
    });

    // Regression: origins became objects, so an `===` identity check here would
    // reject every multi-segment code. Must compare by value.
    it('still suggests across converging feeders that share one origin', () => {
      expect(suggestNextPoleCode('TX1 A 4 & B 1')).toBe('TX1 A 5 & B 2');
    });
  });

  describe('does not swallow the ordinary feeder grammar', () => {
    // "FP 1" with no feeder line after it is feeders F and P at index 1 — the
    // origin reading must not steal it. Same for T and X.
    it.each([
      ['FP 1', ['F', 'P']],
      ['TX 1', ['T', 'X']],
    ])('%s is a bare feeder run, not an origin', (code, feeders) => {
      const parsed = parsePoleCode(code);
      expect(parsed.every((entry) => entry.isValid)).toBe(true);
      expect(parsed.every((entry) => entry.origin === undefined)).toBe(true);
      expect(parsed.map((entry) => entry.feeder)).toEqual(feeders);
    });

    it('normalization leaves a bare FP 1 / TX 1 alone', () => {
      expect(normalizePoleInput('FP 1')).toBe('FP 1');
      expect(normalizePoleInput('TX 1')).toBe('TX 1');
    });

    it('but collapses the prefix form to canonical', () => {
      expect(normalizePoleInput('TX 1 A 1')).toBe('TX1 A 1');
      expect(normalizePoleInput('FP 2 B 3')).toBe('FP2 B 3');
    });

    // ⚠ `TX1` with NOTHING after it is feeders T and X at index 1 — an origin
    // token only becomes an origin when it prefixes an actual feeder line. Same
    // has always been true of `FP1`. Pinned because it looks like a bug and is
    // not: the origin reading must stay the narrower one.
    it('a bare TX1 / FP1 is a feeder run at index 1, not a dangling origin', () => {
      for (const code of ['TX1', 'FP1']) {
        const parsed = parsePoleCode(code);
        expect(parsed.every((entry) => entry.isValid)).toBe(true);
        expect(parsed.every((entry) => entry.origin === undefined)).toBe(true);
        expect(parsed.map((entry) => entry.baseNumber)).toEqual([1, 1]);
      }
    });

    it('a genuinely malformed code is still rejected', () => {
      // An origin with no index after the feeder letter.
      expect(parseOne('TX1 A').isValid).toBe(false);
      // Zero is not a valid origin number, so this is not read as an origin.
      expect(parseOne('TX0 A 1').origin).toBeUndefined();
    });
  });
});
