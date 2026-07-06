export type AssetInspectionStatus = "COMPLETED" | "PENDING";

export interface AssetListItem {
  id: string;
  assetCode: string;
  assetType: string | null;
  feeder: string | null;
  location: string | null;
  pencawangName: string | null;
  substationId: string | null;
  inspectionStatus: AssetInspectionStatus;
  date: string | null;
  assetStatus?: string | null;
}

export interface InspectionEvidenceImage {
  id: string;
  inspectionId: string;
  url: string;
  path?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp?: string | null;
  createdAt?: string | null;
}

export type InspectionResultValue = "PASS" | "FAIL" | "NA";

/** One answered checklist item from an inspection. */
export interface InspectionResultItem {
  id: string;
  label: string;
  /** PASS / FAIL / NA (kept as string so an unexpected value still renders). */
  result: InspectionResultValue | string | null;
  remark: string | null;
  isDefect: boolean;
  /** DefectSeverity (LOW/MEDIUM/HIGH/CRITICAL) when the item is a defect. */
  severity: string | null;
}

export interface AssetDetail extends AssetListItem {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  latestInspection: {
    id: string;
    cycleNumber: number | null;
    status: string | null;
    submittedAt: string | null;
    remarks?: string | null;
    totalDefects?: number;
    items?: InspectionResultItem[];
    images?: InspectionEvidenceImage[];
  } | null;
}
