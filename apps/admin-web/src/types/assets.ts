import type { ChecklistColumn, SiteVisitSensorPhoto } from "@/types/site-visits";

export type AssetInspectionStatus = "COMPLETED" | "PENDING";

/** One drill level of the Assets registry (Region → Mainhead → Pencawang). */
export type AssetRegistryLevel = "region" | "mainhead" | "pencawang";

/** Sentinel id for the "Unassigned" bucket — drillable like a real parent. */
export const REGISTRY_UNASSIGNED = "unassigned";

/** One rollup row at a drill level: a Region, Mainhead, or Pencawang with its
 *  asset counts (never the assets themselves). */
export interface AssetRegistryGroup {
  id: string;
  name: string;
  assetCount: number;
  inspectedCount: number;
  pendingCount: number;
  /** Distinct poles carrying an open defect. */
  defectAssetCount: number;
  pencawangCount: number;
  /** Region level only. */
  mainheadCount?: number;
}

export interface AssetRegistryTotals {
  assetCount: number;
  inspectedCount: number;
  pendingCount: number;
  defectAssetCount: number;
  pencawangCount: number;
}

export interface AssetRegistryRollup {
  level: AssetRegistryLevel;
  groups: AssetRegistryGroup[];
  totals: AssetRegistryTotals;
}

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

/** One SAVT route a pole carries — shared-corridor poles have several, each
 *  with its own printed code (docs/PLAN-savt-shared-poles.md). */
export interface AssetSavtRoute {
  routeCode: string;
  noTiang: string;
  poleCode: string;
}

export interface AssetDetail extends AssetListItem {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  /** [] for non-SAVT poles. */
  savtRoutes: AssetSavtRoute[];
  latestInspection: {
    id: string;
    /** The visit the inspection was recorded in — passed on a checklist edit so
     *  the API can reject one aimed at a different survey cycle. */
    siteVisitId: string | null;
    cycleNumber: number | null;
    status: string | null;
    submittedAt: string | null;
    remarks?: string | null;
    /** Set when a manager/DC sent this pole back — the pole reads "not
     *  inspected" until the crew re-submits, and this is why. */
    reinspectionReason?: string | null;
    reinspectionRequestedAt?: string | null;
    totalDefects?: number;
    items?: InspectionResultItem[];
    images?: InspectionEvidenceImage[];
    checklist?: AssetChecklist;
  } | null;
}
