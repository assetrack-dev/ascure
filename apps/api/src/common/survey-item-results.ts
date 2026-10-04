import { InspectionItemResultSource, Prisma } from '@prisma/client';

/**
 * An inspection's own checklist answers. A Kejanggalan added during maintenance
 * (docs/PLAN-maintenance-flow.md §13) is stored as an extra item result on the
 * pole's survey inspection with source = MAINTENANCE_FINDING; every survey
 * output (Laporan Kejanggalan, checklist / QR exports, rollups, the survey's own
 * views) reads through this filter so the finding never rewrites what the
 * surveyor recorded. Defect-based views (lists, board, maintenance) include it.
 */
export const SURVEY_ITEM_RESULT_WHERE = {
  source: InspectionItemResultSource.SURVEY,
} satisfies Prisma.InspectionItemResultWhereInput;
