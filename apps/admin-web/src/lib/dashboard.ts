import { apiRequest } from "@/lib/api";
import type {
  ChartDatum,
  DailyTrendPoint,
  DashboardApiResponse,
  DashboardMetrics,
  DashboardPersona,
  DashboardPersonaKind,
  DashboardRange,
  DashboardRangeKey,
  DefectFlowPoint,
} from "@/types/dashboard";

const RANGE_KEYS: DashboardRangeKey[] = ["7d", "30d", "90d", "ytd"];

const SEVERITY_LABELS = ["Critical", "High", "Medium", "Low"];
const SLA_LABELS = ["Overdue", "On Track", "No Due Date", "Stopped"];
const PERSONA_KINDS: DashboardPersonaKind[] = [
  "OVERVIEW",
  "INSPECTION",
  "MAINTENANCE",
];

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

function normalizePersona(input: unknown): DashboardPersona {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawKind = typeof record.kind === "string" ? record.kind.toUpperCase() : "";
  const kind = (PERSONA_KINDS as string[]).includes(rawKind)
    ? (rawKind as DashboardPersonaKind)
    : "OVERVIEW";

  return {
    kind,
    role: typeof record.role === "string" ? record.role : null,
    companyType: typeof record.companyType === "string" ? record.companyType : null,
    organizationName:
      typeof record.organizationName === "string" ? record.organizationName : null,
    isQa: record.isQa === true,
    doesFieldWork: record.doesFieldWork === true,
    doesMaintenance: record.doesMaintenance === true,
  };
}

function normalizeTrend(input: unknown): DailyTrendPoint[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const date = typeof record.date === "string" ? record.date : null;
      if (!date) {
        return null;
      }
      return { date, value: numberOrZero(record.value ?? record.count) };
    })
    .filter((item): item is DailyTrendPoint => Boolean(item));
}

function normalizeDefectFlow(input: unknown): DefectFlowPoint[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const date = typeof record.date === "string" ? record.date : null;
      if (!date) {
        return null;
      }
      return {
        date,
        opened: numberOrZero(record.opened),
        closed: numberOrZero(record.closed),
      };
    })
    .filter((item): item is DefectFlowPoint => Boolean(item));
}

function normalizeRange(input: unknown): DashboardRange | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const rawKey = typeof record.key === "string" ? record.key : "";
  if (!(RANGE_KEYS as string[]).includes(rawKey)) {
    return null;
  }
  return {
    key: rawKey as DashboardRangeKey,
    label: typeof record.label === "string" ? record.label : rawKey,
    from: typeof record.from === "string" ? record.from : "",
    to: typeof record.to === "string" ? record.to : "",
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export async function fetchDashboardMetrics(
  token: string,
  range?: DashboardRangeKey,
): Promise<DashboardMetrics> {
  const path = range ? `/dashboard?range=${encodeURIComponent(range)}` : "/dashboard";
  const dashboard = await apiRequest<DashboardApiResponse>(path, { token });

  const defectsBySeverity = normalizeSeverityData(dashboard.defectsBySeverity);
  const defectsBySlaState = normalizeSlaData(dashboard.defectsBySlaState);

  return {
    persona: normalizePersona(dashboard.persona),
    totalAssets: numberOrZero(dashboard.totalAssets),
    totalInspections: numberOrZero(dashboard.totalInspections),
    totalDefects: numberOrZero(dashboard.totalDefects),
    openDefects: numberOrZero(dashboard.openDefects),
    overdueDefects: numberOrZero(dashboard.overdueDefects),
    activeVisits: numberOrZero(dashboard.activeVisits),
    completedVisits: numberOrZero(dashboard.completedVisits),
    overdueVisits: numberOrZero(dashboard.overdueVisits),
    completionRate: numberOrZero(dashboard.completionRate),
    operationalOverdueThresholdHours: numberOrZero(
      dashboard.operationalOverdueThresholdHours,
    ),
    latestVisitActivityAt: dashboard.latestVisitActivityAt ?? null,
    range: normalizeRange(dashboard.range),
    // `assetsInScope` echoes totalAssets on a ranged API; fall back so a
    // pre-range API still populates the KPI.
    inspectedToday: numberOrZero(dashboard.inspectedToday),
    inspectedThisPeriod: numberOrZero(dashboard.inspectedThisPeriod),
    inspectedPrevPeriod: numberOrZero(dashboard.inspectedPrevPeriod),
    assetsInScope: numberOrZero(dashboard.assetsInScope ?? dashboard.totalAssets),
    assetsInScopePrev: numberOrZero(dashboard.assetsInScopePrev),
    openDefectsPrev: numberOrZero(dashboard.openDefectsPrev),
    emergencyOpen: numberOrZero(dashboard.emergencyOpen),
    emergencyUnassigned: numberOrZero(dashboard.emergencyUnassigned),
    emergencyOverdue: numberOrZero(dashboard.emergencyOverdue),
    emergencyOverduePrev: numberOrZero(dashboard.emergencyOverduePrev),
    defectFlow: normalizeDefectFlow(dashboard.defectFlow),
    avgCloseHours: numberOrZero(dashboard.avgCloseHours),
    netBacklogChange: numberOrZero(dashboard.netBacklogChange),
    assetsBySubstation: normalizeChartData(dashboard.assetsBySubstation),
    slaOnTimePct: nullableNumber(dashboard.slaOnTimePct),
    slaOnTimePctPrev: nullableNumber(dashboard.slaOnTimePctPrev),
    defectsBySeverity,
    defectsByCategory: normalizeChartData(dashboard.defectsByCategory),
    defectsByStatus: normalizeChartData(dashboard.defectsByStatus),
    defectsByAssignee: normalizeChartData(dashboard.defectsByAssignee),
    defectsByTeam: normalizeChartData(dashboard.defectsByTeam),
    defectsBySlaState,
    dailyInspectionTrend: normalizeTrend(dashboard.dailyInspectionTrend),
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
