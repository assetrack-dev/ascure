import { randomUUID } from 'crypto';
import {
  DefectSeverity,
  DefectStatus,
  MaintenanceCategory,
} from '@prisma/client';
import { initialDefectLifecycleStatus } from '../common/authorization/defect-governance';

export type MaterializableItemResult = {
  id: string;
  severity: DefectSeverity | null;
  isEmergency: boolean;
  maintenanceCategory: MaintenanceCategory | null;
};

/**
 * Single source of truth for the opening column values of a Defect materialized
 * from an InspectionItemResult. EVERY defect-creation path must go through this
 * — inspection submit AND the lazy materializers in defects.service and
 * dashboard.service — so the opening lifecycle status, the emergency flag, and
 * the CRITICAL-on-emergency severity override can never drift between them.
 *
 * (They previously drifted: only the submit path carried isEmergency, and the
 * dashboard path hardcoded DETECTED — so a defect materialized lazily before
 * submit could permanently lose its emergency flag / open un-claimable.)
 */
export function buildInitialDefectData(
  item: MaterializableItemResult,
  now: Date,
) {
  return {
    id: randomUUID(),
    inspectionItemResultId: item.id,
    status: DefectStatus.OPEN,
    // Emergency-flagged items are CRITICAL regardless of template severity.
    severity: item.isEmergency
      ? DefectSeverity.CRITICAL
      : item.severity ?? DefectSeverity.MEDIUM,
    // Work-type for maintenance packaging — null on the item result (legacy /
    // untagged) resolves to SELENGGARAAN, the catch-all bucket.
    maintenanceCategory:
      item.maintenanceCategory ?? MaintenanceCategory.SELENGGARAAN,
    isEmergency: item.isEmergency,
    // Under RELEASE_ON_REPORT, emergencies open VERIFIED (instant release at
    // submit) while normal defects open DETECTED (dormant until LAPORAN SELESAI).
    // Other modes ignore isEmergency. See defect-governance.ts.
    lifecycleStatus: initialDefectLifecycleStatus({ isEmergency: item.isEmergency }),
    createdAt: now,
    updatedAt: now,
  };
}
