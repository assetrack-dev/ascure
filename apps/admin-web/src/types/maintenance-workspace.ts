import type { DisplayStatus } from "@/types/site-visits";

export type MaintenanceCategory = "RENTIS" | "CAT_TIANG" | "SELENGGARAAN";

export type WorkspaceGovernanceMode =
  | "INSPECTOR_OWNS"
  | "QA_GATED"
  | "RELEASE_ON_REPORT";

export interface WorkspaceLaneTeam {
  id: string;
  name: string;
  count: number;
}

export interface WorkspaceLane {
  category: MaintenanceCategory;
  count: number;
  unassignedCount: number;
  inProgressCount: number;
  teams: WorkspaceLaneTeam[];
}

export interface WorkspacePackage {
  substation: {
    id: string;
    code: string;
    name: string;
    location: string | null;
  };
  mainhead: { id: string; name: string } | null;
  totalCount: number;
  emergencyCount: number;
  /** The Pencawang's survey status (its most recent visit); null if never surveyed. */
  displayStatus: DisplayStatus | null;
  displayStatusLabel: string | null;
  /** Only a COMPLETED survey (report generated) may have its defects assigned out. */
  assignable: boolean;
  lanes: WorkspaceLane[];
}

export interface WorkspaceEmergency {
  id: string;
  label: string;
  assetCode: string;
  severity: string;
  substationName: string;
  createdAt: string;
}

export interface WorkspaceAssignableTeam {
  id: string;
  name: string;
}

export interface MaintenanceWorkspace {
  generatedAt: string;
  governanceMode: WorkspaceGovernanceMode;
  totalRouted: number;
  emergencyCount: number;
  emergencies: WorkspaceEmergency[];
  packages: WorkspacePackage[];
  canAssign: boolean;
  assignableTeams: WorkspaceAssignableTeam[];
}

export interface AssignMaintenanceLanePayload {
  substationId: string;
  category?: MaintenanceCategory;
  assignedToTeamId?: string | null;
}
