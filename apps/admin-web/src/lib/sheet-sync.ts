import { apiRequest, apiRequestBlob } from "@/lib/api";
import { triggerBrowserDownload } from "@/lib/reports";

/** docs/PLAN-google-sheet-repair-sync.md — counts of one sync run. */
export interface SheetSyncSummary {
  spreadsheetTitle: string;
  sheetTitle: string;
  rows: number;
  matched: number;
  pencawangNotFound: number;
  poleNotFound: number;
  gpsMismatch: number;
  noGps: number;
  duplicateRows: number;
  verifiedRepairs: number;
  noColumn: number;
  written: number;
  updated: number;
  alreadyCorrect: number;
  clashes: number;
  cleared: number;
  issuesTruncated: boolean;
}

export interface SheetSyncRun {
  id: string;
  targetId: string;
  trigger: "NIGHTLY" | "MANUAL";
  dryRun: boolean;
  status: "RUNNING" | "OK" | "FAILED";
  error: string | null;
  summary: SheetSyncSummary | null;
  triggeredByEmail: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SheetSyncIssue {
  type: string;
  row?: number;
  pencawang?: string;
  pole?: string;
  group?: string;
  sheetValue?: string;
  ascureValue?: string;
  detail?: string;
  count?: number;
}

export interface SheetSyncTarget {
  id: string;
  name: string;
  spreadsheetId: string;
  sheetTitle: string;
  writeEnabled: boolean;
  isActive: boolean;
  cellsWritten: number;
  lastRun: SheetSyncRun | null;
}

export function fetchSheetSyncTargets(token: string) {
  return apiRequest<{ serviceAccountEmail: string | null; targets: SheetSyncTarget[] }>("/sheet-sync/targets", {
    token,
  });
}

export function createSheetSyncTarget(token: string, input: { name: string; spreadsheet: string; sheetTitle: string }) {
  return apiRequest<SheetSyncTarget>("/sheet-sync/targets", { token, method: "POST", body: JSON.stringify(input) });
}

export function updateSheetSyncTarget(
  token: string,
  id: string,
  input: Partial<Pick<SheetSyncTarget, "name" | "sheetTitle" | "writeEnabled" | "isActive">>,
) {
  return apiRequest<SheetSyncTarget>(`/sheet-sync/targets/${encodeURIComponent(id)}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function startSheetSyncRun(token: string, id: string, dryRun: boolean) {
  return apiRequest<SheetSyncRun>(`/sheet-sync/targets/${encodeURIComponent(id)}/run`, {
    token,
    method: "POST",
    body: JSON.stringify({ dryRun }),
  });
}

export function fetchSheetSyncRuns(token: string, id: string) {
  return apiRequest<SheetSyncRun[]>(`/sheet-sync/targets/${encodeURIComponent(id)}/runs`, { token });
}

export function fetchSheetSyncRun(token: string, runId: string) {
  return apiRequest<SheetSyncRun & { issues: SheetSyncIssue[]; issueCount: number }>(
    `/sheet-sync/runs/${encodeURIComponent(runId)}`,
    { token },
  );
}

export async function downloadSheetSyncCheckList(token: string, runId: string) {
  const { blob, filename } = await apiRequestBlob(`/sheet-sync/runs/${encodeURIComponent(runId)}/check-list.xlsx`, {
    token,
  });
  triggerBrowserDownload(blob, filename ?? "sheet-sync-check-list.xlsx");
}
