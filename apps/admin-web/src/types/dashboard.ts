import type { MaintenanceCategory } from "@/types/defects";

export type DefectSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type DefectSlaState = "OVERDUE" | "ON_TRACK" | "NO_DUE_DATE" | "STOPPED";

export interface ChartDatum {
  label: string;
  value: number;
}

/** One point on the daily inspection-throughput trend (a reporting-day bucket). */
export interface DailyTrendPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** One reporting-day of defect intake vs. closure. */
export interface DefectFlowPoint {
  date: string; // YYYY-MM-DD
  opened: number;
  closed: number;
}

export type DashboardRangeKey = "7d" | "30d" | "90d" | "ytd";

export interface DashboardRange {
  key: DashboardRangeKey;
  label: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

/** Which company-type / role the dashboard is tailored for. */
export type DashboardPersonaKind = "OVERVIEW" | "INSPECTION" | "MAINTENANCE";

export interface DashboardPersona {
  kind: DashboardPersonaKind;
  role: string | null;
  companyType: string | null;
  organizationName: string | null;
  isQa: boolean;
  doesFieldWork: boolean;
  doesMaintenance: boolean;
}

export interface RecentDefect {
  id: string;
  assetCode: string;
  label: string;
  status: string;
  severity?: DefectSeverity | null;
  maintenanceCategory?: MaintenanceCategory | null;
  dueDate?: string | null;
  isOverdue?: boolean;
  slaState?: DefectSlaState | string;
  assignedTo?: string | null;
  createdAt: string;
}

export interface CriticalOverdueAlert {
  id: string;
  assetCode: string;
  label: string;
  status: string;
  severity?: DefectSeverity | null;
  maintenanceCategory?: MaintenanceCategory | null;
  dueDate?: string | null;
  assignedTo?: string | null;
}

export interface DashboardMetrics {
  persona: DashboardPersona;
  totalAssets: number;
  totalInspections: number;
  totalDefects: number;
  openDefects: number;
  overdueDefects: number;
  activeVisits: number;
  completedVisits: number;
  overdueVisits: number;
  completionRate: number;
  operationalOverdueThresholdHours: number;
  latestVisitActivityAt?: string | null;
  // --- Range-aware additions (all optional; a pre-range API omits them) ---
  range: DashboardRange | null;
  inspectedThisPeriod: number;
  inspectedPrevPeriod: number;
  assetsInScope: number;
  assetsInScopePrev: number;
  openDefectsPrev: number;
  emergencyOpen: number;
  emergencyUnassigned: number;
  emergencyOverdue: number;
  emergencyOverduePrev: number;
  defectFlow: DefectFlowPoint[];
  avgCloseHours: number;
  netBacklogChange: number;
  assetsBySubstation: ChartDatum[];
  slaOnTimePct: number | null;
  slaOnTimePctPrev: number | null;
  defectsBySeverity: ChartDatum[];
  defectsByCategory: ChartDatum[];
  defectsByStatus: ChartDatum[];
  defectsByAssignee: ChartDatum[];
  defectsByTeam: ChartDatum[];
  defectsBySlaState: ChartDatum[];
  dailyInspectionTrend: DailyTrendPoint[];
  visitsByStatus: ChartDatum[];
  visitsByValidationStatus: ChartDatum[];
  visitsByType: ChartDatum[];
  activeVisitsByTeam: ChartDatum[];
  visitsByOperationalHealth: ChartDatum[];
  assetsByMainhead: ChartDatum[];
  recentDefects: RecentDefect[];
  criticalOverdueAlerts: CriticalOverdueAlert[];
}

export interface DashboardApiResponse {
  persona?: unknown;
  totalAssets?: number;
  totalInspections?: number;
  totalDefects?: number;
  openDefects?: number;
  overdueDefects?: number;
  activeVisits?: number;
  completedVisits?: number;
  overdueVisits?: number;
  completionRate?: number;
  operationalOverdueThresholdHours?: number;
  latestVisitActivityAt?: string | null;
  range?: unknown;
  inspectedThisPeriod?: number;
  inspectedPrevPeriod?: number;
  assetsInScope?: number;
  assetsInScopePrev?: number;
  openDefectsPrev?: number;
  emergencyOpen?: number;
  emergencyUnassigned?: number;
  emergencyOverdue?: number;
  emergencyOverduePrev?: number;
  defectFlow?: unknown;
  avgCloseHours?: number;
  netBacklogChange?: number;
  assetsBySubstation?: unknown;
  slaOnTimePct?: number | null;
  slaOnTimePctPrev?: number | null;
  defectsBySeverity?: unknown;
  defectsByCategory?: unknown;
  defectsByStatus?: unknown;
  defectsByAssignee?: unknown;
  defectsByTeam?: unknown;
  defectsBySlaState?: unknown;
  dailyInspectionTrend?: unknown;
  visitsByStatus?: unknown;
  visitsByValidationStatus?: unknown;
  visitsByType?: unknown;
  activeVisitsByTeam?: unknown;
  visitsByOperationalHealth?: unknown;
  assetsByMainhead?: unknown;
  recentDefects?: RecentDefect[];
  criticalOverdueAlerts?: CriticalOverdueAlert[];
}
