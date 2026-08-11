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
  /** Manual office pin (null = position derived from the latest check-in). */
  latitude?: number | null;
  longitude?: number | null;
  locationSetAt?: string | null;
  locationSetByEmail?: string | null;
  /** The position map consumers show: manual pin, else latest check-in GPS. */
  effectiveLatitude?: number | null;
  effectiveLongitude?: number | null;
  locationSource?: "MANUAL" | "CHECK_IN" | null;
  isActive: boolean;
  /** The MAINHEAD this Pencawang rolls up under on the map (null = Unassigned). */
  mainheadId?: string | null;
  mainhead?: ManagedSubstationMainhead | null;
  assetCount?: number;
  visitCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
