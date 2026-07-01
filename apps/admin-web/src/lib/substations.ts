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

export interface PencawangDeletePreview {
  pencawangId: string;
  pencawang: string | null;
  siteVisits: number;
  routeReferences: number;
  assets: number;
  feeders: number;
  /** Human reason the cascade can't proceed, or null when it can. */
  blocked: string | null;
}

export function previewDeletePencawang(token: string, substationId: string) {
  return apiRequest<PencawangDeletePreview>(
    `/substations/${encodeURIComponent(substationId)}/delete-preview`,
    { token },
  );
}

export function deletePencawangCascade(token: string, substationId: string) {
  return apiRequest<{
    deleted: boolean;
    pencawangId: string;
    deletedSiteVisits: number;
    deletedAssets: number;
    deletedFeeders: number;
  }>(`/substations/${encodeURIComponent(substationId)}/cascade`, {
    method: "DELETE",
    token,
  });
}
