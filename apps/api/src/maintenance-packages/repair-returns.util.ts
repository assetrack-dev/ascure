import { DefectLifecycleStatus, Prisma } from '@prisma/client';

/**
 * A "return" = TNB / the main contractor sent a submitted repair back to the
 * crew (reject) or re-opened a closed one. Neither leaves a mark on the Defect
 * row itself (it just goes back to IN_PROGRESS), so the timeline entry is the
 * record: shared by Repair Verification's Returned tab and "My tasks".
 */
export const SUBMITTED_LIFECYCLES: DefectLifecycleStatus[] = [
  DefectLifecycleStatus.COMPLETED,
  DefectLifecycleStatus.VERIFICATION_PENDING,
];

/** Back to work from submitted (sent back) or from closed (re-opened). */
export const RETURNED_FROM: DefectLifecycleStatus[] = [
  ...SUBMITTED_LIFECYCLES,
  DefectLifecycleStatus.CLOSED,
];

export const RETURN_EVENT_WHERE = {
  toLifecycleStatus: DefectLifecycleStatus.IN_PROGRESS,
  fromLifecycleStatus: { in: RETURNED_FROM },
} satisfies Prisma.DefectTimelineEntryWhereInput;

/** SQL twin of RETURN_EVENT_WHERE for a "DefectTimelineEntry" aliased `e`. */
export const RETURN_EVENT_SQL = Prisma.sql`e."toLifecycleStatus" = 'IN_PROGRESS'
  AND e."fromLifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING', 'CLOSED')`;

/** "Repair rejected by TNB: poles still overgrown" → "poles still overgrown". */
export function returnReasonOf(comment: string | null): string | null {
  if (!comment) return null;
  const at = comment.indexOf(': ');
  return at >= 0 ? comment.slice(at + 2).trim() || null : null;
}

/**
 * Where a returned Kejanggalan stands now (the Returned tab's state chips):
 *  - WITH_CONTRACTOR  back with the crew, not re-submitted yet
 *  - RESUBMITTED      the crew marked it done again — waiting for verification
 *  - CLOSED           closed after the return (verified, or closed as not repairable)
 */
export const RETURN_STATES = ['WITH_CONTRACTOR', 'RESUBMITTED', 'CLOSED'] as const;
export type ReturnState = (typeof RETURN_STATES)[number];

export function returnStateOf(lifecycleStatus: DefectLifecycleStatus | null): ReturnState {
  if (lifecycleStatus === DefectLifecycleStatus.CLOSED) return 'CLOSED';
  if (lifecycleStatus && SUBMITTED_LIFECYCLES.includes(lifecycleStatus)) return 'RESUBMITTED';
  return 'WITH_CONTRACTOR';
}

/** Prisma filter for one state (lifecycle only — combine with the returned filter). */
export function returnStateWhere(state: ReturnState): Prisma.DefectWhereInput {
  if (state === 'CLOSED') return { lifecycleStatus: DefectLifecycleStatus.CLOSED };
  if (state === 'RESUBMITTED') return { lifecycleStatus: { in: SUBMITTED_LIFECYCLES } };
  return {
    OR: [
      { lifecycleStatus: null },
      { lifecycleStatus: { notIn: [...SUBMITTED_LIFECYCLES, DefectLifecycleStatus.CLOSED] } },
    ],
  };
}

/** SQL twin of returnStateWhere for a "Defect" aliased `d`. */
export function returnStateSql(state: ReturnState): Prisma.Sql {
  if (state === 'CLOSED') return Prisma.sql`d."lifecycleStatus" = 'CLOSED'`;
  if (state === 'RESUBMITTED') {
    return Prisma.sql`d."lifecycleStatus" IN ('COMPLETED', 'VERIFICATION_PENDING')`;
  }
  return Prisma.sql`(d."lifecycleStatus" IS NULL
    OR d."lifecycleStatus" NOT IN ('COMPLETED', 'VERIFICATION_PENDING', 'CLOSED'))`;
}

export type ReturnEvent = {
  comment: string | null;
  createdAt: Date;
  fromLifecycleStatus: DefectLifecycleStatus | null;
  createdBy: { id: string; name: string } | null;
};

/** The latest return (events newest first) as the page shows it. */
export function summarizeReturns(events: ReturnEvent[]) {
  const last = events[0];
  if (!last) return null;
  return {
    at: last.createdAt.toISOString(),
    by: last.createdBy,
    reason: returnReasonOf(last.comment),
    kind: last.fromLifecycleStatus === DefectLifecycleStatus.CLOSED ? ('REOPENED' as const) : ('SENT_BACK' as const),
    count: events.length,
  };
}
