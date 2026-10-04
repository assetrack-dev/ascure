import { API_BASE_URL, ApiError, apiRequest } from "@/lib/api";
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
