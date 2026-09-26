/**
 * Defect evidence photo types (docs/PLAN-maintenance-flow.md §6).
 *
 * BEFORE / DURING / AFTER are the repair stages a maintenance crew records per
 * Kejanggalan. MAINTENANCE_PROOF (older app builds) and EMERGENCY (inspector's
 * declare-emergency media) stay accepted so released APKs keep working.
 */
export const REPAIR_STAGE_EVIDENCE_TYPES = ['BEFORE', 'DURING', 'AFTER'] as const;
export type RepairStageEvidenceType = (typeof REPAIR_STAGE_EVIDENCE_TYPES)[number];

export const DEFECT_EVIDENCE_TYPES = [
  ...REPAIR_STAGE_EVIDENCE_TYPES,
  'MAINTENANCE_PROOF',
  'EMERGENCY',
] as const;
export type DefectEvidenceType = (typeof DEFECT_EVIDENCE_TYPES)[number];

export function isRepairStageEvidenceType(
  value: string,
): value is RepairStageEvidenceType {
  return (REPAIR_STAGE_EVIDENCE_TYPES as readonly string[]).includes(value);
}

const TYPE_LABEL: Record<DefectEvidenceType, string> = {
  BEFORE: 'Before photo',
  DURING: 'During photo',
  AFTER: 'After photo',
  MAINTENANCE_PROOF: 'Maintenance proof image',
  EMERGENCY: 'Emergency evidence',
};

export function evidenceTypeLabel(value: string): string {
  return TYPE_LABEL[value as DefectEvidenceType] ?? 'Evidence';
}
