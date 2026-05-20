export const DEFECT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const DEFECT_WORKFLOW_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "MONITORING",
  "RESOLVED",
  "CLOSED",
] as const;
export const DEFECT_LIFECYCLE_STATUSES = [
  "DETECTED",
  "UNDER_REVIEW",
  "VERIFIED",
  "REJECTED",
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "VERIFICATION_PENDING",
  "CLOSED",
] as const;
export const DEFECT_RESOLUTION_OUTCOMES = [
  "RESOLVED",
  "TEMPORARY_FIX",
  "MONITORING_REQUIRED",
  "EXTERNAL_CONSTRAINT",
  "DUPLICATE",
  "FALSE_POSITIVE",
  "DEFERRED",
] as const;
export const DEFECT_LEGACY_RESOLUTION_OUTCOMES = [
  "REPAIRED",
  "PARTIAL",
  "MONITOR_ONLY",
  "ESCALATED",
] as const;
export const ALL_DEFECT_RESOLUTION_OUTCOMES = [
  ...DEFECT_RESOLUTION_OUTCOMES,
  ...DEFECT_LEGACY_RESOLUTION_OUTCOMES,
] as const;

export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export type DefectWorkflowStatus = (typeof DEFECT_WORKFLOW_STATUSES)[number];

export type DefectStatus = DefectWorkflowStatus | "UNKNOWN";

export type DefectLifecycleStatus =
  | (typeof DEFECT_LIFECYCLE_STATUSES)[number]
  | "UNKNOWN";

export type DefectResolutionOutcome =
  | (typeof ALL_DEFECT_RESOLUTION_OUTCOMES)[number]
  | "UNKNOWN";

export type DefectSlaState =
  | "OVERDUE"
  | "ON_TRACK"
  | "NO_DUE_DATE"
  | "STOPPED"
  | "UNKNOWN";

export type DefectTimelineEventType =
  | "CREATED"
  | "STATUS_CHANGED"
  | "ASSIGNMENT_CHANGED"
  | "DUE_DATE_CHANGED"
  | "COMMENT"
  | "DEFECT_VERIFIED"
  | "DEFECT_ASSIGNED"
  | "MAINTENANCE_STARTED"
  | "MAINTENANCE_COMPLETED"
  | "RESOLUTION_OUTCOME_UPDATED"
  | "CLOSURE_VERIFIED";

export interface DefectActor {
  id: string;
  email?: string | null;
  name?: string | null;
  role?: string | null;
}

export interface DefectAssignedTeam {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface DefectTimelineEntry {
  id: string;
  type: DefectTimelineEventType;
  fromStatus: DefectStatus | null;
  toStatus: DefectStatus | null;
  fromLifecycleStatus?: DefectLifecycleStatus | null;
  toLifecycleStatus?: DefectLifecycleStatus | null;
  fromResolutionOutcome?: DefectResolutionOutcome | null;
  toResolutionOutcome?: DefectResolutionOutcome | null;
  comment: string | null;
  createdAt: string;
  createdBy: DefectActor | null;
}

export interface DefectEvidenceImage {
  id: string;
  inspectionId?: string;
  url?: string | null;
  path?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp?: string | null;
  createdAt?: string;
}

export interface DefectListItem {
  id: string;
  inspectionItemResultId?: string;
  assignedUserId?: string | null;
  assignedTeamId?: string | null;
  assignedToUserId?: string | null;
  assignedToTeamId?: string | null;
  assignedUser?: DefectActor | null;
  assignedTeam?: DefectAssignedTeam | null;
  assignedToUser?: DefectActor | null;
  assignedToTeam?: DefectAssignedTeam | null;
  verifiedByUserId?: string | null;
  maintainedByUserId?: string | null;
  closureVerifiedByUserId?: string | null;
  verifiedByUser?: DefectActor | null;
  maintainedByUser?: DefectActor | null;
  closureVerifiedByUser?: DefectActor | null;
  assignedTo?: string | null;
  inspectionId?: string;
  assetId?: string;
  assetCode: string;
  assetType?: string | null;
  defectType: string;
  severity: DefectSeverity | null;
  status: DefectStatus;
  lifecycleStatus?: DefectLifecycleStatus | null;
  resolutionOutcome?: DefectResolutionOutcome | null;
  date: string | null;
  location: string | null;
  remark?: string | null;
  actionRemark?: string | null;
  dueDate?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  assignedAt?: string | null;
  verifiedAt?: string | null;
  maintainedAt?: string | null;
  verificationNotes?: string | null;
  verificationRemarks?: string | null;
  maintenanceNotes?: string | null;
  closureVerifiedAt?: string | null;
  closureVerificationNotes?: string | null;
  closureRemarks?: string | null;
  isOverdue?: boolean;
  slaState?: DefectSlaState;
  submittedAt?: string | null;
  createdAt?: string | null;
}

export interface DefectDetail extends DefectListItem {
  checklistItemId?: string | null;
  checklistRemark: string | null;
  result: string | null;
  cycleNumber?: number;
  updatedAt: string | null;
  closedAt: string | null;
  asset?: {
    id: string;
    assetCode: string;
    name?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    assetType?: {
      id?: string;
      code?: string | null;
      name?: string | null;
    } | null;
    substation?: {
      id?: string;
      code?: string | null;
      name?: string | null;
      location?: string | null;
    } | null;
  } | null;
  inspection?: {
    id: string;
    templateId?: string;
    cycleNumber?: number;
    completionStatus?: string;
    submittedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    createdBy?: DefectActor | null;
    template?: {
      id?: string;
      name?: string | null;
      version?: number | null;
    } | null;
    siteVisit?: {
      id?: string;
      status?: string;
      startedAt?: string | null;
      endedAt?: string | null;
      team?: {
        id?: string;
        code?: string | null;
        name?: string | null;
      } | null;
      substation?: {
        id?: string;
        code?: string | null;
        name?: string | null;
        location?: string | null;
      } | null;
    } | null;
  } | null;
  submittedBy?: DefectActor | null;
  substation?: {
    code?: string | null;
    name?: string | null;
    location?: string | null;
  } | null;
  images: DefectEvidenceImage[];
  timeline: DefectTimelineEntry[];
}

export type DefectOperationsBoardQueueKey =
  | "awaitingQaQc"
  | "maintenanceReady"
  | "inMaintenance"
  | "awaitingClosureVerification"
  | "closedResolved"
  | "exceptions";

export interface DefectOperationsBoardMainhead {
  id: string | null;
  code: string | null;
  name: string | null;
  label: string;
}

export interface DefectOperationsBoardContextRef {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface DefectOperationsBoardSiteVisit {
  id: string;
  status?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  team?: DefectAssignedTeam | null;
  substation?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
    location?: string | null;
  } | null;
}

export interface DefectOperationsBoardAsset {
  id: string;
  code: string;
  name?: string | null;
  assetType?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
  } | null;
}

