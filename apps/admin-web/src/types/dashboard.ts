export type DefectSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

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
  createdAt: string;
}

export interface DashboardMetrics {
  totalAssets: number;
  totalDefects: number;
  openDefects: number;
  criticalDefects: number;
  totalInspections: number;
  defectsBySeverity: ChartDatum[];
  assetsByType: ChartDatum[];
  recentDefects: RecentDefect[];
}

export interface DashboardApiResponse {
  totalAssets?: number;
  totalInspections?: number;
  totalDefects?: number;
  openDefects?: number;
  criticalDefects?: number;
  defectsBySeverity?: unknown;
  assetsByType?: unknown;
  recentDefects?: RecentDefect[];
}
