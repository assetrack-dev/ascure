import { apiRequest } from "@/lib/api";
import type { ChartDatum, DashboardApiResponse, DashboardMetrics } from "@/types/dashboard";

const SEVERITY_LABELS = ["Critical", "High", "Medium", "Low"];
const SLA_LABELS = ["Overdue", "On Track", "No Due Date", "Stopped"];

function numberOrZero(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeChartData(input: unknown): ChartDatum[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const record = item as Record<string, unknown>;
        const label = String(record.label ?? record.name ?? record.severity ?? record.type ?? "");

        if (!label) {
          return null;
        }

        return {
          label: titleCase(label),
          value: numberOrZero(record.value ?? record.count ?? record.total),
        };
      })
      .filter((item): item is ChartDatum => Boolean(item));
  }

  if (input && typeof input === "object") {
    return Object.entries(input as Record<string, unknown>).map(([label, value]) => ({
      label: titleCase(label),
      value: numberOrZero(value),
    }));
  }

  return [];
}

function normalizeSeverityData(input: unknown) {
  const values = normalizeChartData(input);
  const byLabel = new Map(values.map((item) => [item.label.toLowerCase(), item.value]));

  return SEVERITY_LABELS.map((label) => ({
    label,
    value: byLabel.get(label.toLowerCase()) ?? 0,
  }));
}

function normalizeSlaData(input: unknown) {
  const values = normalizeChartData(input);
  const byLabel = new Map(values.map((item) => [item.label.toLowerCase(), item.value]));

  return SLA_LABELS.map((label) => ({
    label,
    value: byLabel.get(label.toLowerCase()) ?? 0,
  }));
}

export async function fetchDashboardMetrics(token: string): Promise<DashboardMetrics> {
  const dashboard = await apiRequest<DashboardApiResponse>("/dashboard", { token });

  const defectsBySeverity = normalizeSeverityData(dashboard.defectsBySeverity);
  const defectsBySlaState = normalizeSlaData(dashboard.defectsBySlaState);

  return {
    totalAssets: numberOrZero(dashboard.totalAssets),
    totalDefects: numberOrZero(dashboard.totalDefects),
    openDefects: numberOrZero(dashboard.openDefects),
    activeVisits: numberOrZero(dashboard.activeVisits),
    completedVisits: numberOrZero(dashboard.completedVisits),
    overdueVisits: numberOrZero(dashboard.overdueVisits),
    completionRate: numberOrZero(dashboard.completionRate),
    operationalOverdueThresholdHours: numberOrZero(
      dashboard.operationalOverdueThresholdHours,
    ),
    latestVisitActivityAt: dashboard.latestVisitActivityAt ?? null,
    defectsBySeverity,
    defectsByAssignee: normalizeChartData(dashboard.defectsByAssignee),
    defectsByTeam: normalizeChartData(dashboard.defectsByTeam),
    defectsBySlaState,
    visitsByStatus: normalizeChartData(dashboard.visitsByStatus),
    visitsByValidationStatus: normalizeChartData(dashboard.visitsByValidationStatus),
    visitsByType: normalizeChartData(dashboard.visitsByType),
    activeVisitsByTeam: normalizeChartData(dashboard.activeVisitsByTeam),
    visitsByOperationalHealth: normalizeChartData(dashboard.visitsByOperationalHealth),
    assetsByMainhead: normalizeChartData(dashboard.assetsByMainhead),
    recentDefects: Array.isArray(dashboard.recentDefects) ? dashboard.recentDefects : [],
    criticalOverdueAlerts: Array.isArray(dashboard.criticalOverdueAlerts)
      ? dashboard.criticalOverdueAlerts
      : [],
  };
}
