import type { MaintenanceCategory } from "@/types/maintenance-workspace";

export type { MaintenanceCategory };

export interface PackageCompany {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  parentOrganizationId?: string | null;
}

export interface PackageOrgRef {
  id: string;
  name: string;
}

export interface PackageLane {
  category: MaintenanceCategory;
  total: number;
  open: number;
  finished: number;
  organization: PackageOrgRef | null;
}

export interface MaintenancePackageRecord {
  id: string;
  /** null = the whole Pencawang. */
  category: MaintenanceCategory | null;
  organization: PackageOrgRef;
  dueDate: string | null;
  notes: string | null;
  assignedAt: string;
  assignedBy: { id: string; name: string } | null;
}

export interface PackagePencawang {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  substationId: string | null;
  mainhead: PackageOrgRef | null;
  cycleNumber: number | null;
  operationalScope: string | null;
  lifecycleStatus: string | null;
  laporanSelesaiAt: string | null;
  suggestedOrganizationId: string | null;
  poleCount: number;
  totals: { total: number; open: number; finished: number; unrouted: number };
  lanes: PackageLane[];
  packages: MaintenancePackageRecord[];
}

export interface UnroutedEmergency {
  defectId: string;
  label: string;
  remark: string | null;
  severity: string;
  createdAt: string;
  asset: { id: string; assetCode: string };
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: PackageOrgRef | null;
}

export interface MaintenancePackageBoard {
  canAssign: boolean;
  companies: PackageCompany[];
  emergencies: UnroutedEmergency[];
  pencawangs: PackagePencawang[];
}

export interface AssignPackagePayload {
  siteVisitId: string;
  category: MaintenanceCategory | null;
  maintenanceOrganizationId: string;
  dueDate: string | null;
  notes: string | null;
}

export interface RoutingResult {
  routed: number;
  moved: number;
  kept: number;
}
