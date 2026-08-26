/** Mirrors the API's OperationalScope enum. SAVR/SAVT are the network pole
 *  surveys; the other four are standalone equipment scopes (no Pencawang). */
export type AssetTypeOperationalScope =
  | "SAVR"
  | "SAVT"
  | "PENCAWANG"
  | "FEEDER_PILLAR"
  | "LINK_BOX"
  | "CABLE_BRIDGE";

export const ASSET_TYPE_SCOPE_OPTIONS: Array<{
  value: AssetTypeOperationalScope | "";
  label: string;
}> = [
  { value: "", label: "No scope (generic)" },
  { value: "SAVR", label: "SAVR — Pencawang pole survey" },
  { value: "SAVT", label: "SAVT — HV route survey" },
  { value: "PENCAWANG", label: "Pencawang (standalone equipment)" },
  { value: "FEEDER_PILLAR", label: "Feeder Pillar (standalone equipment)" },
  { value: "LINK_BOX", label: "Link Box (standalone equipment)" },
  { value: "CABLE_BRIDGE", label: "Cable Bridge (standalone equipment)" },
];

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
  operationalScope?: AssetTypeOperationalScope | null;
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
  operationalScope?: AssetTypeOperationalScope | null;
  description?: string | null;
  isActive?: boolean;
  sortOrder?: number | null;
}