export interface DefectOperationsBoardItem {
  id: string;
  inspectionItemResultId?: string;
  title: string;
  summary: string | null;
  status: DefectLifecycleStatus;
  lifecycleStatus: DefectLifecycleStatus;
  workflowStatus?: DefectStatus;
  severity: DefectSeverity | null;
  resolutionOutcome: DefectResolutionOutcome | null;
  mainhead: DefectOperationsBoardMainhead;
  mainheadLabel: string;
  project: DefectOperationsBoardContextRef | null;
  workPackage: DefectOperationsBoardContextRef | null;
  siteVisit: DefectOperationsBoardSiteVisit | null;
  asset: DefectOperationsBoardAsset | null;
  assetCode: string;
  assetName: string | null;
  assignedToUserId?: string | null;
  assignedToTeamId?: string | null;
  assignedToUser?: DefectActor | null;
  assignedToTeam?: DefectAssignedTeam | null;
  assignedTo: string | null;
  verifiedByUser?: DefectActor | null;
  maintainedByUser?: DefectActor | null;
  closureVerifiedByUser?: DefectActor | null;
  detectedAt: string | null;
  createdAt: string | null;
  verifiedAt?: string | null;
  assignedAt?: string | null;
  maintainedAt?: string | null;
  closureVerifiedAt?: string | null;
  dueDate?: string | null;
  slaState?: DefectSlaState;
  isOverdue?: boolean;
  latestTimelineEvent?: DefectTimelineEntry | null;
}

export interface DefectOperationsBoardQueue {
  key: DefectOperationsBoardQueueKey;
  title: string;
  description?: string;
  statuses: DefectLifecycleStatus[];
  count: number;
  items: DefectOperationsBoardItem[];
}

export interface DefectOperationsBoardMainheadGroup {
  mainhead: DefectOperationsBoardMainhead;
  count: number;
  queues: DefectOperationsBoardQueue[];
}

export interface DefectOperationsBoardFilters {
  mainhead?: string;
  projectId?: string;
  workPackageId?: string;
  siteVisitId?: string;
  severity?: DefectSeverity;
  status?: Exclude<DefectLifecycleStatus, "UNKNOWN">;
  resolutionOutcome?: Exclude<DefectResolutionOutcome, "UNKNOWN">;
  assignedToUserId?: string;
  overdueOnly?: boolean;
  q?: string;
}

export interface DefectOperationsBoardResponse {
  generatedAt: string | null;
  filters: DefectOperationsBoardFilters;
  totalCount: number;
  queues: DefectOperationsBoardQueue[];
  mainheads: DefectOperationsBoardMainheadGroup[];
}
