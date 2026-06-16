import { randomUUID } from 'crypto';
import {
  DefectSeverity,
  DefectStatus,
} from '@prisma/client';
import { initialDefectLifecycleStatus } from '../common/authorization/defect-governance';

export type MaterializableItemResult = {
  id: string;
  severity: DefectSeverity | null;
  isEmergency: boolean;
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
    isEmergency: item.isEmergency,
    lifecycleStatus: initialDefectLifecycleStatus(),
    createdAt: now,
    updatedAt: now,
  };
}
