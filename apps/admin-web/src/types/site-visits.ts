export type SiteVisitStatus =
  | "ACTIVE"
  | "OPEN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "UNKNOWN";

export type SiteVisitValidationStatus =
  | "PENDING"
  | "VALIDATED"
  | "WARNING"
  | "FAILED"
  | "UNKNOWN";

export type OperationalHealthStatus = "HEALTHY" | "WARNING" | "CRITICAL";

export type SiteVisitType =
  | "DISCOVERY"
  | "REINSPECTION"
  | "SPECIAL"
  | "AUDIT"
  | "UNSPECIFIED";

export type OperationalDomain =
  | "SURVEY"
  | "INSPECTION"
  | "MAINTENANCE"
  | "REPAIR"
  | "AUDIT"
  | "CIVIL"
  | "DISTRIBUTION"
  | "THIRTY_THREE_KV"
  | "EMERGENCY"
  | "OTHER"
  | "UNSPECIFIED";

/** The asset-type / survey scope a visit belongs to: SAVR (Pencawang-based pole
 *  survey, the default) or SAVT (HV route survey). Derived from the visit's
 *  operationalScope, mirroring the Reports page's two-way SAVR/SAVT split. */
export type SurveyScope = "SAVR" | "SAVT";

export interface SiteVisitTeam {
  id?: string;
  code?: string | null;
  name?: string | null;
}

export interface SiteVisitUser {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  siteVisitUserId?: string;
  joinedAt?: string | null;
}

export interface SiteVisitSubstation {
  id?: string;
  code?: string | null;
  name?: string | null;
  location?: string | null;
}

export interface SiteVisitMainhead {
  id?: string;
  branchId?: string | null;
  code?: string | null;
  name?: string | null;
  isActive?: boolean | null;
}

export interface SiteVisitSummary {
  totalAssets: number;
  inspectedAssets: number;
  pendingAssets: number;
  defectsFound: number;
  completionPercentage: number;
}

/** The one user-facing status set (mirrors @ascure/shared-utils DisplayStatus).
 *  The API sends this on every visit; the DB enums (status, lifecycle) still
 *  drive the real logic. */
export type DisplayStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "NEEDS_AMENDMENT"
  | "IN_REVIEW"
  | "COMPLETED"
  | "ARCHIVED"
  | "CANCELLED";

export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  NEEDS_AMENDMENT: "Needs Amendment",
  IN_REVIEW: "In Review",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
  CANCELLED: "Cancelled",
};

export interface SiteVisitListItem extends SiteVisitSummary {
  id: string;
  status: SiteVisitStatus;
  displayStatus: DisplayStatus;
  displayStatusLabel: string;
  validationStatus: SiteVisitValidationStatus;
  operationalHealthStatus: OperationalHealthStatus;
  isOverdue: boolean;
  overdueThresholdHours: number;
  visitType: SiteVisitType;
  operationalDomain: OperationalDomain;
  /** SAVR vs SAVT — drives the Asset Type filter on the list. Derived client-side
   *  from the visit's operationalScope / sessionKind / route code. */
  surveyScope: SurveyScope;
  cycleNumber: number | null;
  mainhead: string | null;
  mainheadRecord: SiteVisitMainhead | null;
  pencawangCode: string | null;
  pencawangName: string | null;
  functionalLocation: string | null;
  team: SiteVisitTeam | null;
  substation: SiteVisitSubstation | null;
  createdBy: SiteVisitUser | null;
  teamMembers: SiteVisitUser[];
  startedAt: string | null;
  completedAt: string | null;
  endedAt: string | null;
  lastActivityAt: string | null;
  updatedAt: string | null;
  notes: string | null;
  completionNotes: string | null;
}

export interface SiteVisitAssetLink {
  id: string;
  siteVisitId?: string;
  assetId: string;
  addedAt: string | null;
  source: string | null;
  notes: string | null;
  addedBy?: SiteVisitUser | null;
  asset: {
    id: string;
    assetCode: string;
    name: string | null;
    noTiangLama?: string | null;
    status?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    assetType?: {
      id?: string;
      code?: string | null;
      name?: string | null;
    } | null;
    substation?: SiteVisitSubstation | null;
    /** Latest SUBMITTED inspection for this pole — the edit target for an
     *  in-place Bacaan Kelegaan 1 correction. Null when never submitted. */
    latestInspectionId?: string | null;
  };
  /** Latest-inspection checklist readings surfaced as columns for DC checking. */
  checklist?: {
    bacaanKelegaan1: string | null;
    /** Smart Sensor photo behind the Bacaan Kelegaan 1 reading — lets the DC
     * eyeball the LCD and re-verify the recorded value. */
    bacaanKelegaan1Image?: SiteVisitSensorPhoto | null;
    catitan: string | null;
  };
  /** Every recorded checklist value for this pole's latest submitted inspection,
   *  keyed by normalized (upper, single-spaced) label. Feeds the DC's toggleable
   *  columns — match a {@link ChecklistColumn.key} against this map. */
  checklistValues?: Record<string, string | null>;
}

