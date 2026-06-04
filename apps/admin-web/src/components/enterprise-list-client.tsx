"use client";

import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
  GitBranch,
  MapPinned,
  Network,
  PackageCheck,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  createEnterpriseEntity,
  fetchEnterpriseOptions,
  fetchEnterpriseRows,
  updateEnterpriseEntity,
  updateEnterpriseOperationalStatus,
} from "@/lib/enterprise";
import {
  capabilityGroupFor,
  groupCapabilities,
  isAssignableCapability,
  MAINHEAD_PICKER_GROUP_KEYS,
  type CapabilityGroupKey,
} from "@/lib/capability-groups";
import type { AuthSession } from "@/types/auth";
import type {
  EnterpriseEntityKind,
  EnterpriseListRow,
  EnterpriseOptions,
  EnterpriseTone,
} from "@/types/enterprise";

type FilterValue = "ALL" | string;
type ModalMode = "create" | "edit";

interface EnterpriseFormState {
  name: string;
  code: string;
  type: string;
  status: string;
  isActive: boolean;
  organizationId: string;
  branchId: string;
  operationalRegionId: string;
  branchName: string;
  branchCode: string;
  region: string;
  state: string;
  mainheadId: string;
  projectId: string;
  operationalDomain: string;
  startDate: string;
  endDate: string;
  area: string;
  description: string;
  capabilityIds: string[];
}

const PAGE_CONFIG: Record<
  EnterpriseEntityKind,
  {
    eyebrow: string;
    title: string;
    basePath: string;
    searchPlaceholder: string;
    primaryFilterLabel: string;
    groupFilterLabel: string;
    extraFilterLabel?: string;
    emptyLabel: string;
    icon: typeof Building2;
    hasDetail?: boolean;
  }
> = {
  organizations: {
    eyebrow: "Enterprise Visibility",
    title: "Organizations",
    basePath: "/organizations",
    searchPlaceholder: "Search organizations",
    primaryFilterLabel: "All types",
    groupFilterLabel: "All states",
    extraFilterLabel: "All capabilities",
    emptyLabel: "No organizations found",
    icon: Building2,
  },
  branches: {
    eyebrow: "Operational Configuration",
    title: "Branches",
    basePath: "/branches",
    searchPlaceholder: "Search branches",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All organizations",
    extraFilterLabel: "All capabilities",
    emptyLabel: "No branches found",
    icon: GitBranch,
    hasDetail: false,
  },
  "operational-regions": {
    eyebrow: "Operational Configuration",
    title: "Operational Regions",
    basePath: "/operational-regions",
    searchPlaceholder: "Search regions",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All states",
    emptyLabel: "No operational regions found",
    icon: MapPinned,
    hasDetail: false,
  },
  capabilities: {
    eyebrow: "Operational Configuration",
    title: "Capabilities",
    basePath: "/capabilities",
    searchPlaceholder: "Search capabilities",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All states",
    emptyLabel: "No capabilities found",
    icon: Tags,
    hasDetail: false,
  },
  mainheads: {
    eyebrow: "Enterprise Visibility",
    title: "MAINHEAD",
    basePath: "/mainheads",
    searchPlaceholder: "Search MAINHEAD",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All branches",
    emptyLabel: "No MAINHEAD records found",
    icon: Network,
  },
  projects: {
    eyebrow: "Enterprise Visibility",
    title: "Projects",
    basePath: "/projects",
    searchPlaceholder: "Search projects",
    primaryFilterLabel: "All statuses",
    groupFilterLabel: "All branches",
    extraFilterLabel: "All domains",
    emptyLabel: "No projects found",
    icon: FolderKanban,
  },
  teams: {
    eyebrow: "Operational Configuration",
    title: "Teams",
    basePath: "/teams",
    searchPlaceholder: "Search teams",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All organizations",
    extraFilterLabel: "All capabilities",
    emptyLabel: "No teams found",
    icon: Users,
    hasDetail: false,
  },
  "work-packages": {
    eyebrow: "Enterprise Visibility",
    title: "Work Packages",
    basePath: "/work-packages",
    searchPlaceholder: "Search work packages",
    primaryFilterLabel: "All statuses",
    groupFilterLabel: "All MAINHEAD",
    extraFilterLabel: "All domains",
    emptyLabel: "No work packages found",
    icon: PackageCheck,
  },
};

const inputClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";

