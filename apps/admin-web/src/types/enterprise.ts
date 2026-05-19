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
  primaryChip: string;
  primaryTone: EnterpriseTone;
  secondaryChip: string | null;
  secondaryTone: EnterpriseTone;
  relationLabel: string;
  filterGroup: string | null;
  metrics: EnterpriseMetric[];
  fields: EnterpriseField[];
  createdAt: string | null;
  updatedAt: string | null;
  searchText: string;
}

export interface EnterpriseDetail extends EnterpriseListRow {
  description: string | null;
}
