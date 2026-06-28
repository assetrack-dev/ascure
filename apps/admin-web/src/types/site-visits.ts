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

export interface SiteVisitListItem extends SiteVisitSummary {
  id: string;
  status: SiteVisitStatus;
  validationStatus: SiteVisitValidationStatus;
  operationalHealthStatus: OperationalHealthStatus;
  isOverdue: boolean;
  overdueThresholdHours: number;
  visitType: SiteVisitType;
  operationalDomain: OperationalDomain;
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
    status?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    assetType?: {
      id?: string;
      code?: string | null;
      name?: string | null;
    } | null;
    substation?: SiteVisitSubstation | null;
  };
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
}
