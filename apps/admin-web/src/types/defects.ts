export const DEFECT_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const DEFECT_WORKFLOW_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "MONITORING",
  "RESOLVED",
  "CLOSED",
] as const;

export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export type DefectWorkflowStatus = (typeof DEFECT_WORKFLOW_STATUSES)[number];

export type DefectStatus = DefectWorkflowStatus | "UNKNOWN";

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
  | "COMMENT";

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
  assignedUser?: DefectActor | null;
  assignedTeam?: DefectAssignedTeam | null;
  assignedTo?: string | null;
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
  dueDate?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
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
