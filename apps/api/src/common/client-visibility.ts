import { SurveyLifecycleStatus } from '@prisma/client';

/**
 * Survey states whose EVIDENCE a client (network owner) may see. The crew has
 * finished walking the survey and handed it on, so what the client reads is
 * settled work rather than a pole half-captured in the field.
 *
 * ⚠ DALAM_RONDAAN (still being walked) is deliberately absent, and a visit with
 * NO lifecycle status is treated as in-progress — `in:` never matches null.
 *
 * ⚠ SINGLE SOURCE OF TRUTH. Both the client progress view and the asset-detail
 * read gate filter on this; if they diverge, one path leaks work-in-progress
 * that the other hides.
 */
export const CLIENT_VISIBLE_LIFECYCLE: SurveyLifecycleStatus[] = [
  SurveyLifecycleStatus.RONDAAN_SELESAI,
  SurveyLifecycleStatus.DISAHKAN_PENGURUS,
  SurveyLifecycleStatus.PERLU_PINDAAN,
  SurveyLifecycleStatus.PINDAAN_SELESAI,
  SurveyLifecycleStatus.LAPORAN_SELESAI,
  SurveyLifecycleStatus.ARKIB,
];
