export const DEFECT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export type DefectStatus = "OPEN" | "IN_PROGRESS" | "CLOSED" | "UNKNOWN";

export interface DefectListItem {
  id: string;
  inspectionItemResultId?: string;
  inspectionId?: string;
  assetId?: string;
  assetCode: string;
  assetType?: string | null;
  defectType: string;
  severity: DefectSeverity | null;
  status: DefectStatus;
  date: string | null;
  location: string | null;
  remark?: string | null;
  actionRemark?: string | null;
  closedAt?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
}
