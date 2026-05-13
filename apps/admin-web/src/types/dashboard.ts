export type DefectSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type DefectSlaState = "OVERDUE" | "ON_TRACK" | "NO_DUE_DATE" | "STOPPED";

export interface ChartDatum {
  label: string;
  value: number;
}

export interface RecentDefect {
  id: string;
  assetCode: string;
  label: string;
  status: string;
  severity?: DefectSeverity | null;
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
  dueDate?: string | null;
  assignedTo?: string | null;
}

export interface DashboardMetrics {
  totalAssets: number;
  totalDefects: number;
  openDefects: number;
  criticalDefects: number;
  overdueDefects: number;
  criticalOverdueDefects: number;
  totalInspections: number;
  activeVisits: number;
  completedVisits: number;
  overdueVisits: number;
  completionRate: number;
  activeFieldTeams: number;
  operationalOverdueThresholdHours: number;
  activeMappedVisits: number;
  latestVisitActivityAt?: string | null;
  operationalLastRefreshedAt?: string | null;
  defectsBySeverity: ChartDatum[];
  defectsByAssignee: ChartDatum[];
  defectsByTeam: ChartDatum[];
  defectsBySlaState: ChartDatum[];
  assetsByType: ChartDatum[];
  visitsByStatus: ChartDatum[];
  visitsByValidationStatus: ChartDatum[];
  visitsByType: ChartDatum[];
  activeVisitsByTeam: ChartDatum[];
  visitsByOperationalHealth: ChartDatum[];
  recentDefects: RecentDefect[];
  criticalOverdueAlerts: CriticalOverdueAlert[];
}

export interface DashboardApiResponse {
  totalAssets?: number;
  totalInspections?: number;
  totalDefects?: number;
  openDefects?: number;
  criticalDefects?: number;
  overdueDefects?: number;
  criticalOverdueDefects?: number;
  activeVisits?: number;
  completedVisits?: number;
  overdueVisits?: number;
  completionRate?: number;
  activeFieldTeams?: number;
  operationalOverdueThresholdHours?: number;
  activeMappedVisits?: number;
  latestVisitActivityAt?: string | null;
  operationalLastRefreshedAt?: string | null;
  defectsBySeverity?: unknown;
  defectsByAssignee?: unknown;
  defectsByTeam?: unknown;
  defectsBySlaState?: unknown;
  assetsByType?: unknown;
  visitsByStatus?: unknown;
  visitsByValidationStatus?: unknown;
  visitsByType?: unknown;
  activeVisitsByTeam?: unknown;
  visitsByOperationalHealth?: unknown;
  recentDefects?: RecentDefect[];
  criticalOverdueAlerts?: CriticalOverdueAlert[];
}
