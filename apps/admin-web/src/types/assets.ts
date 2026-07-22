import type { ChecklistColumn, SiteVisitSensorPhoto } from "@/types/site-visits";

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
  /** The checklist item this photo was captured against, or null for a general
   *  inspection photo. Lets a viewer caption it with the field name. */
  templateItemId?: string | null;
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

/**
 * The inspection's checklist as columns + recorded values — the same shape the
 * Site Visit Linked-Assets table uses, so a value shown (or edited) here matches
 * what that table shows. `values` and an IMAGE column's photo are keyed the way
 * the API keys them: values by normalized label, images by templateItemId.
 */
export interface AssetChecklist {
  columns: ChecklistColumn[];
  values: Record<string, string | null>;
  images: Record<string, SiteVisitSensorPhoto>;
}

export interface AssetDetail extends AssetListItem {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  latestInspection: {
    id: string;
    /** The visit the inspection was recorded in — passed on a checklist edit so
     *  the API can reject one aimed at a different survey cycle. */
    siteVisitId: string | null;
    cycleNumber: number | null;
    status: string | null;
    submittedAt: string | null;
    remarks?: string | null;
    totalDefects?: number;
    items?: InspectionResultItem[];
    images?: InspectionEvidenceImage[];
    checklist?: AssetChecklist;
  } | null;
}
