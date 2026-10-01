import { apiRequest } from "@/lib/api";
import type {
  AssignPackagePayload,
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
