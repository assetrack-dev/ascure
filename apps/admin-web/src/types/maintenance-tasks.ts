/** Plan §21.2 #4 — "My tasks" (GET /maintenance-tasks/groups + /items). */

export type TaskStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "SENT_BACK"
  | "COMPLETED"
  | "CANNOT_REPAIR"
  | "VERIFIED";

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "SENT_BACK",
  "TODO",
  "IN_PROGRESS",
  "COMPLETED",
  "CANNOT_REPAIR",
  "VERIFIED",
];

export type TaskScopeKind = "ADMIN" | "COMPANY" | "CREW";

export interface TaskFilters {
  status?: TaskStatus | "";
  organizationId?: string;
  /** A team id, or NONE for work no team holds yet. */
  teamId?: string;
  category?: string;
  /** yyyy-mm-dd: marked done or verified in the range. */
  from?: string;
  to?: string;
  search?: string;
}

export interface TaskGroup {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: string | null;
  company: { id: string; name: string };
  team: { id: string; name: string } | null;
  counts: Record<TaskStatus, number>;
  count: number;
  emergencies: number;
  categories: string[];
  activityAt: string | null;
}

export interface TaskGroups {
  scope: TaskScopeKind;
  counts: Record<TaskStatus, number>;
  page: number;
  pageSize: number;
  totalGroups: number;
  companies: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string; organizationId: string }>;
  hasNoTeam: boolean;
  groups: TaskGroup[];
}

export interface TaskEvidence {
  id: string;
  evidenceType: string;
  filename: string | null;
  path: string | null;
  url: string | null;
  note: string | null;
  timestamp: string | null;
  createdAt: string;
}

export interface TaskItem {
  id: string;
  status: TaskStatus;
  label: string;
  remark: string | null;
  isNewFinding: boolean;
  severity: string;
  isEmergency: boolean;
  category: string;
  company: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  assignedAt: string | null;
  dueDate: string | null;
  maintainedAt: string | null;
  maintainedBy: { id: string; name: string } | null;
  maintenanceNotes: string | null;
  resolutionOutcome: string | null;
  repairMethod: { id: string; label: string; note: string | null } | null;
  verifiedAt: string | null;
  verifiedBy: { id: string; name: string } | null;
  verificationNotes: string | null;
  sentBack: {
    at: string;
    by: { id: string; name: string } | null;
    reason: string | null;
    comment: string | null;
  } | null;
  asset: {
    id: string;
    assetCode: string;
    noTiangLama: string | null;
    noTiangLamaPrevious: string | null;
  };
  evidence: TaskEvidence[];
}

export interface TaskItems {
  scope: TaskScopeKind;
  truncated: boolean;
  items: TaskItem[];
}

/** Plan §21 (R6): the three daily events of a repair. */
export interface DayCounts {
  started: number;
  completed: number;
  verified: number;
}

/** Plan §21.2 #3 — GET /maintenance-tasks/overview. */
export interface MaintenanceOverview {
  scope: TaskScopeKind;
  /** yyyy-mm-dd (Malaysia day) the "today" figures are for. */
  date: string;
  days: number;
  companies: Array<{ id: string; name: string }>;
  totals: Record<TaskStatus, number> & { total: number; overdue: number; noTeam: number };
  today: DayCounts;
  /** The chosen day and the 6 before it. */
  week: DayCounts;
  series: Array<{ date: string } & DayCounts>;
  byWorkType: Array<{ category: string; counts: Record<TaskStatus, number>; total: number }>;
  teams: Array<{
    team: { id: string; name: string } | null;
    company: { id: string; name: string };
    counts: Record<TaskStatus, number>;
    total: number;
    overdue: number;
    openPencawang: number;
    today: DayCounts;
    week: DayCounts;
  }>;
}

/** Plan §21 (R7): which status's date a report by date uses. */
export type ReportPeriodStatus = "VERIFIED" | "COMPLETED" | "BOTH";

export interface ReportPeriodOptions {
  from: string;
  to: string;
  status: ReportPeriodStatus;
  organizationId?: string;
  teamId?: string;
  category?: string;
}

/** GET /maintenance-tasks/report-period. */
export interface ReportPeriod {
  status: ReportPeriodStatus;
  from: string;
  to: string;
  pencawang: number;
  kejanggalan: number;
  targets: Array<{
    siteVisitId: string;
    pencawangName: string | null;
    company: { id: string; name: string };
    count: number;
  }>;
}

/** Plan §21.2 #1 — GET /maintenance-tasks/tnb/today. */
export interface TnbToday {
  scope: string;
  date: string;
  days: number;
  today: DayCounts;
  series: Array<{ date: string } & DayCounts>;
  companies: Array<{
    company: { id: string; name: string };
    today: DayCounts;
    total: number;
    verified: number;
    lanes: Array<{ category: string; counts: Record<TaskStatus, number>; total: number; today: DayCounts }>;
  }>;
}

/** Plan §21.2 #2 — one company × work type line ("ALL" = the company total). */
export interface PerformanceLane {
  category: string;
  assigned: number;
  completed: number;
  verified: number;
  cannotRepair: number;
  sentBack: number;
  sentBackRate: number | null;
  daysToDone: number | null;
  daysToVerify: number | null;
  open: number;
  overduePencawang: number;
}

/** GET /maintenance-tasks/tnb/performance. */
export interface TnbPerformance {
  scope: string;
  from: string;
  to: string;
  companies: Array<{ company: { id: string; name: string }; total: PerformanceLane; lanes: PerformanceLane[] }>;
}
