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

/** A crew the actor may hand work to (TNB: any contractor's; MC: own group's). */
export interface PackageTeam {
  id: string;
  name: string;
  code?: string | null;
  organizationId: string;
}

/** COMPANY = a contractor's own Manager (re-teams its work) or Supervisor (view only) — plan §15. */
export type PackageActorKind = "ADMIN" | "TNB" | "MAIN_CONTRACTOR" | "COMPANY";

/** Repair progress (plan §15): todo = not started yet; awaiting = done, waiting for verification. */
export interface PackageProgress {
  todo: number;
  inProgress: number;
  awaiting: number;
  closed: number;
}

export interface PackageLane {
  category: MaintenanceCategory;
  total: number;
  open: number;
  finished: number;
  /** Routed, not finished, no team yet (absent from older APIs). */
  noTeam?: number;
  /** Open, not routed to any company (absent from older APIs). */
  unrouted?: number;
  /** Distinct poles carrying this work type (absent from older APIs). */
  poles?: number;
  progress?: PackageProgress;
  organization: PackageOrgRef | null;
  team: PackageOrgRef | null;
  /** False when the lane sits with a company outside a Main Contractor's group. */
  canAssign: boolean;
}

export interface MaintenancePackageRecord {
  id: string;
  /** null = the whole Pencawang. */
  category: MaintenanceCategory | null;
  organization: PackageOrgRef;
  /** null = the company's Manager picks the team. */
  team: PackageOrgRef | null;
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
  latitude: number | null;
  longitude: number | null;
  /** May the actor (re)assign the WHOLE Pencawang. */
  canAssign: boolean;
  mainhead: PackageOrgRef | null;
  cycleNumber: number | null;
  operationalScope: string | null;
  lifecycleStatus: string | null;
  laporanSelesaiAt: string | null;
  suggestedOrganizationId: string | null;
  poleCount: number;
  totals: { total: number; open: number; finished: number; unrouted: number; noTeam?: number };
  progress?: PackageProgress;
  lanes: PackageLane[];
  /** Plan §12.6: poles handed to other crews, grouped by owner + work type. */
  poleSplits: PackagePoleSplit[];
  packages: MaintenancePackageRecord[];
}

export interface PackagePoleSplit {
  /** null = every work type on those poles. */
  category: MaintenanceCategory | null;
  organization: PackageOrgRef;
  team: PackageOrgRef | null;
  poles: number;
}

export interface PackagePoleLane {
  category: MaintenanceCategory;
  total: number;
  open: number;
  organization: PackageOrgRef | null;
  team: PackageOrgRef | null;
  /** POLE = split off; PACKAGE = follows the Pencawang; null = nobody yet. */
  source: "POLE" | "PACKAGE" | null;
  canAssign: boolean;
}

export interface PackagePole {
  assetId: string;
  assetCode: string;
  noTiangLama: string | null;
  latitude: number | null;
  longitude: number | null;
  total: number;
  open: number;
  canAssign: boolean;
  split: boolean;
  lanes: PackagePoleLane[];
}

export interface PackagePolesResponse {
  siteVisitId: string;
  pencawangName: string | null;
  pencawangCode: string | null;
  canAssign: boolean;
  poles: PackagePole[];
}

export interface AssignPolesPayload extends PackageDestination {
  assetIds: string[];
  category: MaintenanceCategory | null;
  dueDate: string | null;
  notes: string | null;
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
  actorKind: PackageActorKind;
  canAssign: boolean;
  companies: PackageCompany[];
  teams: PackageTeam[];
  emergencies: UnroutedEmergency[];
  pencawangs: PackagePencawang[];
}

/** Where work goes: a company (its Manager picks the team) or a team. */
export interface PackageDestination {
  maintenanceOrganizationId: string;
  assignedTeamId: string | null;
}

export interface AssignPackagePayload extends PackageDestination {
  siteVisitId: string;
  category: MaintenanceCategory | null;
  dueDate: string | null;
  notes: string | null;
}

export interface BulkAssignPackagesPayload extends PackageDestination {
  siteVisitIds: string[];
  category: MaintenanceCategory | null;
  dueDate: string | null;
  notes: string | null;
}

export interface RoutingResult {
  routed: number;
  moved: number;
  kept: number;
  teamAssigned: number;
}

export type BulkAssignRow =
  | { siteVisitId: string; status: "ASSIGNED"; routing: RoutingResult }
  | { siteVisitId: string; status: "SKIPPED"; reason: string };

export interface BulkAssignResult {
  assigned: number;
  skipped: number;
  results: BulkAssignRow[];
}

// ── New finding during maintenance (docs/PLAN-maintenance-flow.md §13) ──────

export interface FindingOption {
  value: string;
  label: string;
  severity: string;
}

export interface FindingItem {
  templateItemId: string;
  label: string;
  section: string | null;
  category: MaintenanceCategory;
  severity: string;
  inputType: string;
  /** Empty for a yes/no item — adding it IS the defect answer. */
  options: FindingOption[];
}

export interface FindingPole {
  assetId: string;
  assetCode: string;
  noTiangLama: string | null;
  latitude: number | null;
  longitude: number | null;
  templateId: string;
}

export interface FindingOptionsResponse {
  siteVisitId: string;
  canAdd: boolean;
  poles: FindingPole[];
  findingTemplates: Array<{ templateId: string; items: FindingItem[] }>;
}

export interface AddFindingPayload {
  assetId: string;
  templateItemId: string;
  optionValue?: string;
  note?: string;
}
