import { API_BASE_URL, ApiError } from "@/lib/api";

export interface ImportCountPair {
  create: number;
  update: number;
}

export interface ImportSummary {
  pencawang: ImportCountPair;
  siteVisits: ImportCountPair;
  assets: ImportCountPair;
  inspections: ImportCountPair;
  inspectionResults: { create: number };
  itemResults: { create: number };
  defects: { create: number };
  errors: number;
  warnings: number;
  rowsSkipped: number;
}

export interface ImportCellNote {
  column?: string;
  code?: string;
  message?: string;
}

export interface ImportRowReport {
  row: number;
  uniqueId?: string | null;
  pencawangCode?: string | null;
  assetCode?: string | null;
  asset: string;
  inspection: string;
  defects: number;
  warnings: ImportCellNote[];
  errors: ImportCellNote[];
}

export interface ImportResolution {
  users: { email: string; status: string; userId: string | null }[];
  teams: { name: string; status: string }[];
  mainheads: { name: string; status: string }[];
}

export interface ImportTemplateInfo {
  id?: string;
  name?: string;
  version?: number;
  itemCount?: number;
  missingKeys?: string[];
}

export interface ImportFileInfo {
  dataRows?: number;
  matchedColumns?: number;
  unmappedHeaders?: string[];
}

export interface ImportValidateResult {
  batchId: string;
  ok: boolean;
  blocking: ImportCellNote[];
  template: ImportTemplateInfo | null;
  file: ImportFileInfo | null;
  summary: ImportSummary | null;
  resolution: ImportResolution | null;
  rows: ImportRowReport[];
}

export interface ImportCommitResult {
  batchId: string;
  ok: boolean;
  blocking: ImportCellNote[];
  applied:
    | {
        pencawang: number;
        siteVisits: number;
        assets: number;
        inspections: number;
        inspectionResults: number;
        itemResults: number;
        defects: number;
        qaLockedSkipped: number;
        rowsSkipped: number;
      }
    | null;
  pencawang: { code: string; status: string; assets?: number; inspections?: number; error?: string }[];
}

async function uploadImport<T>(
  path: string,
  token: string,
  file: File,
  batchId: string | undefined,
): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  if (batchId && batchId.trim()) {
    form.append("batchId", batchId.trim());
  }

  // NOTE: do not set Content-Type — the browser sets multipart/form-data with the
  // boundary. (apiRequest would force application/json, which breaks the upload.)
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
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
          : "Import request failed.";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

/** Dry-run: validates the .xlsx and returns the plan; writes nothing. */
export function validateImport(token: string, file: File, batchId?: string) {
  return uploadImport<ImportValidateResult>("/imports/savr-klb/validate", token, file, batchId);
}

/** Commit: re-validates then writes the foundation data. Idempotent on batchId. */
export function commitImport(token: string, file: File, batchId: string) {
  return uploadImport<ImportCommitResult>("/imports/savr-klb/commit", token, file, batchId);
}
