export interface AssetTypeCapability {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive?: boolean | null;
}

export interface ManagedAssetType {
  id: string;
  tenantId?: string;
  code: string;
  name: string;
  capabilityId?: string | null;
  capability?: AssetTypeCapability | null;
  description?: string | null;
  isActive: boolean;
  sortOrder?: number | null;
  assetCount?: number;
  templateCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpsertAssetTypePayload {
  code: string;
  name: string;
  capabilityId?: string | null;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}
