/**
 * The single, canonical "what status do we SHOW the user" for a site visit —
 * shared by the API (attaches it to every visit payload), mobile, and admin so
 * the list, the detail, and the phone all read the same word for the same visit.
 *
 * Two DB enums drive the real logic and stay as-is:
 *  - operational `SiteVisitStatus` (OPEN/IN_PROGRESS/ACTIVE/COMPLETED/CANCELLED)
 *  - review `SurveyLifecycleStatus` (DALAM_RONDAAN … ARKIB)
 * They track overlapping stages, which is why raw "Completed" (crew finished)
 * used to contradict "Dalam Rondaan" (still under review). This collapses both
 * into ONE user-facing vocabulary, driven mainly by the (richer) review
 * lifecycle and falling back to the operational status before the lifecycle
 * starts. "Completed" here means the SURVEY is done (report generated), not the
 * moment the crew submits.
 */

/** Operational status values (mirror of Prisma `SiteVisitStatus`; kept as a
 *  string union so this package stays free of a Prisma dependency). */
export type VisitOperationalStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

/** Review lifecycle values (mirror of Prisma `SurveyLifecycleStatus`). */
export type VisitLifecycleStatus =
  | 'DALAM_RONDAAN'
  | 'RONDAAN_SELESAI'
  | 'DISAHKAN_PENGURUS'
  | 'PERLU_PINDAAN'
  | 'PINDAAN_SELESAI'
  | 'LAPORAN_SELESAI'
  | 'ARKIB';

/** The one user-facing status set (north-star: one word per visit, everywhere). */
export type DisplayStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'NEEDS_AMENDMENT'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'ARCHIVED'
  | 'CANCELLED';

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  NEEDS_AMENDMENT: 'Needs Amendment',
  IN_REVIEW: 'In Review',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
};

/** Stable display order (badges, filters, grouped queues) from earliest → done. */
export const DISPLAY_STATUS_ORDER: DisplayStatus[] = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'NEEDS_AMENDMENT',
  'IN_REVIEW',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];

/**
 * Collapse the operational + review states into the one shown status.
 * Precedence: CANCELLED overrides all; otherwise the review lifecycle decides;
 * before any lifecycle exists (freshly created / legacy visits) the operational
 * status fills in.
 */
export function deriveDisplayStatus(
  operationalStatus: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): DisplayStatus {
  // A cancelled visit reads "Cancelled" regardless of where its review sat.
  if (operationalStatus === 'CANCELLED') {
    return 'CANCELLED';
  }

  switch (lifecycleStatus) {
    case 'ARKIB':
      return 'ARCHIVED';
    case 'LAPORAN_SELESAI':
      return 'COMPLETED';
    case 'PERLU_PINDAAN':
      return 'NEEDS_AMENDMENT';
    case 'RONDAAN_SELESAI':
    case 'PINDAAN_SELESAI':
    case 'DISAHKAN_PENGURUS':
      return 'IN_REVIEW';
    case 'DALAM_RONDAAN':
      return 'IN_PROGRESS';
    default:
      break; // null / unrecognised → fall back to the operational status
  }

  switch (operationalStatus) {
    case 'IN_PROGRESS':
    case 'ACTIVE':
      return 'IN_PROGRESS';
    // A completed visit with no lifecycle row is a pre-lifecycle legacy survey;
    // treat the crew's completion as done.
    case 'COMPLETED':
      return 'COMPLETED';
    case 'OPEN':
    default:
      return 'NOT_STARTED';
  }
}

export function displayStatusLabel(
  operationalStatus: string | null | undefined,
  lifecycleStatus: string | null | undefined,
): string {
  return DISPLAY_STATUS_LABEL[deriveDisplayStatus(operationalStatus, lifecycleStatus)];
}
