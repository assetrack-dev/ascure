import { DefectLifecycleStatus } from '@prisma/client';
import {
  returnReasonOf,
  returnStateOf,
  summarizeReturns,
} from '../../src/maintenance-packages/repair-returns.util';

/**
 * Returned repairs (Repair Verification "Returned" tab, 2026-11-16): a return
 * is a timeline entry back to IN_PROGRESS from submitted / closed; the page
 * shows the latest one's reason, who, when, and where the Kejanggalan is now.
 */
describe('returnReasonOf', () => {
  it('takes the text after the actor', () => {
    expect(returnReasonOf('Repair rejected by TNB: poles still overgrown')).toBe('poles still overgrown');
    expect(returnReasonOf('Re-opened by admin: stay wire loose: again')).toBe('stay wire loose: again');
  });

  it('is null when there is no reason', () => {
    expect(returnReasonOf(null)).toBeNull();
    expect(returnReasonOf('Repair rejected by TNB.')).toBeNull();
    expect(returnReasonOf('Repair rejected by TNB:   ')).toBeNull();
  });
});

describe('returnStateOf', () => {
  it.each([
    [DefectLifecycleStatus.IN_PROGRESS, 'WITH_CONTRACTOR'],
    [DefectLifecycleStatus.ASSIGNED, 'WITH_CONTRACTOR'],
    [null, 'WITH_CONTRACTOR'],
    [DefectLifecycleStatus.COMPLETED, 'RESUBMITTED'],
    [DefectLifecycleStatus.VERIFICATION_PENDING, 'RESUBMITTED'],
    [DefectLifecycleStatus.CLOSED, 'CLOSED'],
  ])('%s → %s', (lifecycle, state) => {
    expect(returnStateOf(lifecycle)).toBe(state);
  });
});

describe('summarizeReturns', () => {
  const by = { id: 'u1', name: 'TNB Foreman' };

  it('null when never returned', () => {
    expect(summarizeReturns([])).toBeNull();
  });

  it('uses the newest event and counts them all', () => {
    const summary = summarizeReturns([
      {
        comment: 'Re-opened by TNB: rust is back',
        createdAt: new Date('2026-11-10T02:00:00Z'),
        fromLifecycleStatus: DefectLifecycleStatus.CLOSED,
        createdBy: by,
      },
      {
        comment: 'Repair rejected by TNB: no after photo',
        createdAt: new Date('2026-11-01T02:00:00Z'),
        fromLifecycleStatus: DefectLifecycleStatus.COMPLETED,
        createdBy: by,
      },
    ]);
    expect(summary).toEqual({
      at: '2026-11-10T02:00:00.000Z',
      by,
      reason: 'rust is back',
      kind: 'REOPENED',
      count: 2,
    });
  });

  it('a send-back from submitted is SENT_BACK', () => {
    expect(
      summarizeReturns([
        {
          comment: 'Repair rejected by the main contractor: blurry',
          createdAt: new Date('2026-11-01T02:00:00Z'),
          fromLifecycleStatus: DefectLifecycleStatus.VERIFICATION_PENDING,
          createdBy: null,
        },
      ])?.kind,
    ).toBe('SENT_BACK');
  });
});
