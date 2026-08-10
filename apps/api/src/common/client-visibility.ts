import { SurveyLifecycleStatus } from '@prisma/client';

/**
 * Survey states that mean the crew has LEFT THE FIELD and handed the work on.
 *
 * ⚠ HISTORY — this list used to be a client VISIBILITY GATE: a client (network
 * owner) could only read poles and surveys that had reached one of these
 * states, so nothing half-captured ever reached them. The owner reversed that
 * on 2026-08-10: TNB now sees EVERY survey in their assigned Mainheads at every
 * status, work still in the field included.
 *
 * The list survives as a LABEL rather than a filter — it tells the client view
 * which surveys are settled and which are still moving, so in-field work is
 * MARKED rather than hidden. Scope (which Mainheads) is still enforced, and
 * still fails closed; only the lifecycle gate is gone.
 *
 * ⚠ DALAM_RONDAAN (still being walked) is deliberately absent, and a visit with
 * NO lifecycle status counts as in-field — `includes` never matches null.
 */
export const SURVEY_FINISHED_LIFECYCLE: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.RONDAAN_SELESAI,
  SurveyLifecycleStatus.DISAHKAN_PENGURUS,
  SurveyLifecycleStatus.PERLU_PINDAAN,
  SurveyLifecycleStatus.PINDAAN_SELESAI,
  SurveyLifecycleStatus.LAPORAN_SELESAI,
  SurveyLifecycleStatus.ARKIB,
];

/** True once the survey has left the field. Null (never advanced) = in field. */
export function isSurveyFinished(
  status: SurveyLifecycleStatus | null | undefined,
): boolean {
  return status != null && SURVEY_FINISHED_LIFECYCLE.includes(status);
}
