import { apiRequest, apiRequestBlob } from "@/lib/api";
import type { ReportSavtRoute, ReportSubstation } from "@/types/reports";

export function fetchReportSubstations(token: string) {
  return apiRequest<ReportSubstation[]>("/reports/substations", { token });
}

/** SAVT routes (one KOD TIANG, From → To) for the SAVT report selector. */
export function fetchSavtRoutes(token: string) {
  return apiRequest<ReportSavtRoute[]>("/reports/savt-routes", { token });
}

/**
 * Downloads the per-route SAVT checklist (.xlsx, 1 pole per row, route-flavoured
 * meta columns + one column per live SAVT checklist item). `status` filters by
 * survey lifecycle; "ALL"/omitted = no filter. Server names it
 * `[FROM] - [TO] PENCAWANG_SAVT_CHECKLIST.xlsx` (falls back to the KOD TIANG
 * route code when a Pencawang name is missing).
 */
export async function downloadSavtRouteChecklist(
  token: string,
  route: Pick<ReportSavtRoute, "routeCode" | "fromName" | "toName">,
  status?: string,
): Promise<void> {
  const params = new URLSearchParams();
  params.set("routeCode", route.routeCode);
  if (status && status !== "ALL") params.set("status", status);
  const { blob, filename } = await apiRequestBlob(
    `/reports/savt-route/checklist.xlsx?${params.toString()}`,
    { token },
  );

  // Mirror the server's "From - To Pencawang" filename (the server sets it via
  // Content-Disposition); this fallback only applies if that header is absent.
  const fromTo =
    route.fromName?.trim() && route.toName?.trim()
      ? `${route.fromName.trim()} - ${route.toName.trim()}`
          .replace(/[<>:"/\\|?*]/g, "")
          .replace(/\s+/g, " ")
          .trim()
      : route.routeCode.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const fallbackBase = fromTo || "SAVT_ROUTE";
  triggerBrowserDownload(blob, filename ?? `${fallbackBase}_SAVT_CHECKLIST.xlsx`);
}

/**
 * Bulk "Download Checklist" — every pole across the current filter merged into a
 * single sheet. `scope: "SAVT"` exports all routes; otherwise all SAVR Pencawang
 * in `mainhead` ("ALL"/omitted = every mainhead). `status` filters by lifecycle
 * ("ALL"/omitted = no filter). The server names the file.
 */
export async function downloadBulkChecklist(
  token: string,
  opts: { scope: string; mainhead?: string; status?: string },
): Promise<void> {
  const params = new URLSearchParams();
  if (opts.scope === "SAVT") params.set("scope", "SAVT");
  if (opts.mainhead && opts.mainhead !== "ALL")
    params.set("mainhead", opts.mainhead);
  if (opts.status && opts.status !== "ALL") params.set("status", opts.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  const { blob, filename } = await apiRequestBlob(
    `/reports/bulk-checklist.xlsx${query}`,
    { token },
  );

  const fallback =
    opts.scope === "SAVT" ? "ALL_SAVT_ROUTES" : "ALL_PENCAWANG";
  triggerBrowserDownload(blob, filename ?? `${fallback}_CHECKLIST.xlsx`);
}

/**
 * Downloads the per-Pencawang inspection workbook and triggers a browser save.
 * The file is streamed from the API as an .xlsx blob.
 */
export async function downloadPencawangReport(
  token: string,
  substation: Pick<ReportSubstation, "id" | "code">,
): Promise<void> {
  const { blob, filename } = await apiRequestBlob(
    `/reports/pencawang/${encodeURIComponent(substation.id)}/inspections.xlsx`,
    { token },
  );

  const fallbackName = `ascure-pencawang-${substation.code || "report"}.xlsx`;
  triggerBrowserDownload(blob, filename ?? fallbackName);
}

/**
 * Downloads the per-Pencawang SAVR masterlist (.xlsx, 1 pole per row, checklist
 * items as columns). `status` filters by survey lifecycle status; "ALL"/omitted
 * = no filter. The server names the file `[NAMA PENCAWANG]_MASTERLIST.xlsx`.
 */
export async function downloadPencawangMasterlist(
  token: string,
  substation: Pick<ReportSubstation, "id" | "code" | "name">,
  status?: string,
): Promise<void> {
  const query =
    status && status !== "ALL" ? `?status=${encodeURIComponent(status)}` : "";
  const { blob, filename } = await apiRequestBlob(
    `/reports/pencawang/${encodeURIComponent(substation.id)}/masterlist.xlsx${query}`,
    { token },
  );

  const fallbackBase = (substation.name || substation.code || "PENCAWANG")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  triggerBrowserDownload(blob, filename ?? `${fallbackBase}_MASTERLIST.xlsx`);
}

/**
 * Downloads the per-Pencawang checklist masterlist whose columns follow the
 * ACTUAL checklist template the inspections used (1 pole per row, one column
 * per template item). Unlike downloadPencawangMasterlist (fixed SAVR-KLB
 * AppSheet layout), this always reflects the live template. `status` filters by
 * survey lifecycle; "ALL"/omitted = no filter. Server names it
 * `[NAMA PENCAWANG]_CHECKLIST.xlsx`.
 */
export async function downloadPencawangTemplateMasterlist(
  token: string,
  substation: Pick<ReportSubstation, "id" | "code" | "name">,
  status?: string,
  scope?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (status && status !== "ALL") params.set("status", status);
  if (scope && scope !== "SAVR") params.set("scope", scope);
  const query = params.toString() ? `?${params.toString()}` : "";
  const { blob, filename } = await apiRequestBlob(
    `/reports/pencawang/${encodeURIComponent(substation.id)}/template-masterlist.xlsx${query}`,
    { token },
  );

  const fallbackBase = (substation.name || substation.code || "PENCAWANG")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const scopeTag = scope && scope !== "SAVR" ? `_${scope}` : "";
  triggerBrowserDownload(blob, filename ?? `${fallbackBase}${scopeTag}_CHECKLIST.xlsx`);
}

/**
 * Downloads a network drawing as a PDF and triggers a browser save.
 * - `layout: "tree"` (default) — the logical schematic (depth/branch tree).
 * - `layout: "gps"` — pole topology plotted at real GPS positions, no basemap.
 * Pass `feederId` to export the isolation view (de-energized poles red, back-feed
 * ties amber) so the file matches what's on screen.
 */
export async function downloadSchematicPdf(
  token: string,
  substation: { id: string; code: string },
  options: { feederId?: string; layout?: "tree" | "gps" } = {},
): Promise<void> {
  const params = new URLSearchParams();
  if (options.feederId) params.set("feederId", options.feederId);
  if (options.layout) params.set("layout", options.layout);
  const query = params.toString() ? `?${params.toString()}` : "";

  const { blob, filename } = await apiRequestBlob(
    `/reports/pencawang/${encodeURIComponent(substation.id)}/schematic.pdf${query}`,
    { token },
  );

  const fallbackName = `${options.layout === "gps" ? "map" : "schematic"}-${
    substation.code || "pencawang"
  }.pdf`;
  triggerBrowserDownload(blob, filename ?? fallbackName);
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
