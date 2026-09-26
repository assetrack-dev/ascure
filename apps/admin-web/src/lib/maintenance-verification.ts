import { apiRequest } from "@/lib/api";
import type { VerificationQueue, VerificationTab } from "@/types/maintenance-verification";

const base = "/maintenance-verification";
const itemPath = (defectId: string, action: string) =>
  `${base}/${encodeURIComponent(defectId)}/${action}`;

export function fetchVerificationQueue(token: string, tab: VerificationTab) {
  return apiRequest<VerificationQueue>(`${base}?tab=${tab}`, { token });
}

export function verifyRepair(token: string, defectId: string, notes: string) {
  return apiRequest(itemPath(defectId, "verify"), {
    method: "POST",
    token,
    body: JSON.stringify(notes ? { notes } : {}),
  });
}

export function rejectRepair(token: string, defectId: string, reason: string) {
  return apiRequest(itemPath(defectId, "reject"), {
    method: "POST",
    token,
    body: JSON.stringify({ reason }),
  });
}

export function reopenRepair(token: string, defectId: string, reason: string) {
  return apiRequest(itemPath(defectId, "reopen"), {
    method: "POST",
    token,
    body: JSON.stringify({ reason }),
  });
}

export function reassignCannotRepair(
  token: string,
  defectId: string,
  maintenanceOrganizationId: string,
  reason: string,
) {
  return apiRequest(itemPath(defectId, "reassign"), {
    method: "POST",
    token,
    body: JSON.stringify({ maintenanceOrganizationId, reason }),
  });
}
