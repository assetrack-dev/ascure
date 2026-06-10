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
 * Downloads the network schematic as a PDF and triggers a browser save. Pass
 * `feederId` to export the isolation view (de-energized poles in red, back-feed
 * ties in amber) so the file matches what's on screen.
 */
export async function downloadSchematicPdf(
  token: string,
  substation: { id: string; code: string },
  feederId?: string,
): Promise<void> {
  const query = feederId ? `?feederId=${encodeURIComponent(feederId)}` : "";
  const { blob, filename } = await apiRequestBlob(
    `/reports/pencawang/${encodeURIComponent(substation.id)}/schematic.pdf${query}`,
    { token },
  );

  const fallbackName = `schematic-${substation.code || "pencawang"}.pdf`;
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
