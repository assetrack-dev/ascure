import { apiRequest } from "@/lib/api";
import type { ManagedSubstation } from "@/types/substations";

export function fetchSubstationsForAdmin(token: string) {
  return apiRequest<ManagedSubstation[]>("/substations?includeInactive=true", {
    token,
  });
}

export function updateSubstationStatus(
  token: string,
  substationId: string,
  isActive: boolean,
) {
  return apiRequest<ManagedSubstation>(
    `/substations/${encodeURIComponent(substationId)}/status`,
    {
      method: "PATCH",
      token,
      body: JSON.stringify({ isActive }),
    },
  );
}

export function deleteSubstation(token: string, substationId: string) {
  return apiRequest<{ id: string; deleted: boolean }>(
    `/substations/${encodeURIComponent(substationId)}`,
    {
      method: "DELETE",
      token,
    },
  );
}
