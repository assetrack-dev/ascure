import { apiRequest } from "@/lib/api";
import type { ManagedAssetType, UpsertAssetTypePayload } from "@/types/asset-types";

export function fetchAssetTypesForAdmin(token: string) {
  return apiRequest<ManagedAssetType[]>("/asset-types?includeInactive=true", { token });
}

export function createAssetType(token: string, payload: UpsertAssetTypePayload) {
  return apiRequest<ManagedAssetType>("/asset-types", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateAssetType(
  token: string,
  assetTypeId: string,
  payload: Partial<UpsertAssetTypePayload>,
) {
  return apiRequest<ManagedAssetType>(`/asset-types/${encodeURIComponent(assetTypeId)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export function updateAssetTypeStatus(token: string, assetTypeId: string, isActive: boolean) {
  return apiRequest<ManagedAssetType>(
    `/asset-types/${encodeURIComponent(assetTypeId)}/status`,
    {
      method: "PATCH",
      token,
      body: JSON.stringify({ isActive }),
    },
  );
}
