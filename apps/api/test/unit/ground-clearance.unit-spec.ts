import {
  classifySlot,
  generateSpanTargets,
  gradeGroundClearance,
  type GcPoleInput,
} from '../../src/inspections/ground-clearance.util';

/**
 * Auto "TIDAK PATUH GROUND CLEARANCE" — the QR AUTO rule ported to ASCURE
 * (TNB feedback #3). Parity with docs/qr_auto/Kuantan/run_kuantan.py was checked
 * on 1,500 generated Pencawang (25,934 poles): identical TAK PATUH poles.
 */
const ROAD = 'MELINTASI JALAN RAYA';
const SHOULDER = 'BAHU JALAN';
const NO_VEHICLE = 'KAWASAN TIDAK DIMASUKI KENDERAAN';

function pole(code: string, reading = '', terrain = '', extra: Partial<GcPoleInput> = {}): GcPoleInput {
  return {
    key: code,
    code,
    slots: [{ reading, terrain }, { reading: '', terrain: '' }, { reading: '', terrain: '' }],
    umbang: '',
    catatan: '',
    ...extra,
  };
}

const failing = (poles: GcPoleInput[]) =>
  gradeGroundClearance(poles).filter((row) => row.fail).map((row) => row.code);

describe('classifySlot (QR classify_slot)', () => {
  it.each([
    ['5.49', ROAD, 'PATUH'],
    ['5.48', ROAD, 'TAK PATUH'],
    ['5.18', SHOULDER, 'PATUH'],
    ['5.17', 'bahu  jalan', 'TAK PATUH'],
    ['4.57', NO_VEHICLE, 'PATUH'],
    ['4,5', NO_VEHICLE, 'TAK PATUH'],
    ['LO', '', 'TAK PATUH'],
    ['low', ROAD, 'TAK PATUH'],
    ['', ROAD, 'TIADA BACAAN'],
    ['5.6', '', 'TIADA KAWASAN'],
    ['5.6', 'LAIN-LAIN', 'TIADA KAWASAN'],
    ['abc', ROAD, '#ERROR'],
    ['25', ROAD, '#ERROR'],
    ['1.2.3', ROAD, '#ERROR'],
    ['', '', 'EMPTY'],
  ])('%s on %s → %s', (reading, terrain, status) => {
    expect(classifySlot(reading, terrain, 1).status).toBe(status);
  });
});

describe('generateSpanTargets (QR generate_spans, TO side)', () => {
  it('main poles: each span lands on the next pole; the feeder head receives none', () => {
    expect(generateSpanTargets(['1', '2', '3'])).toEqual([
      { to: '2', slot: 1 },
      { to: '3', slot: 1 },
    ]);
  });

  it('a branch pole receives its own span on its branch leg', () => {
    expect(generateSpanTargets(['1', '2', '2/1'])).toEqual([
      { to: '2', slot: 1 },
      { to: '2/1', slot: 1 },
    ]);
  });

  it('a junction is graded twice: the branch leg (slot 1) and the main leg (slot 2)', () => {
    const targets = generateSpanTargets(['B 1', 'B 2', 'B 3', 'B 3/1 & C 2', 'C 1']);
    expect(targets).toEqual(
      expect.arrayContaining([
        { to: 'B 3/1 & C 2', slot: 1 },
        { to: 'B 3/1 & C 2', slot: 2 },
      ]),
    );
  });

  it('feeder-pillar prefixed codes form their own feeder', () => {
    expect(generateSpanTargets(['FP1 1', 'FP1 2'])).toEqual([{ to: 'FP1 2', slot: 1 }]);
  });

  it('terminator poles (/0) produce no span', () => {
    expect(generateSpanTargets(['1', '1/0'])).toEqual([]);
  });
});

describe('gradeGroundClearance', () => {
  it('flags the RECEIVING pole of a failing span, not the feeder head', () => {
    expect(failing([pole('1', '3.0', ROAD), pole('2', '4.0', ROAD), pole('3', '6.0', ROAD)])).toEqual(['2']);
  });

  it('skips support poles and P2P / UG / NO ACCESS remarks', () => {
    expect(
      failing([
        pole('1'),
        pole('2', '3.0', ROAD, { umbang: '1 - UMBANG TERBANG' }),
        pole('3', '3.0', ROAD, { catatan: 'P2P' }),
        pole('4', '3.0', ROAD, { catatan: 'no access' }),
        pole('5', '3.0', ROAD),
      ]),
    ).toEqual(['5']);
  });

  it('an empty second slot inherits slot 1 (parallel line)', () => {
    const junction = pole('B 3/1 & C 2', '4.0', ROAD);
    expect(failing([pole('B 1'), pole('B 2'), pole('B 3'), pole('C 1'), junction])).toEqual(['B 3/1 & C 2']);
  });

  it('a junction main leg is graded on its own slot when it has one', () => {
    const junction = pole('B 3/1 & C 2', '6.0', ROAD);
    junction.slots[1] = { reading: '4.0', terrain: ROAD };
    expect(failing([pole('B 1'), pole('B 2'), pole('B 3'), pole('C 1'), junction])).toEqual(['B 3/1 & C 2']);
    junction.slots[1] = { reading: '5.6', terrain: ROAD };
    expect(failing([pole('B 1'), pole('B 2'), pole('B 3'), pole('C 1'), junction])).toEqual([]);
  });

  it('grades in the QR masterlist order whatever order the poles arrive in', () => {
    const poles = [pole('3', '3.0', ROAD), pole('1'), pole('2', '6.0', ROAD)];
    expect(failing(poles)).toEqual(['3']);
    expect(gradeGroundClearance(poles).map((row) => row.code)).toEqual(['1', '2', '3']);
  });
});
