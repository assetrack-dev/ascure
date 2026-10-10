import { apiRequest, apiRequestBlob } from "@/lib/api";
import { triggerBrowserDownload } from "@/lib/reports";

/** One TNB material ("LIST BARANG IMBANGAN TNB — SAVR"). */
export interface MaterialCatalogItem {
  id: string;
  catalogueNo: string;
  description: string;
  unit: string;
}

/** A material used on one Kejanggalan. */
export interface DefectMaterialLine {
  materialId: string;
  catalogueNo: string;
  description: string;
  unit: string;
  quantity: number;
}

/** Countable units take whole numbers; M / KG may carry decimals (mirrors the API). */
export const WHOLE_UNITS = new Set(["EA", "UNT", "SET"]);

export function fetchMaterialCatalog(token: string) {
  return apiRequest<MaterialCatalogItem[]>("/maintenance-materials/catalog", { token });
}

export function saveDefectMaterials(
  token: string,
  defectId: string,
  items: Array<{ materialId: string; quantity: number }>,
) {
  return apiRequest<{ defectId: string; materials: DefectMaterialLine[] }>(
    `/maintenance-materials/defects/${encodeURIComponent(defectId)}`,
    { method: "PUT", token, body: JSON.stringify({ items }) },
  );
}

/** The claim summary: per Pencawang, per-period total, per Kejanggalan. */
export async function downloadMaterialsSummary(
  token: string,
  options: { from: string; to: string; organizationId?: string | null },
): Promise<void> {
  const params = new URLSearchParams({ from: options.from, to: options.to });
  if (options.organizationId) params.set("organizationId", options.organizationId);
  const { blob, filename } = await apiRequestBlob(`/maintenance-materials/summary.xlsx?${params.toString()}`, {
    token,
  });
  triggerBrowserDownload(blob, filename ?? `Ringkasan_Bahan_${options.from}_${options.to}.xlsx`);
}

/** Read `materials` off an API payload defensively (older APIs omit it). */
export function parseMaterialLines(raw: unknown): DefectMaterialLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): DefectMaterialLine[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const quantity = Number(record.quantity);
    if (typeof record.materialId !== "string" || !Number.isFinite(quantity)) return [];
    return [
      {
        materialId: record.materialId,
        catalogueNo: String(record.catalogueNo ?? ""),
        description: String(record.description ?? ""),
        unit: String(record.unit ?? ""),
        quantity,
      },
    ];
  });
}

export function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}
