import type { MaintenanceCategory } from "@/types/maintenance-workspace";

export type VerificationTab = "PENDING" | "CANNOT_REPAIR" | "CLOSED" | "RETURNED";

/** Where a returned repair stands now (the Returned tab's chips). */
export type ReturnState = "WITH_CONTRACTOR" | "RESUBMITTED" | "CLOSED";
export type ReturnedStateFilter = ReturnState | "ALL";

/** The latest time TNB / the main contractor sent the repair back or re-opened it. */
export interface RepairReturn {
  at: string;
  by: { id: string; name: string } | null;
  reason: string | null;
  kind: "SENT_BACK" | "REOPENED";
  /** How many times it has been returned. */
  count: number;
}

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
  /** Added during maintenance, not in the survey (plan §13). */
  isNewFinding?: boolean;
  addedBy?: { id: string; name: string } | null;
  addedAt?: string | null;
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
  /** The team holding the work. */
  team?: { id: string; name: string } | null;
  /** Returned before (null = never). */
  lastReturn?: RepairReturn | null;
  returnState?: ReturnState | null;
  /** Repair photos the crew added after the latest return. */
  photosSinceReturn?: number;
  asset: {
    id: string;
    assetCode: string;
    /** NO TIANG LAMA as the reports read it (plan §20, P3). */
    noTiangLama?: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  /** The Lama before a maintenance crew corrected it on site (plan §20, P3). */
  noTiangLamaPrevious?: string | null;
  /** The kind of repair done (plan §20, P2 — Rentis: KAEDAH LAZIM …). */
  repairMethod?: { id: string; label: string | null; note: string | null } | null;
  /** The crew changed the photos after submitting — look again (plan §20, P1). */
  photosChangedAfterSubmission?: boolean;
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
  counts: { pending: number; cannotRepair: number; returned?: number };
  returnedStates?: Record<ReturnState, number>;
  tab: VerificationTab;
  returnedState?: ReturnedStateFilter | null;
  items: VerificationItem[];
}

/** Plan §19 (N54): narrowing shared by the grouped view and one opened group. */
export interface VerificationFilters {
  search?: string;
  organizationId?: string;
  category?: string;
  from?: string;
  to?: string;
  /** Returned tab only. */
  returnedState?: ReturnedStateFilter;
}

export interface VerificationGroup {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  mainhead: string | null;
  company: { id: string; name: string };
  count: number;
  emergencies: number;
  categories: string[];
  oldestAt: string | null;
  latestAt: string | null;
}

export interface VerificationGroups {
  actor: VerificationQueue["actor"];
  counts: VerificationQueue["counts"];
  returnedStates?: VerificationQueue["returnedStates"];
  tab: VerificationTab;
  returnedState?: ReturnedStateFilter | null;
  page: number;
  pageSize: number;
  totalGroups: number;
  companies: Array<{ id: string; name: string }>;
  groups: VerificationGroup[];
}
