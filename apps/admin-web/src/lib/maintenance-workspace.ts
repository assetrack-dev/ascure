import { apiRequest } from "@/lib/api";
import type {
  AssignMaintenanceLanePayload,
  MaintenanceWorkspace,
} from "@/types/maintenance-workspace";

export function fetchMaintenanceWorkspace(token: string) {
  return apiRequest<MaintenanceWorkspace>("/defects/maintenance-workspace", { token });
}

export function assignMaintenanceLane(
  token: string,
  payload: AssignMaintenanceLanePayload,
) {
  return apiRequest<{ assigned: number }>("/defects/maintenance-workspace/assign", {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}