/** A template-defined checklist field the DC can turn on as a Linked-Assets
 *  column. `key` matches into {@link SiteVisitAssetLink.checklistValues}. */
export interface ChecklistColumn {
  key: string;
  label: string;
  section: string | null;
  /** The item's input type (NUMBER/BOOLEAN/DATE/…) so the Linked-Assets editor
   *  renders a type-aware input; absent falls back to a text field. */
  inputType?: string;
  /** Dropdown options (SELECT items expose their configured options; BOOLEAN gets
   *  Yes/No) so the editor renders a dropdown matching the checklist template.
   *  Absent → the editor stays a free-text/number/date input. */
  options?: { label: string; value: string }[];
}

export interface SiteVisitSensorPhoto {
  /** API-relative /uploads path (resolve against the API origin to render). */
  url: string | null;
  filename: string | null;
  timestamp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface SiteVisitInspection {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string | null;
  templateName: string | null;
  templateVersion: number | null;
  completionStatus: string;
  cycleNumber: number | null;
  submittedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  imageCount: number;
  defectCount: number;
  createdBy: SiteVisitUser | null;
}

export interface SiteVisitImage {
  id: string;
  fileName: string | null;
  storageKey: string | null;
  contentType: string | null;
  url: string | null;
  createdAt: string | null;
}

export type SurveyLifecycleStatus =
  | "DALAM_RONDAAN"
  | "RONDAAN_SELESAI"
  | "DISAHKAN_PENGURUS"
  | "PERLU_PINDAAN"
  | "PINDAAN_SELESAI"
  | "LAPORAN_SELESAI"
  | "ARKIB";

export interface SurveyLifecycleState {
  status: SurveyLifecycleStatus | null;
  rondaanSelesaiAt: string | null;
  managerApprovedAt: string | null;
  amendmentRequestedAt: string | null;
  amendmentRemark: string | null;
  laporanSelesaiAt: string | null;
  archivedAt: string | null;
}

export interface SurveyLifecycleEvent {
  id: string;
  fromStatus: SurveyLifecycleStatus | null;
  toStatus: SurveyLifecycleStatus;
  remark: string | null;
  createdAt: string | null;
  createdBy: SiteVisitUser | null;
}

export interface CycleDeltaPole {
  id: string;
  assetCode: string;
  noTiangLama: string | null;
  status: string;
}

export type SurveyDueStatus = "ON_TIME" | "DUE_SOON" | "OVERDUE" | "UNKNOWN";

export interface InspectionRecency {
  lastInspectedAt: string | null;
  monthsSince: number | null;
  intervalMonths: number;
  status: SurveyDueStatus;
}

export interface CycleDelta {
  isBaseline: boolean;
  cycleNumber: number | null;
  recency: InspectionRecency;
  priorCycle: {
    id: string;
    startedAt: string | null;
    cycleNumber: number | null;
    pencawangCode: string | null;
  } | null;
  summary: { observed: number; added: number; removed: number; carried: number };
  newPoles: CycleDeltaPole[];
  removedPoles: CycleDeltaPole[];
  carriedPoles: CycleDeltaPole[];
}

export interface TeamContributionSnapshot {
  reason: string;
  assetsCompleted: number;
  totalAssets: number;
  at: string | null;
}

export interface TeamContributionShare {
  teamId: string;
  teamName: string | null;
  assetsCompleted: number;
  isCurrent: boolean;
  snapshots: TeamContributionSnapshot[];
}

export interface ReassignmentRecord {
  fromTeamId: string;
  fromTeamName: string | null;
  toTeamId: string;
  toTeamName: string | null;
  reason: string;
  at: string | null;
}

/** Per-team billing contribution for a Pencawang (ADR 0002 §5). */
export interface SiteVisitContributions {
  siteVisitId: string;
  currentTeamId: string;
  totalAssets: number;
  totalCompleted: number;
  teams: TeamContributionShare[];
  reassignments: ReassignmentRecord[];
}

export interface SiteVisitDetail extends SiteVisitListItem {
  validatedAt: string | null;
  validationSummary: string | null;
  validatedBy: SiteVisitUser | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkInAccuracyMeters: number | null;
  checkInCapturedAt: string | null;
  feederId: string | null;
  feederRouteId: string | null;
  gisGeometryVersion: string | null;
  cancelReason: string | null;
  linkedAssets: SiteVisitAssetLink[];
  inspections: SiteVisitInspection[];
  images: SiteVisitImage[];
  lifecycle: SurveyLifecycleState | null;
  lifecycleEvents: SurveyLifecycleEvent[];
  /** Template-defined checklist fields the DC can toggle on as extra Linked-Assets
   *  columns, in template order (section, then item). Empty when nothing recorded. */
  checklistColumns?: ChecklistColumn[];
}
