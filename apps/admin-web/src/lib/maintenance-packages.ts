import { API_BASE_URL, ApiError, apiRequest, apiRequestBlob } from "@/lib/api";
import { triggerBrowserDownload } from "@/lib/reports";
import type {
  AddFindingPayload,
  AssignPackagePayload,
  FindingOptionsResponse,
  AssignPolesPayload,
  MaintenanceCategory,
  PackagePolesResponse,
  BulkAssignPackagesPayload,
  BulkAssignResult,
  MaintenancePackageBoard,
  PackageDestination,
  RoutingResult,
} from "@/types/maintenance-packages";

export function fetchMaintenancePackageBoard(token: string) {
  return apiRequest<MaintenancePackageBoard>("/maintenance-packages/board", { token });
}

export function assignMaintenancePackage(token: string, payload: AssignPackagePayload) {
  return apiRequest<{ siteVisitId: string; routing: RoutingResult }>("/maintenance-packages", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function assignMaintenancePackagesBulk(token: string, payload: BulkAssignPackagesPayload) {
  return apiRequest<BulkAssignResult>("/maintenance-packages/bulk", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function withdrawMaintenancePackage(token: string, packageId: string) {
  return apiRequest<{ siteVisitId: string; routing: RoutingResult }>(
    `/maintenance-packages/${encodeURIComponent(packageId)}`,
    { method: "DELETE", token },
  );
}

export function assignEmergency(token: string, defectId: string, destination: PackageDestination) {
  return apiRequest<{ defectId: string }>(
    `/maintenance-packages/emergencies/${encodeURIComponent(defectId)}`,
    { method: "POST", token, body: JSON.stringify(destination) },
  );
}

/** Plan §12.6 — split a Pencawang between crews pole by pole. */
export function fetchPackagePoles(token: string, siteVisitId: string) {
  return apiRequest<PackagePolesResponse>(
    `/maintenance-packages/${encodeURIComponent(siteVisitId)}/poles`,
    { token },
  );
}

export function assignPackagePoles(token: string, siteVisitId: string, payload: AssignPolesPayload) {
  return apiRequest<{ siteVisitId: string; poles: number; routing: RoutingResult }>(
    `/maintenance-packages/${encodeURIComponent(siteVisitId)}/poles`,
    { method: "POST", token, body: JSON.stringify(payload) },
  );
}

export function clearPackagePoles(
  token: string,
  siteVisitId: string,
  payload: { assetIds: string[]; category: MaintenanceCategory | null },
) {
  return apiRequest<{ siteVisitId: string; poles: number; routing: RoutingResult }>(
    `/maintenance-packages/${encodeURIComponent(siteVisitId)}/poles/clear`,
    { method: "POST", token, body: JSON.stringify(payload) },
  );
}

/** Plan §13 — the PE's surveyed poles and the checklist items a new finding can use. */
export function fetchFindingOptions(token: string, siteVisitId: string) {
  return apiRequest<FindingOptionsResponse>(
    `/maintenance-packages/${encodeURIComponent(siteVisitId)}/finding-options`,
    { token },
  );
}

/** Plan §13 — add a Kejanggalan that was not in the survey, with its condition photo. */
export async function addMaintenanceFinding(
  token: string,
  siteVisitId: string,
  payload: AddFindingPayload,
  photo: File,
) {
  const form = new FormData();
  form.append("assetId", payload.assetId);
  form.append("templateItemId", payload.templateItemId);
  if (payload.optionValue) form.append("optionValue", payload.optionValue);
  if (payload.note?.trim()) form.append("note", payload.note.trim());
  form.append("file", photo);

  // Multipart: let the browser set Content-Type (apiRequest would force JSON).
  let response: Response;
  try {
    response = await fetch(
      `${API_BASE_URL}/maintenance-packages/${encodeURIComponent(siteVisitId)}/findings`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        body: form,
      },
    );
  } catch {
    throw new ApiError(`Unable to reach the ASCURE API at ${API_BASE_URL}.`, 0);
  }
  const body = (await response.json().catch(() => null)) as
    | { defectId: string; created: boolean; message?: string | string[] }
    | null;
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body?.message.join(", ") : body?.message;
    throw new ApiError(message || "Could not add the Kejanggalan.", response.status, body);
  }
  return body as { defectId: string; created: boolean };
}

// ── Repair report (docs/PLAN-maintenance-flow.md §16) ──────────────────────

export type RepairReportOptions = {
  organizationId?: string | null;
  category?: MaintenanceCategory | null;
};

function repairReportQuery(options: RepairReportOptions) {
  const params = new URLSearchParams();
  if (options.organizationId) params.set("organizationId", options.organizationId);
  if (options.category) params.set("category", options.category);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** One Pencawang's repair report PDF for one company (DRAF until all closed). */
export async function downloadRepairReport(
  token: string,
  siteVisitId: string,
  options: RepairReportOptions,
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/maintenance-packages/${encodeURIComponent(siteVisitId)}/repair-report.pdf${repairReportQuery(options)}`,
    { token },
  );
  triggerBrowserDownload(blob, filename ?? "laporan-pembaikan.pdf");
}

export interface RepairZipJobStatus {
  status: "RUNNING" | "COMPLETED" | "FAILED" | string;
  processed: number;
  total: number;
  currentLabel: string | null;
  error: string | null;
}

/** Many Pencawang → one ZIP, built in the background (max 40). */
export function startRepairReportsZip(
  token: string,
  siteVisitIds: string[],
  options: RepairReportOptions,
): Promise<{ jobId: string; total: number }> {
  return apiRequest<{ jobId: string; total: number }>("/maintenance-packages/repair-reports/jobs", {
    method: "POST",
    token,
    body: JSON.stringify({
      siteVisitIds,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      ...(options.category ? { category: options.category } : {}),
    }),
  });
}

export function fetchRepairReportsZipStatus(token: string, jobId: string) {
  return apiRequest<RepairZipJobStatus>(
    `/maintenance-packages/repair-reports/jobs/${encodeURIComponent(jobId)}`,
    { token },
  );
}

export async function downloadRepairReportsZipFile(token: string, jobId: string): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/maintenance-packages/repair-reports/jobs/${encodeURIComponent(jobId)}/download.zip`,
    { token },
  );
  triggerBrowserDownload(blob, filename ?? "laporan-pembaikan.zip");
}
