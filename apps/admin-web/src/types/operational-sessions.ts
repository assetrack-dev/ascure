export const OPERATIONAL_SESSION_SCOPES = [
  "SAVR",
  "SAVT",
  "PENCAWANG",
  "FEEDER_PILLAR",
  "LINK_BOX",
  "CABLE_BRIDGE",
] as const;

export const OPERATIONAL_SESSION_STATUSES = [
  "DRAFT",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "QA_REVIEW",
  "AMENDMENT_REQUIRED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type OperationalSessionScope = (typeof OPERATIONAL_SESSION_SCOPES)[number];
export type OperationalSessionStatus = (typeof OPERATIONAL_SESSION_STATUSES)[number];

export interface OperationalSessionSummaryRecord {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  isActive?: boolean | null;
  organizationId?: string | null;
  branchId?: string | null;
  region?: string | null;
  description?: string | null;
}

export interface OperationalSessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface OperationalSessionProgress {
  totalAssets: number;
  completedAssets: number;
  completionPercentage: number;
}

export interface OperationalSession {
  id: string;
  sessionNo: string;
  workspaceId: string;
  organizationId: string;
  branchId: string | null;
  mainheadId: string | null;
  assignedCompanyId: string;
  assignedQaUserId: string | null;
  scope: OperationalSessionScope;
  status: OperationalSessionStatus;
  metadata: Record<string, unknown> | null;
  targetDate: string | null;
  dueDate: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
  progress: OperationalSessionProgress;
  workspace?: {
    id: string;
    name: string;
    code: string;
  } | null;
  organization?: OperationalSessionSummaryRecord | null;
  branch?: OperationalSessionSummaryRecord | null;
  mainhead?: OperationalSessionSummaryRecord | null;
  assignedCompany?: OperationalSessionSummaryRecord | null;
  assignedQaUser?: OperationalSessionUser | null;
}

export interface OperationalSessionFilters {
  workspaceId?: string;
  scope?: OperationalSessionScope;
  status?: OperationalSessionStatus;
  assignedCompanyId?: string;
  assignedQaUserId?: string;
  mainheadId?: string;
}

export interface CreateOperationalSessionPayload {
  workspaceId: string;
  organizationId: string;
  branchId?: string | null;
  mainheadId?: string | null;
  assignedCompanyId: string;
  assignedQaUserId?: string | null;
  scope: OperationalSessionScope;
  metadata?: Record<string, unknown> | null;
  targetDate?: string | null;
  dueDate?: string | null;
  remarks?: string | null;
}
