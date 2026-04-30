import { apiRequest } from "@/lib/api";
import type { ChartDatum, DashboardApiResponse, DashboardMetrics } from "@/types/dashboard";

interface Substation {
  id: string;
}

interface Asset {
  assetType?: {
    code?: string | null;
    name?: string | null;
  } | null;
}

const SEVERITY_LABELS = ["Critical", "High", "Medium", "Low"];

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

async function fetchAssetsByType(token: string): Promise<ChartDatum[]> {
  const substations = await apiRequest<Substation[]>("/substations", { token });
  const assetsBySubstation = await Promise.all(
    substations.map((substation) =>
      apiRequest<Asset[]>(`/assets?substation_id=${encodeURIComponent(substation.id)}`, {
        token,
      }),
    ),
  );
  const counts = new Map<string, number>();

  assetsBySubstation.flat().forEach((asset) => {
    const label =
      asset.assetType?.name?.trim() || asset.assetType?.code?.trim() || "Unassigned";

    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([label, value]) => ({
      label,
      value,
    }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

export async function fetchDashboardMetrics(token: string): Promise<DashboardMetrics> {
  const dashboard = await apiRequest<DashboardApiResponse>("/dashboard", { token });
  let assetsByType = normalizeChartData(dashboard.assetsByType);

  if (assetsByType.length === 0) {
    try {
      assetsByType = await fetchAssetsByType(token);
    } catch {
      assetsByType = [];
    }
  }

  const defectsBySeverity = normalizeSeverityData(dashboard.defectsBySeverity);
  const criticalFromChart =
    defectsBySeverity.find((item) => item.label === "Critical")?.value ?? 0;

  return {
    totalAssets: numberOrZero(dashboard.totalAssets),
    totalDefects: numberOrZero(dashboard.totalDefects),
    openDefects: numberOrZero(dashboard.openDefects),
    criticalDefects: numberOrZero(dashboard.criticalDefects ?? criticalFromChart),
    totalInspections: numberOrZero(dashboard.totalInspections),
    defectsBySeverity,
    assetsByType,
    recentDefects: Array.isArray(dashboard.recentDefects) ? dashboard.recentDefects : [],
  };
}