const DEFAULT_ENTERPRISE_FORM: EnterpriseFormState = {
  name: "",
  code: "",
  type: "OTHER",
  status: "ACTIVE",
  isActive: true,
  organizationId: "",
  branchId: "",
  operationalRegionId: "",
  branchName: "",
  branchCode: "",
  region: "",
  state: "",
  mainheadId: "",
  projectId: "",
  operationalDomain: "",
  startDate: "",
  endDate: "",
  area: "",
  description: "",
  capabilityIds: [],
};

function toneClassName(tone: EnterpriseTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (tone === "info") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function Chip({ label, tone }: { label: string | null; tone: EnterpriseTone }) {
  if (!label) {
    return null;
  }

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClassName(tone)}`}>
      {label}
    </span>
  );
}

function formatDate(date: string | null) {
  if (!date) {
    return "Not recorded";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function formatEnum(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readRawString(row: EnterpriseListRow | null, key: string) {
  const value = row?.raw[key];

  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readRawBoolean(row: EnterpriseListRow | null, key: string) {
  const value = row?.raw[key];

  return typeof value === "boolean" ? value : null;
}

function nestedRaw(row: EnterpriseListRow | null, key: string) {
  const value = row?.raw[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNestedString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function readCapabilityIds(row: EnterpriseListRow | null) {
  const assignments = row?.raw.capabilityAssignments;

  if (!Array.isArray(assignments)) {
    return [];
  }

  return assignments
    .map((assignment) => {
      if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
        return "";
      }

      const capability = (assignment as Record<string, unknown>).capability;

      if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
        return "";
      }

      const id = (capability as Record<string, unknown>).id;

      return typeof id === "string" ? id : "";
    })
    .filter((id) => id);
}

function toDateInputValue(date: string | null | undefined) {
  if (!date) {
    return "";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

function optionLabel(option: { name: string; code?: string | null }) {
  return option.code ? `${option.code} - ${option.name}` : option.name;
}

function createInitialForm(kind: EnterpriseEntityKind): EnterpriseFormState {
  return {
    ...DEFAULT_ENTERPRISE_FORM,
    type: "OTHER",
    status: kind === "projects" || kind === "work-packages" ? "ACTIVE" : "ACTIVE",
  };
}

function createFormFromRow(
  kind: EnterpriseEntityKind,
  row: EnterpriseListRow,
): EnterpriseFormState {
  const branch = nestedRaw(row, "branch");
  const operationalRegion = nestedRaw(row, "operationalRegion");
  const organization = nestedRaw(row, "organization");
  const branchOrganization = branch?.organization;

  return {
    ...createInitialForm(kind),
    name: row.name,
    code: row.code ?? "",
    type: readRawString(row, "type") || "OTHER",
    status: readRawString(row, "status") || (row.isActive === false ? "ARCHIVED" : "ACTIVE"),
    isActive: readRawBoolean(row, "isActive") ?? row.isActive !== false,
    organizationId:
      readRawString(row, "organizationId") ||
      readRawString(row, "clientOrganizationId") ||
      readNestedString(organization, "id") ||
      readNestedString(
        branchOrganization && typeof branchOrganization === "object"
          ? (branchOrganization as Record<string, unknown>)
          : null,
        "id",
      ),
    branchId: readRawString(row, "branchId") || readNestedString(branch, "id"),
    operationalRegionId:
      readRawString(row, "operationalRegionId") ||
      readNestedString(operationalRegion, "id"),
    branchName: readNestedString(branch, "name"),
    branchCode: readNestedString(branch, "code"),
    region: readRawString(row, "region") || readNestedString(branch, "region"),
    state: readRawString(row, "state"),
    mainheadId:
      readRawString(row, "mainheadId") ||
      readNestedString(nestedRaw(row, "mainheadRecord"), "id") ||
      readNestedString(nestedRaw(row, "mainhead"), "id"),
    projectId: readRawString(row, "projectId") || readNestedString(nestedRaw(row, "project"), "id"),
    operationalDomain: readRawString(row, "operationalDomain"),
    startDate: toDateInputValue(readRawString(row, "startDate")),
    endDate: toDateInputValue(readRawString(row, "endDate")),
    area: readRawString(row, "area"),
    description: readRawString(row, "description"),
    capabilityIds: readCapabilityIds(row),
  };
}

function buildEnterprisePayload(kind: EnterpriseEntityKind, form: EnterpriseFormState) {
  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    code:
      kind === "capabilities" || kind === "teams" || kind === "operational-regions"
        ? form.code.trim()
        : form.code.trim() || null,
  };

  if (kind === "organizations") {
    payload.type = form.type || "OTHER";
    payload.isActive = form.isActive;
    payload.capabilityIds = form.capabilityIds;
  }

  if (kind === "branches") {
    payload.organizationId = form.organizationId;
    payload.region = form.region.trim() || null;
    payload.isActive = form.isActive;
    payload.capabilityIds = form.capabilityIds;
  }

  if (kind === "operational-regions") {
    payload.state = form.state.trim() || null;
    payload.isActive = form.isActive;
  }

  if (kind === "capabilities") {
    payload.description = form.description.trim() || null;
    payload.isActive = form.isActive;
  }

  if (kind === "mainheads") {
    payload.description = form.description.trim() || null;
    payload.isActive = form.isActive;
    payload.operationalRegionId = form.operationalRegionId || null;
    payload.capabilityIds = form.capabilityIds;
  }

  if (kind === "projects") {
    payload.description = form.description.trim() || null;
    payload.status = form.status || "ACTIVE";
    payload.mainheadId = form.mainheadId || null;
    payload.organizationId = form.organizationId || null;
    payload.operationalDomain = form.operationalDomain || null;
    payload.startDate = form.startDate || null;
    payload.endDate = form.endDate || null;
  }

  if (kind === "work-packages") {
    payload.projectId = form.projectId;
    payload.mainheadId = form.mainheadId || null;
    payload.area = form.area.trim() || null;
    payload.description = form.description.trim() || null;
    payload.status = form.status || "ACTIVE";
    payload.operationalDomain = form.operationalDomain || null;
  }

  if (kind === "teams") {
    payload.organizationId = form.organizationId || null;
    payload.branchId = form.branchId || null;
    payload.mainheadId = form.mainheadId || null;
    payload.isActive = form.isActive;
    payload.capabilityIds = form.capabilityIds;
  }

  return payload;
}

function CapabilityPicker({
  values,
  options,
  onChange,
  groupKeys,
}: {
  values: string[];
  options: EnterpriseOptions | null;
  onChange: (nextValues: string[]) => void;
  /**
   * Optional per-context allow-list. When provided, only capabilities whose
   * group key is in this set are rendered. Used by the MAINHEAD modal to
   * enforce Governance G2 (MAINHEAD capabilities limited to Asset Domains).
   * Org / Branch / Team pickers omit this prop and continue to render all
   * three groups.
   */
  groupKeys?: ReadonlyArray<CapabilityGroupKey>;
}) {
  if (!options?.capabilities.length) {
    return null;
  }

  const allowedGroups = groupKeys ? new Set(groupKeys) : null;
  const assignable = options.capabilities
    .filter(isAssignableCapability)
    .filter(
      (capability) =>
        !allowedGroups || allowedGroups.has(capabilityGroupFor(capability.code)),
    );

  if (assignable.length === 0) {
    return null;
  }

  const groups = groupCapabilities(assignable);

  function toggleCapability(capabilityId: string, checked: boolean) {
    onChange(
      checked
        ? Array.from(new Set([...values, capabilityId]))
        : values.filter((id) => id !== capabilityId),
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <fieldset
          key={group.key}
          className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
        >
          <legend className="px-1 text-sm font-semibold text-slate-700">
            {group.title}
          </legend>
          <p className="px-1 text-xs text-slate-500">{group.caption}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {group.items.map((capability) => (
              <label
                key={capability.id}
                className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={values.includes(capability.id)}
                  onChange={(event) =>
                    toggleCapability(capability.id, event.target.checked)
                  }
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                <span className="truncate">{optionLabel(capability)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function EnterpriseFormModal({
  kind,
  mode,
  values,
  options,
  error,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  kind: EnterpriseEntityKind;
  mode: ModalMode;
  values: EnterpriseFormState;
  options: EnterpriseOptions | null;
  error: string;
  isSaving: boolean;
  onChange: <K extends keyof EnterpriseFormState>(
    field: K,
    value: EnterpriseFormState[K],
  ) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const config = PAGE_CONFIG[kind];
  const isCreateMode = mode === "create";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              {isCreateMode ? "New Record" : "Edit Record"}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {isCreateMode ? `Create ${config.title}` : `Update ${config.title}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close enterprise modal"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Name</span>
              <input
                type="text"
                value={values.name}
                onChange={(event) => onChange("name", event.target.value)}
                className={`${inputClassName} mt-1.5`}
                required
                maxLength={255}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Code</span>
              <input
                type="text"
                value={values.code}
                onChange={(event) => onChange("code", event.target.value)}
                className={`${inputClassName} mt-1.5`}
                required={
                  kind === "capabilities" ||
                  kind === "teams" ||
                  kind === "operational-regions"
                }
                maxLength={64}
              />
            </label>
          </div>

          {kind === "organizations" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Type</span>
                  <select
                    value={values.type}
                    onChange={(event) => onChange("type", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    {(options?.organizationTypes.length
                      ? options.organizationTypes
                      : ["ASCURE", "TNB", "SUBCONTRACTOR", "CONSULTANT", "CLIENT", "OTHER"]
                    ).map((type) => (
                      <option key={type} value={type}>
                        {formatEnum(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-7 inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={values.isActive}
                    onChange={(event) => onChange("isActive", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  Active
                </label>
              </div>
              <CapabilityPicker
                values={values.capabilityIds}
                options={options}
                onChange={(nextValues) => onChange("capabilityIds", nextValues)}
              />
            </>
          ) : null}

          {kind === "branches" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Organization</span>
                  <select
                    value={values.organizationId}
                    onChange={(event) => onChange("organizationId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                    required
                  >
                    <option value="">Select organization</option>
                    {options?.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {optionLabel(organization)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Region/State</span>
                  <input
                    type="text"
                    value={values.region}
                    onChange={(event) => onChange("region", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                    maxLength={255}
                  />
                </label>
              </div>
              <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => onChange("isActive", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                Active
              </label>
              <CapabilityPicker
                values={values.capabilityIds}
                options={options}
                onChange={(nextValues) => onChange("capabilityIds", nextValues)}
              />
            </>
          ) : null}

          {kind === "operational-regions" ? (
            <>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">State</span>
                <input
                  type="text"
                  value={values.state}
                  onChange={(event) => onChange("state", event.target.value)}
                  className={`${inputClassName} mt-1.5`}
                  maxLength={255}
                />
              </label>
              <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => onChange("isActive", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                Active
              </label>
            </>
          ) : null}

          {kind === "capabilities" ? (
            <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={values.isActive}
                onChange={(event) => onChange("isActive", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
              />
              Active
            </label>
          ) : null}

          {kind === "mainheads" ? (
            <>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Operational Region</span>
                <select
                  value={values.operationalRegionId}
                  onChange={(event) => onChange("operationalRegionId", event.target.value)}
                  className={`${inputClassName} mt-1.5`}
                >
                  <option value="">No region</option>
                  {options?.operationalRegions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {optionLabel(region)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => onChange("isActive", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                Active
              </label>
              <CapabilityPicker
                values={values.capabilityIds}
                options={options}
                onChange={(nextValues) => onChange("capabilityIds", nextValues)}
                groupKeys={MAINHEAD_PICKER_GROUP_KEYS}
              />
            </>
          ) : null}

          {kind === "teams" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Organization</span>
                  <select
                    value={values.organizationId}
                    onChange={(event) => onChange("organizationId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">No organization</option>
                    {options?.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {optionLabel(organization)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Branch</span>
                  <select
                    value={values.branchId}
                    onChange={(event) => onChange("branchId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">No branch</option>
                    {options?.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {optionLabel(branch)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">MAINHEAD</span>
                  <select
                    value={values.mainheadId}
                    onChange={(event) => onChange("mainheadId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">No MAINHEAD</option>
                    {options?.mainheads.map((mainhead) => (
                      <option key={mainhead.id} value={mainhead.id}>
                        {optionLabel(mainhead)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="inline-flex items-center gap-3 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={values.isActive}
                  onChange={(event) => onChange("isActive", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                Active
              </label>
              <CapabilityPicker
                values={values.capabilityIds}
                options={options}
                onChange={(nextValues) => onChange("capabilityIds", nextValues)}
              />
            </>
          ) : null}

          {kind === "projects" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">MAINHEAD</span>
                  <select
                    value={values.mainheadId}
                    onChange={(event) => onChange("mainheadId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">No MAINHEAD</option>
                    {options?.mainheads.map((mainhead) => (
                      <option key={mainhead.id} value={mainhead.id}>
                        {optionLabel(mainhead)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Organization</span>
                  <select
                    value={values.organizationId}
                    onChange={(event) => onChange("organizationId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">No client organization</option>
                    {options?.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {optionLabel(organization)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Domain</span>
                  <select
                    value={values.operationalDomain}
                    onChange={(event) => onChange("operationalDomain", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">Not recorded</option>
                    {options?.operationalDomains.map((domain) => (
                      <option key={domain} value={domain}>
                        {formatEnum(domain)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Start Date</span>
                  <input
                    type="date"
                    value={values.startDate}
                    onChange={(event) => onChange("startDate", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">End Date</span>
                  <input
                    type="date"
                    value={values.endDate}
                    onChange={(event) => onChange("endDate", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  />
                </label>
              </div>
            </>
          ) : null}

          {kind === "work-packages" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Project</span>
                  <select
                    value={values.projectId}
                    onChange={(event) => onChange("projectId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                    required
                  >
                    <option value="">Select project</option>
                    {options?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {optionLabel(project)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">MAINHEAD</span>
                  <select
                    value={values.mainheadId}
                    onChange={(event) => onChange("mainheadId", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">Use project MAINHEAD</option>
                    {options?.mainheads.map((mainhead) => (
                      <option key={mainhead.id} value={mainhead.id}>
                        {optionLabel(mainhead)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Domain</span>
                  <select
                    value={values.operationalDomain}
                    onChange={(event) => onChange("operationalDomain", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                  >
                    <option value="">Use project domain</option>
                    {options?.operationalDomains.map((domain) => (
                      <option key={domain} value={domain}>
                        {formatEnum(domain)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Area</span>
                  <input
                    type="text"
                    value={values.area}
                    onChange={(event) => onChange("area", event.target.value)}
                    className={`${inputClassName} mt-1.5`}
                    maxLength={255}
                  />
                </label>
              </div>
            </>
          ) : null}

          {(kind === "projects" || kind === "work-packages") ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Status</span>
              <select
                value={values.status}
                onChange={(event) => onChange("status", event.target.value)}
                className={`${inputClassName} mt-1.5`}
              >
                {(kind === "projects"
                  ? options?.projectStatuses
                  : options?.workPackageStatuses
                )?.map((status) => (
                  <option key={status} value={status}>
                    {formatEnum(status)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {(
            kind === "capabilities" ||
            kind === "mainheads" ||
            kind === "projects" ||
            kind === "work-packages"
          ) ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Description</span>
              <textarea
                value={values.description}
                onChange={(event) => onChange("description", event.target.value)}
                rows={3}
                className={`${inputClassName} mt-1.5 h-auto resize-none py-2`}
                maxLength={1000}
              />
            </label>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClassName}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : isCreateMode ? "Create" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function uniqueOptions(
  rows: EnterpriseListRow[],
  selector: (row: EnterpriseListRow) => string | string[] | null,
) {
  return Array.from(
    new Set(
      rows
        .flatMap((row) => {
          const value = selector(row);

          return Array.isArray(value) ? value : [value];
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function EnterpriseLoading() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

function EnterpriseListContent({ kind }: { kind: EnterpriseEntityKind }) {
  const router = useRouter();
  const config = PAGE_CONFIG[kind];
  const Icon = config.icon;
  const [session, setSession] = useState<AuthSession | null>(null);
  const [rows, setRows] = useState<EnterpriseListRow[]>([]);
  const [options, setOptions] = useState<EnterpriseOptions | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [statusRowId, setStatusRowId] = useState<string | null>(null);
  const [statusConfirmRow, setStatusConfirmRow] = useState<EnterpriseListRow | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [search, setSearch] = useState("");
  const [primaryFilter, setPrimaryFilter] = useState<FilterValue>("ALL");
  const [groupFilter, setGroupFilter] = useState<FilterValue>("ALL");
  const [extraFilter, setExtraFilter] = useState<FilterValue>("ALL");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedRow, setSelectedRow] = useState<EnterpriseListRow | null>(null);
  const [form, setForm] = useState<EnterpriseFormState>(() => createInitialForm(kind));
  const [modalError, setModalError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadRows = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      setSuccessMessage("");

      try {
        const [nextRows, nextOptions] = await Promise.all([
          fetchEnterpriseRows(token, kind),
          fetchEnterpriseOptions(token),
        ]);
        setRows(nextRows);
        setOptions(nextOptions);
      } catch (listError) {
        if (listError instanceof ApiError && listError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          listError instanceof Error ? listError.message : "Unable to load enterprise data.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout, kind],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadRows(storedSession.token);
    } else {
      setIsLoading(false);
    }
  }, [loadRows]);

  const primaryOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.primaryChip),
    [rows],
  );
  const groupOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.filterGroup),
    [rows],
  );
  const extraOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.extraFilterGroups),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !normalizedSearch || row.searchText.includes(normalizedSearch);
      const matchesPrimary =
        primaryFilter === "ALL" || row.primaryChip === primaryFilter;
      const matchesGroup =
        groupFilter === "ALL" || row.filterGroup === groupFilter;
      const matchesExtra =
        extraFilter === "ALL" || row.extraFilterGroups.includes(extraFilter);

      return matchesSearch && matchesPrimary && matchesGroup && matchesExtra;
    });
  }, [extraFilter, groupFilter, primaryFilter, rows, search]);

  function resetFilters() {
    setSearch("");
    setPrimaryFilter("ALL");
    setGroupFilter("ALL");
    setExtraFilter("ALL");
  }

  function openDetail(rowId: string) {
    if (config.hasDetail === false) {
      return;
    }

    router.push(`${config.basePath}/${encodeURIComponent(rowId)}`);
  }

  function updateForm<K extends keyof EnterpriseFormState>(
    field: K,
    value: EnterpriseFormState[K],
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function openCreateModal() {
    setSelectedRow(null);
    setForm(createInitialForm(kind));
    setModalError("");
    setModalMode("create");
  }

  function openEditModal(row: EnterpriseListRow, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setSelectedRow(row);
    setForm(createFormFromRow(kind, row));
    setModalError("");
    setModalMode("edit");
  }

  function closeModal() {
    if (isSaving) {
      return;
    }

    setModalMode(null);
    setSelectedRow(null);
    setModalError("");
  }

  function upsertRow(row: EnterpriseListRow) {
    setRows((currentRows) => {
      const existingIndex = currentRows.findIndex((currentRow) => currentRow.id === row.id);

      if (existingIndex === -1) {
        return [...currentRows, row];
      }

      return currentRows.map((currentRow) => (currentRow.id === row.id ? row : currentRow));
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || !modalMode) {
      return;
    }

    setIsSaving(true);
    setModalError("");

    try {
      const payload = buildEnterprisePayload(kind, form);
      const savedRow =
        modalMode === "create"
          ? await createEnterpriseEntity(session.token, kind, payload)
          : selectedRow
            ? await updateEnterpriseEntity(session.token, kind, selectedRow.id, payload)
            : null;

      if (savedRow) {
        upsertRow(savedRow);
      }

      closeModal();
      const nextOptions = await fetchEnterpriseOptions(session.token);
      setOptions(nextOptions);
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(
        submitError instanceof Error ? submitError.message : "Unable to save record.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function requestStatusToggle(
    row: EnterpriseListRow,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    setStatusConfirmRow(row);
  }

  function closeStatusConfirm() {
    if (statusRowId) {
      return;
    }

    setStatusConfirmRow(null);
  }

  async function confirmStatusToggle() {
    const row = statusConfirmRow;

    if (!session?.token || !row || statusRowId) {
      return;
    }

    const nextIsActive = row.isActive === false;

    setStatusRowId(row.id);
    setError("");
    setSuccessMessage("");

    try {
      const updatedRow = await updateEnterpriseOperationalStatus(
        session.token,
        kind,
        row.id,
        nextIsActive,
      );
      upsertRow(updatedRow);
      setOptions(await fetchEnterpriseOptions(session.token));
      setStatusConfirmRow(null);
      setSuccessMessage(
        `${updatedRow.name} ${nextIsActive ? "activated" : "deactivated"}.`,
      );
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) {
        handleLogout();
        return;
      }

      setStatusConfirmRow(null);
      setError(statusError instanceof Error ? statusError.message : "Unable to update status.");
    } finally {
      setStatusRowId(null);
    }
  }

  const filterGridClassName = config.extraFilterLabel
    ? "grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,auto))_auto]"
    : "grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(150px,auto))_auto]";
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                {config.eyebrow}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {config.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isAdmin ? "Admin access" : "Read-only"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {rows.length} total
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (session?.token ? loadRows(session.token) : undefined)}
                disabled={isLoading || !session?.token}
                className={secondaryButtonClassName}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                disabled={!isAdmin}
                className={primaryButtonClassName}
              >
                <Plus size={16} />
                Create
              </button>
            </div>
          </div>

          <div className="mt-6">
            {successMessage ? (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {successMessage}
              </div>
            ) : null}

            {isLoading && rows.length === 0 ? (
              <EnterpriseLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  <div className={filterGridClassName}>
                    <label className="relative block">
                      <span className="sr-only">{config.searchPlaceholder}</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={config.searchPlaceholder}
                        className={searchClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">{config.primaryFilterLabel}</span>
                      <select
                        value={primaryFilter}
                        onChange={(event) => setPrimaryFilter(event.target.value)}
                        className={inputClassName}
                      >
                        <option value="ALL">{config.primaryFilterLabel}</option>
                        {primaryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">{config.groupFilterLabel}</span>
                      <select
                        value={groupFilter}
                        onChange={(event) => setGroupFilter(event.target.value)}
                        className={inputClassName}
                      >
                        <option value="ALL">{config.groupFilterLabel}</option>
                        {groupOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    {config.extraFilterLabel ? (
                      <label className="block">
                        <span className="sr-only">{config.extraFilterLabel}</span>
                        <select
                          value={extraFilter}
                          onChange={(event) => setExtraFilter(event.target.value)}
                          className={inputClassName}
                        >
                          <option value="ALL">{config.extraFilterLabel}</option>
                          {extraOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <button type="button" onClick={resetFilters} className={secondaryButtonClassName}>
                      <X size={16} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="w-[34%] px-5 py-3.5 font-semibold">Name</th>
                        <th className="w-[18%] px-5 py-3.5 font-semibold">Status</th>
                        <th className="w-[24%] px-5 py-3.5 font-semibold">Scope</th>
                        <th className="w-[14%] px-5 py-3.5 font-semibold">Counts</th>
                        <th className="w-[14%] px-5 py-3.5 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          onClick={() => openDetail(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openDetail(row.id);
                            }
                          }}
                          className={`outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40 ${
                            config.hasDetail === false ? "" : "cursor-pointer"
                          }`}
                        >
                          <td className="px-5 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                <Icon size={17} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">
                                  {row.name}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                                  {row.code ?? "Code not recorded"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <Chip label={row.primaryChip} tone={row.primaryTone} />
                              <Chip label={row.secondaryChip} tone={row.secondaryTone} />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            <div className="line-clamp-2">{row.relationLabel}</div>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              Updated {formatDate(row.updatedAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              {row.metrics.map((metric) => (
                                <span
                                  key={metric.label}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700"
                                >
                                  {metric.value} {metric.label}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                onClick={(event) => openEditModal(row, event)}
                                disabled={!isAdmin}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <Pencil size={14} />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={(event) => requestStatusToggle(row, event)}
                                disabled={!isAdmin || statusRowId === row.id}
                                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <Power size={14} />
                                {row.isActive === false ? "Activate" : "Deactivate"}
                              </button>
                              {config.hasDetail === false ? null : (
                                <ChevronRight size={17} className="self-center text-slate-400" />
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredRows.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        {config.emptyLabel}
                      </p>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className={`${primaryButtonClassName} mt-4`}
                        >
                          <Plus size={16} />
                          Create first record
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
                  Showing {filteredRows.length} of {rows.length}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {modalMode ? (
        <EnterpriseFormModal
          kind={kind}
          mode={modalMode}
          values={form}
          options={options}
          error={modalError}
          isSaving={isSaving}
          onChange={updateForm}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(statusConfirmRow)}
        title={statusConfirmRow?.isActive === false ? "Activate record" : "Deactivate record"}
        message={
          statusConfirmRow?.isActive === false
            ? "Activate this record?"
            : "Deactivate this record? It will no longer be available for assignment."
        }
        confirmLabel={statusConfirmRow?.isActive === false ? "Activate" : "Deactivate"}
        tone={statusConfirmRow?.isActive === false ? "default" : "danger"}
        isBusy={Boolean(statusRowId)}
        onConfirm={confirmStatusToggle}
        onCancel={closeStatusConfirm}
      />
    </AppShell>
  );
}

export function EnterpriseListClient({ kind }: { kind: EnterpriseEntityKind }) {
  return (
    <AuthGuard>
      <EnterpriseListContent kind={kind} />
    </AuthGuard>
  );
}
