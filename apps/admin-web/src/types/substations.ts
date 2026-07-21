export interface ManagedSubstationMainhead {
  id: string;
  name: string;
  code?: string | null;
}

export interface ManagedSubstation {
  id: string;
  tenantId?: string;
  code: string;
  name: string;
  location?: string | null;
  isActive: boolean;
  /** The MAINHEAD this Pencawang rolls up under on the map (null = Unassigned). */
  mainheadId?: string | null;
  mainhead?: ManagedSubstationMainhead | null;
  assetCount?: number;
  visitCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
