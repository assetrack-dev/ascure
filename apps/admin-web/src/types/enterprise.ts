export type EnterpriseEntityKind =
  | "organizations"
  | "mainheads"
  | "projects"
  | "work-packages";

export type EnterpriseTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface EnterpriseMetric {
  label: string;
  value: number;
}

export interface EnterpriseField {
  label: string;
  value: string | null;
}

export interface EnterpriseListRow {
  id: string;
  kind: EnterpriseEntityKind;
  name: string;
  code: string | null;
  isActive?: boolean | null;
  status?: string | null;
  primaryChip: string;
  primaryTone: EnterpriseTone;
  secondaryChip: string | null;
  secondaryTone: EnterpriseTone;
  relationLabel: string;
  filterGroup: string | null;
  extraFilterGroups: string[];
  metrics: EnterpriseMetric[];
  fields: EnterpriseField[];
  createdAt: string | null;
  updatedAt: string | null;
  searchText: string;
  raw: Record<string, unknown>;
}

export interface EnterpriseDetail extends EnterpriseListRow {
  description: string | null;
}

export interface EnterpriseOptionRecord {
  id: string;
  name: string;
  code?: string | null;
  type?: string | null;
  status?: string | null;
  isActive?: boolean | null;
  organizationId?: string | null;
  branchId?: string | null;
  mainheadId?: string | null;
  projectId?: string | null;
  clientOrganizationId?: string | null;
  operationalDomain?: string | null;
  region?: string | null;
}

export interface EnterpriseOptions {
  organizationTypes: string[];
  operationalDomains: string[];
  projectStatuses: string[];
  workPackageStatuses: string[];
  organizations: EnterpriseOptionRecord[];
  branches: EnterpriseOptionRecord[];
  mainheads: EnterpriseOptionRecord[];
  projects: EnterpriseOptionRecord[];
  workPackages: EnterpriseOptionRecord[];
}
