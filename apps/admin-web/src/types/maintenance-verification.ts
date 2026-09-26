import type { MaintenanceCategory } from "@/types/maintenance-workspace";

export type VerificationTab = "PENDING" | "CANNOT_REPAIR" | "CLOSED";

export interface RepairEvidence {
  id: string;
  evidenceType: string;
  filename: string | null;
  path: string | null;
  url: string | null;
  note: string | null;
  latitude: number | null;
  longitude: number | null;
  timestamp: string | null;
  createdAt: string;
}

export interface VerificationItem {
  id: string;
  label: string;
  remark: string | null;
  severity: string;
  isEmergency: boolean;
  category: MaintenanceCategory | null;
  lifecycleStatus: string | null;
  resolutionOutcome: string | null;
  cannotRepair: boolean;
  maintenanceNotes: string | null;
  maintainedAt: string | null;
  maintainedBy: { id: string; name: string } | null;
  closedAt: string | null;
  closedBy: { id: string; name: string } | null;
  closureNotes: string | null;
  company: { id: string; name: string } | null;
  asset: { id: string; assetCode: string; latitude: number | null; longitude: number | null };
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: { id: string; name: string } | null;
  evidence: RepairEvidence[];
}

export interface VerificationQueue {
  actor: {
    kind: "ADMIN" | "TNB" | "MAIN_CONTRACTOR";
    canVerify: boolean;
    canDecideCannotRepair: boolean;
    canReopen: boolean;
  };
  companies: Array<{ id: string; name: string; code: string | null }>;
  counts: { pending: number; cannotRepair: number };
  tab: VerificationTab;
  items: VerificationItem[];
}
