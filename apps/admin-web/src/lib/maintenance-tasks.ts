import { apiRequest, apiRequestBlob } from "@/lib/api";
import { triggerBrowserDownload } from "@/lib/reports";
import type {
  MaintenanceOverview,
  ReportPeriod,
  ReportPeriodOptions,
  TaskFilters,
  TaskGroups,
  TaskItems,
  TnbPerformance,
  TnbToday,
} from "@/types/maintenance-tasks";

const base = "/maintenance-tasks";

function query(values: Record<string, string | number | undefined | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

/** Plan §21.2 #4: Pencawang + team groups, 20 per page — no photos. */
export function fetchTaskGroups(token: string, filters: TaskFilters, page: number) {
  return apiRequest<TaskGroups>(`${base}/groups?${query({ ...filters, page })}`, { token });
}

/** One opened group: its Kejanggalan with photos, sent-back work first. */
export function fetchTaskItems(
  token: string,
  group: { siteVisitId: string; organizationId: string; teamId: string },
  filters: TaskFilters,
) {
  const { search: _search, ...rest } = filters;
  void _search;
  return apiRequest<TaskItems>(`${base}/items?${query({ ...rest, ...group })}`, { token });
}

/** Plan §21.2 #3: the company Overview for one day (default today). */
export function fetchMaintenanceOverview(token: string, options: { date?: string; organizationId?: string }) {
  return apiRequest<MaintenanceOverview>(`${base}/overview?${query(options)}`, { token });
}

/** Plan §21.2 #5 (R7): which Pencawang / Kejanggalan a by-date ZIP would hold. */
export function fetchReportPeriod(token: string, options: ReportPeriodOptions) {
  return apiRequest<ReportPeriod>(`${base}/report-period?${query({ ...options })}`, { token });
}

/** Plan §21.2 #5: start the by-date repair-report ZIP (the server picks the Pencawang). */
export function startRepairReportsByDate(token: string, options: ReportPeriodOptions) {
  const body = Object.fromEntries(Object.entries(options).filter(([, value]) => value));
  return apiRequest<{ jobId: string; total: number }>("/maintenance-packages/repair-reports/jobs", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

/** Plan §21.2 #1: TNB Today (default today). */
export function fetchTnbToday(token: string, date: string) {
  return apiRequest<TnbToday>(`${base}/tnb/today?${query({ date })}`, { token });
}

type PerformanceQuery = { from: string; to: string; category?: string; organizationId?: string };

/** Plan §21.2 #2: TNB Performance for a period. */
export function fetchTnbPerformance(token: string, options: PerformanceQuery) {
  return apiRequest<TnbPerformance>(`${base}/tnb/performance?${query({ ...options })}`, { token });
}

export async function downloadTnbPerformance(token: string, options: PerformanceQuery) {
  const { blob, filename } = await apiRequestBlob(`${base}/tnb/performance.xlsx?${query({ ...options })}`, { token });
  triggerBrowserDownload(blob, filename ?? "prestasi-syarikat.xlsx");
}
