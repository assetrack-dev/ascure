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

/** Download the frozen compiled survey report PDF (latest version). */
export async function downloadCompiledReport(
  token: string,
  siteVisit: { id: string; pencawangCode?: string },
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/reports/site-visit/${encodeURIComponent(siteVisit.id)}/report.pdf`,
    { token },
  );
  triggerBrowserDownload(
    blob,
    filename ?? `laporan-${siteVisit.pencawangCode || "survey"}.pdf`,
  );
}
