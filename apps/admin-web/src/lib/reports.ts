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
