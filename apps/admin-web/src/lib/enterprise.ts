import { apiRequest } from "@/lib/api";
import type {
  EnterpriseDetail,
  EnterpriseEntityKind,
  EnterpriseField,
  EnterpriseListRow,
  EnterpriseMetric,
  EnterpriseTone,
} from "@/types/enterprise";

type ApiRecord = Record<string, unknown>;

const API_PATH_BY_KIND: Record<EnterpriseEntityKind, string> = {
  organizations: "/enterprise/organizations",
  projects: "/enterprise/projects",
  "work-packages": "/enterprise/work-packages",
};

function asRecord(value: unknown): ApiRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiRecord)
    : null;
}

function readString(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return null;
}

function readBoolean(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return null;
}

function readNumber(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function firstString(record: ApiRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = readString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function nestedRecord(record: ApiRecord | null, key: string) {
  return asRecord(record?.[key]);
}

function extractArray(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["data", "items", "results"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function count(record: ApiRecord | null, key: string) {
  return readNumber(nestedRecord(record, "_count"), key) ?? 0;
}

function formatEnum(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compactLabel(record: ApiRecord | null) {
  return firstString(record, ["name", "code"]) ?? "Not recorded";
}

function joinLabels(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

function statusTone(status: string | null): EnterpriseTone {
  const normalizedStatus = status?.toUpperCase();

  if (normalizedStatus === "ACTIVE" || normalizedStatus === "COMPLETED") {
    return "success";
  }

  if (normalizedStatus === "ON_HOLD" || normalizedStatus === "DRAFT") {
    return "warning";
  }

  if (normalizedStatus === "CANCELLED" || normalizedStatus === "ARCHIVED") {
    return "neutral";
  }

  return "info";
}

function organizationTone(type: string | null): EnterpriseTone {
  const normalizedType = type?.toUpperCase();

  if (normalizedType === "ASCURE") {
    return "success";
  }

  if (normalizedType === "TNB" || normalizedType === "CLIENT") {
    return "info";
  }

  if (normalizedType === "SUBCONTRACTOR") {
    return "warning";
  }

  return "neutral";
}

function stateChip(isActive: boolean | null) {
  return {
    label: isActive === false ? "Inactive" : "Active",
    tone: isActive === false ? "neutral" : "success",
  } satisfies { label: string; tone: EnterpriseTone };
}

function withSearchText<T extends Omit<EnterpriseListRow, "searchText">>(
  row: T,
): T & { searchText: string } {
  const searchableValues = [
    row.name,
    row.code,
    row.primaryChip,
    row.secondaryChip,
    row.relationLabel,
    row.filterGroup,
    ...row.fields.flatMap((field) => [field.label, field.value]),
    ...row.metrics.flatMap((metric) => [metric.label, String(metric.value)]),
  ];

  return {
    ...row,
    searchText: searchableValues
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase(),
  };
}

function normalizeOrganization(rawOrganization: unknown): EnterpriseDetail | null {
  const record = asRecord(rawOrganization);

  if (!record) {
    return null;
  }

  const id = readString(record, "id");
  const name = readString(record, "name");

  if (!id || !name) {
    return null;
  }

  const type = readString(record, "type");
  const activeState = stateChip(readBoolean(record, "isActive"));
  const parentOrganization = nestedRecord(record, "parentOrganization");
  const parentLabel = compactLabel(parentOrganization);
  const metrics: EnterpriseMetric[] = [
    { label: "Branches", value: count(record, "branches") },
    { label: "Memberships", value: count(record, "memberships") },
  ];
  const fields: EnterpriseField[] = [
    { label: "Code", value: readString(record, "code") },
    { label: "Type", value: formatEnum(type) },
    { label: "Status", value: activeState.label },
    { label: "Parent Organization", value: parentOrganization ? parentLabel : null },
  ];

  return withSearchText({
    id,
    kind: "organizations",
    name,
    code: readString(record, "code"),
    primaryChip: formatEnum(type),
    primaryTone: organizationTone(type),
    secondaryChip: activeState.label,
    secondaryTone: activeState.tone,
    relationLabel: parentOrganization ? `Parent: ${parentLabel}` : "Top-level organization",
    filterGroup: activeState.label,
    metrics,
    fields,
    description: null,
    createdAt: readString(record, "createdAt"),
    updatedAt: readString(record, "updatedAt"),
  });
}

function normalizeProject(rawProject: unknown): EnterpriseDetail | null {
  const record = asRecord(rawProject);

  if (!record) {
    return null;
  }

  const id = readString(record, "id");
  const name = readString(record, "name");

  if (!id || !name) {
    return null;
  }

  const status = readString(record, "status");
  const branch = nestedRecord(record, "branch");
  const branchOrganization = nestedRecord(branch, "organization");
  const clientOrganization = nestedRecord(record, "clientOrganization");
  const branchLabel = joinLabels([compactLabel(branchOrganization), compactLabel(branch)]);
  const clientLabel = clientOrganization ? compactLabel(clientOrganization) : null;
  const metrics: EnterpriseMetric[] = [
    { label: "Work Packages", value: count(record, "workPackages") },
    { label: "Memberships", value: count(record, "memberships") },
  ];
  const fields: EnterpriseField[] = [
    { label: "Code", value: readString(record, "code") },
    { label: "Status", value: formatEnum(status) },
    { label: "Branch", value: branchLabel || null },
    { label: "Client", value: clientLabel },
    { label: "Start Date", value: readString(record, "startDate") },
    { label: "End Date", value: readString(record, "endDate") },
  ];

  return withSearchText({
    id,
    kind: "projects",
    name,
    code: readString(record, "code"),
    primaryChip: formatEnum(status),
    primaryTone: statusTone(status),
    secondaryChip: clientLabel,
    secondaryTone: "info",
    relationLabel: branchLabel || "Branch not recorded",
    filterGroup: branch ? compactLabel(branch) : null,
    metrics,
    fields,
    description: readString(record, "description"),
    createdAt: readString(record, "createdAt"),
    updatedAt: readString(record, "updatedAt"),
  });
}

function normalizeWorkPackage(rawWorkPackage: unknown): EnterpriseDetail | null {
  const record = asRecord(rawWorkPackage);

  if (!record) {
    return null;
  }

  const id = readString(record, "id");
  const name = readString(record, "name");

  if (!id || !name) {
    return null;
  }

  const status = readString(record, "status");
  const project = nestedRecord(record, "project");
  const branch = nestedRecord(project, "branch");
  const branchOrganization = nestedRecord(branch, "organization");
  const projectLabel = compactLabel(project);
  const branchLabel = joinLabels([compactLabel(branchOrganization), compactLabel(branch)]);
  const mainhead = readString(record, "mainhead");
  const metrics: EnterpriseMetric[] = [
    { label: "Assignments", value: count(record, "assignments") },
    { label: "Site Visits", value: count(record, "siteVisits") },
  ];
  const fields: EnterpriseField[] = [
    { label: "Code", value: readString(record, "code") },
    { label: "Status", value: formatEnum(status) },
    { label: "MAINHEAD", value: mainhead },
    { label: "Area", value: readString(record, "area") },
    { label: "Project", value: projectLabel },
    { label: "Branch", value: branchLabel || null },
  ];

  return withSearchText({
    id,
    kind: "work-packages",
    name,
    code: readString(record, "code"),
    primaryChip: formatEnum(status),
    primaryTone: statusTone(status),
    secondaryChip: mainhead,
    secondaryTone: "info",
    relationLabel: projectLabel,
    filterGroup: mainhead,
    metrics,
    fields,
    description: readString(record, "description"),
    createdAt: readString(record, "createdAt"),
    updatedAt: readString(record, "updatedAt"),
  });
}

function normalizeEnterpriseEntity(
  kind: EnterpriseEntityKind,
  rawEntity: unknown,
): EnterpriseDetail | null {
  if (kind === "organizations") {
    return normalizeOrganization(rawEntity);
  }

  if (kind === "projects") {
    return normalizeProject(rawEntity);
  }

  return normalizeWorkPackage(rawEntity);
}

function sortRows(rows: EnterpriseListRow[]) {
  return [...rows].sort((left, right) =>
    left.name.localeCompare(right.name, "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

export async function fetchEnterpriseRows(
  token: string,
  kind: EnterpriseEntityKind,
): Promise<EnterpriseListRow[]> {
  const payload = await apiRequest<unknown>(API_PATH_BY_KIND[kind], { token });

  return sortRows(
    extractArray(payload)
      .map((entity) => normalizeEnterpriseEntity(kind, entity))
      .filter((entity): entity is EnterpriseDetail => Boolean(entity)),
  );
}

export async function fetchEnterpriseDetail(
  token: string,
  kind: EnterpriseEntityKind,
  id: string,
): Promise<EnterpriseDetail> {
  const payload = await apiRequest<unknown>(
    `${API_PATH_BY_KIND[kind]}/${encodeURIComponent(id)}`,
    { token },
  );
  const detail = normalizeEnterpriseEntity(kind, payload);

  if (!detail) {
    throw new Error("Unable to read enterprise detail.");
  }

  return detail;
}
