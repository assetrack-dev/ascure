import { apiRequest } from "@/lib/api";
import type {
  AssignPackagePayload,
  MaintenancePackageBoard,
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

export function withdrawMaintenancePackage(token: string, packageId: string) {
  return apiRequest<{ siteVisitId: string; routing: RoutingResult }>(
    `/maintenance-packages/${encodeURIComponent(packageId)}`,
    { method: "DELETE", token },
  );
}

export function assignEmergency(token: string, defectId: string, maintenanceOrganizationId: string) {
  return apiRequest<{ defectId: string }>(
    `/maintenance-packages/emergencies/${encodeURIComponent(defectId)}`,
    { method: "POST", token, body: JSON.stringify({ maintenanceOrganizationId }) },
  );
}
