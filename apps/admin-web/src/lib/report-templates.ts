import { API_BASE_URL, ApiError, apiRequest, apiRequestBlob } from "@/lib/api";
import { triggerBrowserDownload } from "@/lib/reports";

/** Asset operational scopes a report template can target (mirrors the API enum). */
export const OPERATIONAL_SCOPES = [
  "PENCAWANG",
  "FEEDER_PILLAR",
  "SAVR",
  "SAVT",
  "LINK_BOX",
  "CABLE_BRIDGE",
] as const;

export type OperationalScope = (typeof OPERATIONAL_SCOPES)[number];

export interface ReportTemplate {
  id: string;
  name: string;
  operationalScope: OperationalScope;
  fileName: string;
  version: number;
  isActive: boolean;
  createdAt: string;
}

/** All `.docx` templates for the tenant (active + superseded history). */
export function listReportTemplates(token: string) {
  return apiRequest<ReportTemplate[]>("/report-templates", { token });
}

/** Hard-delete a template (row + file). ADMIN-only on the server. */
export function deleteReportTemplate(token: string, id: string) {
  return apiRequest<{ id: string }>(
    `/report-templates/${encodeURIComponent(id)}`,
    { method: "DELETE", token },
  );
}

/**
 * Upload a `.docx` template for an operational scope. Becomes the active template
 * for that scope and supersedes the prior one. ADMIN-only on the server.
 */
export async function uploadReportTemplate(
  token: string,
  file: File,
  operationalScope: OperationalScope,
  name?: string,
): Promise<ReportTemplate> {
  const form = new FormData();
  form.append("file", file);
  form.append("operationalScope", operationalScope);
  if (name && name.trim()) {
    form.append("name", name.trim());
  }

  // Do not set Content-Type — the browser adds the multipart boundary.
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/report-templates`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch {
    throw new ApiError(
      `Unable to reach the ASCURE API at ${API_BASE_URL}. Make sure the backend is running.`,
      0,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : typeof payload === "string" && payload
          ? payload
          : "Template upload failed.";
    throw new ApiError(message, response.status, payload);
  }

  return payload as ReportTemplate;
}

/** Download the on-demand per-asset visual report PDF. */
export async function downloadAssetReportPreview(
  token: string,
  asset: { id: string; assetCode?: string },
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/reports/asset/${encodeURIComponent(asset.id)}/preview.pdf`,
    { token },
  );
  triggerBrowserDownload(
    blob,
    filename ?? `laporan-${asset.assetCode || "asset"}.pdf`,
  );
}

// ─── Batch report generation + download ─────────────────────────────────────

export interface BatchGenerateResult {
  accepted: Array<{ siteVisitId: string; label: string; totalAssets: number }>;
  skipped: Array<{ siteVisitId: string; label: string; reason: string }>;
}

export interface BatchStatusEntry {
  siteVisitId: string;
  run: {
    status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | string;
    totalAssets: number;
    processedAssets: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  report: { version: number; partCount: number; generatedAt: string } | null;
}

/** Queue report compiles for several surveys; the server runs them one at a
 *  time in the background. Returns which were accepted vs skipped (with why). */
export function batchGenerateReports(
  token: string,
  siteVisitIds: string[],
): Promise<BatchGenerateResult> {
  return apiRequest<BatchGenerateResult>("/reports/batch-generate", {
    method: "POST",
    token,
    body: JSON.stringify({ siteVisitIds }),
  });
}

/** One poll for a whole selection: latest run + latest compiled version each. */
export function fetchBatchReportStatus(
  token: string,
  siteVisitIds: string[],
): Promise<BatchStatusEntry[]> {
  const ids = siteVisitIds.map(encodeURIComponent).join(",");
  return apiRequest<BatchStatusEntry[]>(`/reports/batch-status?ids=${ids}`, {
    token,
  });
}

/** Download the latest compiled report of each selected visit as ONE ZIP. */
export async function downloadReportsZip(
  token: string,
  siteVisitIds: string[],
): Promise<void> {
  const ids = siteVisitIds.map(encodeURIComponent).join(",");
  const { blob, filename } = await apiRequestBlob(
    `/reports/batch-download.zip?ids=${ids}`,
    { token },
  );
  triggerBrowserDownload(blob, filename ?? "ascure-laporan.zip");
}

// ─── Defect-report ZIP (background job) ─────────────────────────────────────
// The ZIP builds server-side (each Laporan Kejanggalan is generated fresh —
// a 30-survey batch takes minutes): start a job, poll it, then download the
// finished file. Surveys without defects land in the ZIP's SENARAI.txt.

export interface DefectZipJobStatus {
  status: "RUNNING" | "COMPLETED" | "FAILED" | string;
  processed: number;
  total: number;
  currentLabel: string | null;
  error: string | null;
}

/** Kick off the background ZIP build; returns the job to poll. Max 40. */
export function startDefectReportsZip(
  token: string,
  siteVisitIds: string[],
): Promise<{ jobId: string; total: number }> {
  return apiRequest<{ jobId: string; total: number }>(
    "/reports/defect-reports/jobs",
    { method: "POST", token, body: JSON.stringify({ siteVisitIds }) },
  );
}

export function fetchDefectReportsZipStatus(
  token: string,
  jobId: string,
): Promise<DefectZipJobStatus> {
  return apiRequest<DefectZipJobStatus>(
    `/reports/defect-reports/jobs/${encodeURIComponent(jobId)}`,
    { token },
  );
}

/** Download a COMPLETED job's ZIP (kept ~2h server-side). */
export async function downloadDefectReportsZipFile(
  token: string,
  jobId: string,
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/reports/defect-reports/jobs/${encodeURIComponent(jobId)}/download.zip`,
    { token },
  );
  triggerBrowserDownload(blob, filename ?? "laporan-kejanggalan.zip");
}

/** Download the on-demand defect report (Laporan Kejanggalan): defect poles
 *  only, colour-coded A/B/C categories + photos, ~3 poles per page — the
 *  handover format for the maintenance team. Always current data. */
export async function downloadDefectReport(
  token: string,
  siteVisit: { id: string; pencawangCode?: string },
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/reports/site-visit/${encodeURIComponent(siteVisit.id)}/defect-report.pdf`,
    { token },
  );
  triggerBrowserDownload(
    blob,
    filename ?? `laporan-kejanggalan-${siteVisit.pencawangCode || "survey"}.pdf`,
  );
}

/** Download a frozen compiled survey report PDF (latest version). `part`
 *  selects the volume (Jilid) when the survey compiled into several. */
export async function downloadCompiledReport(
  token: string,
  siteVisit: { id: string; pencawangCode?: string },
  part?: number,
): Promise<void> {
  const query = part ? `?part=${encodeURIComponent(part)}` : "";
  const { blob, filename } = await apiRequestBlob(
    `/reports/site-visit/${encodeURIComponent(siteVisit.id)}/report.pdf${query}`,
    { token },
  );
  triggerBrowserDownload(
    blob,
    filename ??
      `laporan-${siteVisit.pencawangCode || "survey"}${part ? `-jilid-${part}` : ""}.pdf`,
  );
}
