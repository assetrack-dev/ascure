import { apiRequest, apiRequestBlob } from "@/lib/api";
import type { ReportSubstation } from "@/types/reports";

export function fetchReportSubstations(token: string) {
  return apiRequest<ReportSubstation[]>("/reports/substations", { token });
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

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
