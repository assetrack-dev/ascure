"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Card,
  Chip,
  Eyebrow,
  FilterBar,
  IconBtn,
  PageHeader,
  SearchField,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import {
  groupCapabilities,
  isAssignableCapability,
  MANAGER_ASSIGNABLE_GROUP_KEYS,
  type CapabilityGroupKey,
} from "@/lib/capability-groups";
import {
  formatMainheadLabel,
  formatRegionLabel,
  resolveEffectiveMainheads,
} from "@/lib/mainhead-resolver";
import {
  createUser,
  fetchTeams,
  fetchUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from "@/lib/users";
import type { AuthSession } from "@/types/auth";
import type { EnterpriseOptions } from "@/types/enterprise";
import type { ManagedTeam, ManagedUser, UserRole } from "@/types/users";
import { USER_ROLES } from "@/types/users";

type RoleFilter = "ALL" | UserRole;
type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type OrgFilter = "ALL" | string;
type ModalMode = "create" | "edit";

// Roles a MANAGER may provision (mirrors the API allow-list in users.service).
// ADMIN is never offered to a manager.
const MANAGER_ASSIGNABLE_ROLES: UserRole[] = ["TECHNICIAN", "SUPERVISOR", "MANAGER"];

type CredentialResult = { name: string; email: string; password: string };

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  isActive: boolean;
  organizationId: string;
  branchId: string;
  mainheadId: string;
  teamId: string;
  capabilityIds: string[];
  mainheadAccessIds: string[];
  operationalRegionAccessIds: string[];
}

const DEFAULT_USER_FORM: UserFormState = {
  name: "",
  email: "",
  password: "",
  role: "TECHNICIAN",
  isActive: true,
  organizationId: "",
  branchId: "",
  mainheadId: "",
  teamId: "",
  capabilityIds: [],
  mainheadAccessIds: [],
  operationalRegionAccessIds: [],
};

function createDefaultUserForm(): UserFormState {
  return {
    ...DEFAULT_USER_FORM,
    email: "",
    password: "",
    capabilityIds: [],
    mainheadAccessIds: [],
    operationalRegionAccessIds: [],
  };
}

const ROLE_FILTER_OPTIONS: Array<{ label: string; value: RoleFilter }> = [
  { label: "All roles", value: "ALL" },
  { label: "Admin", value: "ADMIN" },
  { label: "Manager", value: "MANAGER" },
  { label: "Supervisor", value: "SUPERVISOR" },
  { label: "Technician", value: "TECHNICIAN" },
  { label: "Viewer", value: "VIEWER" },
  { label: "Client", value: "CLIENT" },
];
const STATUS_FILTER_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Inactive", value: "INACTIVE" },
];

// Modal fields reuse the filter-pill controls (a restyle, not a rewrite): same
// height and token surface as the filter bar, with a label gap baked in.
const modalInputClass = `${filterControlClass} mt-1.5 w-full`;
const modalSelectClass = `${filterSelectClass} mt-1.5 w-full`;
const modalLabelClass = "text-[12.5px] font-semibold text-[var(--foreground-soft)]";

function UsersLoading() {
  return (
    <Card>
      <div className="h-[38px] w-full animate-pulse rounded-[var(--radius-control)] bg-[var(--panel-muted)]" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-[9px] bg-[var(--panel-muted)]" />
        ))}
      </div>
    </Card>
  );
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function roleLabel(role: UserRole) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function roleTone(role: UserRole): Tone {
  if (role === "ADMIN") {
    return "monitor";
  }

  if (role === "MANAGER") {
    return "info";
  }

  if (role === "SUPERVISOR") {
    return "success";
  }

  return "neutral";
}

/** 1–2 letter monogram from a display name, for the avatar tile. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function optionLabel(option: { name: string; code?: string | null }) {
  return option.code ? `${option.code} - ${option.name}` : option.name;
}

function readUserCapabilityIds(user: ManagedUser | null) {
  return (
    user?.capabilityAssignments
      ?.map((assignment) => assignment.capability?.id)
      .filter((id): id is string => Boolean(id)) ?? []
  );
}

function readUserMainheadAccessIds(user: ManagedUser | null) {
  const accessIds =
    user?.mainheadAccesses
      ?.map((access) => access.mainhead?.id || access.mainheadId)
      .filter((id): id is string => Boolean(id)) ?? [];

  if (accessIds.length > 0) {
    return accessIds;
  }

  return user?.mainheadId ? [user.mainheadId] : [];
}

function readUserOperationalRegionAccessIds(user: ManagedUser | null) {
  return (
    user?.operationalRegionAccesses
      ?.map((access) => access.operationalRegion?.id || access.operationalRegionId)
      .filter((id): id is string => Boolean(id)) ?? []
  );
}

function capabilityNames(user: ManagedUser) {
  return (
    user.capabilityAssignments
      ?.map((assignment) => assignment.capability?.name || assignment.capability?.code)
      .filter((name): name is string => Boolean(name))
      .join(", ") || null
  );
}

/** The capability labels as a list, for rendering one chip apiece. */
function capabilityNameList(user: ManagedUser) {
  return (
    user.capabilityAssignments
      ?.map((assignment) => assignment.capability?.name || assignment.capability?.code)
      .filter((name): name is string => Boolean(name)) ?? []
  );
}

function mainheadAccessNames(user: ManagedUser) {
  const names =
    user.mainheadAccesses
      ?.map((access) => access.mainhead?.name || access.mainhead?.code)
      .filter((name): name is string => Boolean(name)) ?? [];

  if (names.length > 0) {
    return names.join(", ");
  }

  return user.mainhead?.name || user.mainhead?.code || null;
}

function operationalRegionAccessNames(user: ManagedUser) {
  return (
    user.operationalRegionAccesses
      ?.map(
        (access) =>
          access.operationalRegion?.name || access.operationalRegion?.code,
      )
      .filter((name): name is string => Boolean(name))
      .join(", ") || null
  );
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Chip tone={isActive ? "success" : "neutral"}>{isActive ? "Active" : "Inactive"}</Chip>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  return <Chip tone={roleTone(role)}>{roleLabel(role)}</Chip>;
}

function UserCapabilityPicker({
  values,
  options,
  onChange,
  groupKeys,
}: {
  values: string[];
  options: EnterpriseOptions | null;
  onChange: (nextValues: string[]) => void;
  groupKeys?: ReadonlyArray<CapabilityGroupKey>;
}) {
  if (!options?.capabilities.length) {
    return null;
  }

  const assignable = options.capabilities.filter(isAssignableCapability);

  if (assignable.length === 0) {
    return null;
  }

  // A manager sees only operational groups (Workspace + Asset Domains);
  // Governance stays ADMIN-only (the API strips it server-side too).
  const allowedGroups = groupKeys ? new Set(groupKeys) : null;
  const groups = groupCapabilities(assignable).filter(
    (group) => !allowedGroups || allowedGroups.has(group.key),
  );

  if (groups.length === 0) {
    return null;
  }

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
          className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3"
        >
          <legend className="px-1 text-[13px] font-semibold text-[var(--foreground-soft)]">
            {group.title}
          </legend>
          <p className="px-1 text-[12px] text-[var(--muted)]">{group.caption}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {group.items.map((capability) => (
              <label
                key={capability.id}
                className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] font-medium text-[var(--foreground-soft)]"
              >
                <input
                  type="checkbox"
                  checked={values.includes(capability.id)}
                  onChange={(event) =>
                    toggleCapability(capability.id, event.target.checked)
                  }
                  className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
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

function UserAccessPicker({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: string[];
  options: Array<{ id: string; name: string; code?: string | null; isActive?: boolean | null }>;
  onChange: (nextValues: string[]) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  function toggleOption(optionId: string, checked: boolean) {
    onChange(
      checked
        ? Array.from(new Set([...values, optionId]))
        : values.filter((id) => id !== optionId),
    );
  }

  return (
    <fieldset className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
      <legend className="px-1 text-[13px] font-semibold text-[var(--foreground-soft)]">
        {title}
      </legend>
      <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] font-medium text-[var(--foreground-soft)]"
          >
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(event) => toggleOption(option.id, event.target.checked)}
              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
            />
            <span className="truncate">
              {optionLabel(option)}
              {option.isActive === false ? " (Inactive)" : ""}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EffectiveMainheadPreview({
  directIds,
  regionIds,
  enterpriseOptions,
  role,
}: {
  directIds: string[];
  regionIds: string[];
  enterpriseOptions: EnterpriseOptions | null;
  role: UserRole;
}) {
  const mainheads = enterpriseOptions?.mainheads ?? [];
  const regions = enterpriseOptions?.operationalRegions ?? [];

  const preview = useMemo(
    () =>
      resolveEffectiveMainheads({
        directIds,
        regionIds,
        mainheads,
        regions,
      }),
    [directIds, mainheads, regionIds, regions],
  );

  const overrideMessage =
    role === "ADMIN"
      ? "Role: ADMIN — sees all active MAINHEADs via administrative override."
      : null;

  const segments: string[] = [];

  if (preview.direct.length > 0) {
    segments.push(
      `${preview.direct.map(formatMainheadLabel).join(", ")} (direct)`,
    );
  }

  for (const group of preview.viaRegion) {
    segments.push(
      `${group.mainheads
        .map(formatMainheadLabel)
        .join(", ")} (via Region: ${formatRegionLabel(group.region)})`,
    );
  }

  const summary =
    segments.length > 0
      ? `Effective MAINHEAD access: ${segments.join(" + ")}.`
      : "No MAINHEAD access — user will not see any visits.";

  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
        Effective MAINHEAD Access
      </p>
      {overrideMessage ? (
        <p className="mt-1 text-[13px] font-semibold text-[var(--warning-text)]">
          {overrideMessage}
        </p>
      ) : null}
      <p className="mt-1 text-[13px] text-[var(--foreground-soft)]">{summary}</p>
      {preview.effective.length > 0 ? (
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          {preview.effective.length} MAINHEAD
          {preview.effective.length === 1 ? "" : "s"} resolved.
        </p>
      ) : null}
    </div>
  );
}

function UserFormModal({
  mode,
  values,
  enterpriseOptions,
  teams,
  error,
  isSaving,
  isManagerOnly,
  managerOrgId,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: ModalMode;
  values: UserFormState;
  enterpriseOptions: EnterpriseOptions | null;
  teams: ManagedTeam[];
  error: string;
  isSaving: boolean;
  isManagerOnly: boolean;
  managerOrgId: string | null;
  onChange: <K extends keyof UserFormState>(field: K, value: UserFormState[K]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isCreateMode = mode === "create";
  const activeMainheads = enterpriseOptions?.mainheads ?? [];
  const activeOperationalRegions = enterpriseOptions?.operationalRegions ?? [];
  // A manager may grant MAINHEAD access only within their own company: the
  // MAINHEADs ADMIN assigned to their org (OrganizationMainhead → organizationIds),
  // OR — legacy fallback — MAINHEADs whose branch belongs to their org. The
  // assignment path is what makes region-scoped MAINHEADs (no branch) selectable.
  const companyBranchIds = new Set(
    (enterpriseOptions?.branches ?? [])
      .filter((branch) => !!managerOrgId && branch.organizationId === managerOrgId)
      .map((branch) => branch.id),
  );
  const companyMainheads = isManagerOnly
    ? activeMainheads.filter(
        (mainhead) =>
          !!managerOrgId &&
          ((mainhead.organizationIds ?? []).includes(managerOrgId) ||
            (!!mainhead.branchId && companyBranchIds.has(mainhead.branchId))),
      )
    : activeMainheads;
  // Managers get a simplified, company-locked form: a restricted role list, no
  // advanced grants, and teams scoped to their own company.
  const roleOptions = isManagerOnly ? MANAGER_ASSIGNABLE_ROLES : USER_ROLES;
  const visibleTeams = isManagerOnly
    ? teams.filter((team) => !managerOrgId || team.organizationId === managerOrgId)
    : teams;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div>
            <Eyebrow>{isCreateMode ? "New User" : "Edit User"}</Eyebrow>
            <h2
              className="mt-1 text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {isCreateMode ? "Create User" : "Update User"}
            </h2>
          </div>
          <IconBtn onClick={onClose} aria-label="Close user modal">
            <X size={16} />
          </IconBtn>
        </div>

        <form onSubmit={onSubmit} autoComplete="off" className="space-y-4 px-[18px] py-5">
          {error ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          <label className="block">
            <span className={modalLabelClass}>Name</span>
            <input
              type="text"
              value={values.name}
              onChange={(event) => onChange("name", event.target.value)}
              className={modalInputClass}
              required
              maxLength={255}
            />
          </label>

          <label className="block">
            <span className={modalLabelClass}>Email</span>
            <input
              type="email"
              value={values.email}
              onChange={(event) => onChange("email", event.target.value)}
              autoComplete="new-email"
              className={modalInputClass}
              required
              maxLength={320}
            />
          </label>

          <label className="block">
            <span className={modalLabelClass}>Role</span>
            <select
              value={values.role}
              onChange={(event) => onChange("role", event.target.value as UserRole)}
              className={modalSelectClass}
            >
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>

          {isManagerOnly ? (
            <label className="block">
              <span className={modalLabelClass}>Team</span>
              <select
                value={values.teamId}
                onChange={(event) => onChange("teamId", event.target.value)}
                className={modalSelectClass}
              >
                <option value="">No team</option>
                {visibleTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {optionLabel(team)}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                New users are added to your company automatically.
              </span>
            </label>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={modalLabelClass}>Organization</span>
                <select
                  value={values.organizationId}
                  onChange={(event) => onChange("organizationId", event.target.value)}
                  className={modalSelectClass}
                >
                  <option value="">No organization</option>
                  {enterpriseOptions?.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {optionLabel(organization)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={modalLabelClass}>Branch</span>
                <select
                  value={values.branchId}
                  onChange={(event) => onChange("branchId", event.target.value)}
                  className={modalSelectClass}
                >
                  <option value="">No branch</option>
                  {enterpriseOptions?.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {optionLabel(branch)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={modalLabelClass}>Team</span>
                <select
                  value={values.teamId}
                  onChange={(event) => onChange("teamId", event.target.value)}
                  className={modalSelectClass}
                >
                  <option value="">No team</option>
                  {/*
                    Governance Fix Package G3 — Team filtered by Organization.
                    If the form has an Organization selection, only show teams
                    that belong to that organization. When no organization is
                    picked, fall through to the full list so admins can still
                    see every team.
                  */}
                  {teams
                    .filter(
                      (team) =>
                        !values.organizationId ||
                        !team.organizationId ||
                        team.organizationId === values.organizationId,
                    )
                    .map((team) => (
                      <option key={team.id} value={team.id}>
                        {optionLabel(team)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}

          <UserAccessPicker
            title="MAINHEAD Access"
            values={values.mainheadAccessIds}
            options={isManagerOnly ? companyMainheads : activeMainheads}
            onChange={(nextValues) => {
              onChange("mainheadAccessIds", nextValues);
              onChange("mainheadId", nextValues[0] ?? "");
            }}
          />

          {!isManagerOnly ? (
            <UserAccessPicker
              title="Region Access"
              values={values.operationalRegionAccessIds}
              options={activeOperationalRegions}
              onChange={(nextValues) => onChange("operationalRegionAccessIds", nextValues)}
            />
          ) : null}

          {!isManagerOnly ? (
            <EffectiveMainheadPreview
              directIds={values.mainheadAccessIds}
              regionIds={values.operationalRegionAccessIds}
              enterpriseOptions={enterpriseOptions}
              role={values.role}
            />
          ) : null}

          <UserCapabilityPicker
            values={values.capabilityIds}
            options={enterpriseOptions}
            onChange={(nextValues) => onChange("capabilityIds", nextValues)}
            groupKeys={isManagerOnly ? MANAGER_ASSIGNABLE_GROUP_KEYS : undefined}
          />

          {isCreateMode && !isManagerOnly ? (
            <label className="block">
              <span className={modalLabelClass}>Password</span>
              <input
                type="password"
                value={values.password}
                onChange={(event) => onChange("password", event.target.value)}
                autoComplete="new-password"
                className={modalInputClass}
                minLength={8}
                maxLength={128}
              />
              <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                Leave blank to generate a temporary password. Either way, the user
                must change it at first login.
              </span>
            </label>
          ) : null}
          {isCreateMode && isManagerOnly ? (
            <p className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2 text-[12px] text-[var(--muted)]">
              A temporary password will be generated for the new user. Share it
              with them — they must change it at first login.
            </p>
          ) : null}

          {isCreateMode ? (
            <label className="inline-flex items-center gap-3 text-[13px] font-semibold text-[var(--foreground-soft)]">
              <input
                type="checkbox"
                checked={values.isActive}
                onChange={(event) => onChange("isActive", event.target.checked)}
                className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
              />
              Active
            </label>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--line2)] pt-4 sm:flex-row sm:justify-end">
            <Tbtn onClick={onClose}>Cancel</Tbtn>
            <Tbtn type="submit" variant="primary" disabled={isSaving}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : isCreateMode ? "Create User" : "Save Changes"}
            </Tbtn>
          </div>
        </form>
      </div>
    </div>
  );
}

function PasswordModal({
  user,
  password,
  error,
  isSaving,
  setPassword,
  onClose,
  onSubmit,
}: {
  user: ManagedUser;
  password: string;
  error: string;
  isSaving: boolean;
  setPassword: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div>
            <Eyebrow>Reset Password</Eyebrow>
            <h2
              className="mt-1 text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {user.name}
            </h2>
          </div>
          <IconBtn onClick={onClose} aria-label="Close password modal">
            <X size={16} />
          </IconBtn>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-[18px] py-5">
          {error ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          <label className="block">
            <span className={modalLabelClass}>New Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className={modalInputClass}
              minLength={8}
              maxLength={128}
            />
            <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
              Leave blank to generate a temporary password. The user must change
              it at next login.
            </span>
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--line2)] pt-4 sm:flex-row sm:justify-end">
            <Tbtn onClick={onClose}>Cancel</Tbtn>
            <Tbtn type="submit" variant="primary" disabled={isSaving}>
              <KeyRound size={16} />
              {isSaving ? "Saving" : "Reset Password"}
            </Tbtn>
          </div>
        </form>
      </div>
    </div>
  );
}

function CredentialResultModal({
  credential,
  onClose,
}: {
  credential: CredentialResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(credential.password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div>
            <Eyebrow>Temporary password</Eyebrow>
            <h2
              className="mt-1 text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {credential.name}
            </h2>
          </div>
          <IconBtn onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconBtn>
        </div>

        <div className="space-y-4 px-[18px] py-5">
          <p className="text-[13px] text-[var(--muted)]">
            Share these credentials with{" "}
            <span className="font-semibold text-[var(--foreground)]">{credential.email}</span>. They must set
            a new password at first login. This password is shown only once.
          </p>

          <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-2)]">
              Temporary password
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <code className="break-all font-mono text-[15px] font-semibold text-[var(--foreground)]">
                {credential.password}
              </code>
              <button
                type="button"
                onClick={copy}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 text-[12px] font-semibold text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)]"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="flex justify-end border-t border-[var(--line2)] pt-4">
            <Tbtn variant="primary" onClick={onClose}>
              Done
            </Tbtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [enterpriseOptions, setEnterpriseOptions] = useState<EnterpriseOptions | null>(null);
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [orgFilter, setOrgFilter] = useState<OrgFilter>("ALL");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() => createDefaultUserForm());
  const [modalError, setModalError] = useState("");
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusUserId, setStatusUserId] = useState<string | null>(null);
  const [statusConfirmUser, setStatusConfirmUser] = useState<ManagedUser | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [credential, setCredential] = useState<CredentialResult | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadUsers = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      setSuccessMessage("");

      try {
        const [nextUsers, nextOptions, nextTeams] = await Promise.all([
          fetchUsers(token),
          fetchEnterpriseOptions(token),
          fetchTeams(token),
        ]);
        setUsers(nextUsers);
        setEnterpriseOptions(nextOptions);
        setTeams(nextTeams);
      } catch (usersError) {
        if (usersError instanceof ApiError && usersError.status === 401) {
          handleLogout();
          return;
        }

        if (usersError instanceof ApiError && usersError.status === 403) {
          setError("ADMIN role is required to manage users.");
          return;
        }

        setError(requestErrorMessage(usersError, "Unable to load users."));
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (!storedSession?.token) {
      setIsLoading(false);
      return;
    }

    const canManage =
      storedSession.user?.role === "ADMIN" ||
      storedSession.user?.canManageUsers === true;

    if (storedSession.user && !canManage) {
      setError("You do not have permission to manage users.");
      setIsLoading(false);
      return;
    }

    void loadUsers(storedSession.token);
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return users
      .filter((user) => {
        const matchesRole = roleFilter === "ALL" || user.role === roleFilter;
        const matchesStatus =
          statusFilter === "ALL" ||
          (statusFilter === "ACTIVE" ? user.isActive : !user.isActive);
        const matchesOrg = orgFilter === "ALL" || user.organization?.id === orgFilter;
        const matchesSearch =
          !normalizedSearch ||
          [
            user.name,
            user.email,
            roleLabel(user.role),
            user.isActive ? "Active" : "Inactive",
            user.department?.name,
            user.department?.code,
            user.organization?.name,
            user.organization?.code,
            user.branch?.name,
            user.branch?.code,
            user.mainhead?.name,
            user.mainhead?.code,
            mainheadAccessNames(user),
            operationalRegionAccessNames(user),
            user.team?.name,
            user.team?.code,
            capabilityNames(user),
          ].some((value) => normalizeSearchText(value).includes(normalizedSearch));

        return matchesRole && matchesStatus && matchesOrg && matchesSearch;
      })
      .sort((left, right) => {
        const nameSort = left.name.localeCompare(right.name, "en", {
          numeric: true,
          sensitivity: "base",
        });

        return nameSort || left.email.localeCompare(right.email, "en", { sensitivity: "base" });
      });
  }, [orgFilter, roleFilter, search, statusFilter, users]);

  const organizationOptions = useMemo(() => {
    const options = new Map<string, string>();

    users.forEach((user) => {
      const organization = user.organization;

      if (!organization?.id || options.has(organization.id)) {
        return;
      }

      options.set(organization.id, optionLabel(organization));
    });

    return Array.from(options.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], "en", { numeric: true, sensitivity: "base" }),
    );
  }, [users]);

  const isAdmin = session?.user?.role === "ADMIN";
  const canManageUsers = isAdmin || session?.user?.canManageUsers === true;
  const isManagerOnly = canManageUsers && !isAdmin;
  const managerOrgId = session?.user?.organizationId ?? null;

  // Which rows a manager may act on: only TECHNICIAN/SUPERVISOR/MANAGER users in
  // their own company (mirrors the API's assertCanManageTarget). Admins: anyone.
  function canManageTarget(target: ManagedUser) {
    if (isAdmin) {
      return true;
    }
    if (!isManagerOnly) {
      return false;
    }
    return (
      MANAGER_ASSIGNABLE_ROLES.includes(target.role) &&
      (!managerOrgId || target.organizationId === managerOrgId)
    );
  }

  const activeUserCount = users.filter((user) => user.isActive).length;
  const activeAdminCount = users.filter(
    (user) => user.isActive && user.role === "ADMIN",
  ).length;

  function updateForm<K extends keyof UserFormState>(field: K, value: UserFormState[K]) {
    setUserForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function openCreateModal() {
    setSelectedUser(null);
    setUserForm(createDefaultUserForm());
    setModalError("");
    setModalMode("create");
  }

  function openEditModal(user: ManagedUser) {
    setSelectedUser(user);
    setUserForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      isActive: user.isActive,
      organizationId: user.organizationId ?? "",
      branchId: user.branchId ?? "",
      mainheadId: user.mainheadId ?? "",
      teamId: user.teamId ?? "",
      capabilityIds: readUserCapabilityIds(user),
      mainheadAccessIds: readUserMainheadAccessIds(user),
      operationalRegionAccessIds: readUserOperationalRegionAccessIds(user),
    });
    setModalError("");
    setModalMode("edit");
  }

  function closeUserModal() {
    if (isSaving) {
      return;
    }

    setModalMode(null);
    setSelectedUser(null);
    setModalError("");
  }

  function openPasswordModal(user: ManagedUser) {
    setPasswordUser(user);
    setPassword("");
    setPasswordError("");
  }

  function closePasswordModal() {
    if (isSaving) {
      return;
    }

    setPasswordUser(null);
    setPassword("");
    setPasswordError("");
  }

  function upsertUser(updatedUser: ManagedUser) {
    setUsers((currentUsers) => {
      const existingIndex = currentUsers.findIndex((user) => user.id === updatedUser.id);

      if (existingIndex === -1) {
        return [...currentUsers, updatedUser];
      }

      return currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user));
    });
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || !modalMode) {
      return;
    }

    setIsSaving(true);
    setModalError("");

    try {
      const trimmedName = userForm.name.trim();
      const trimmedEmail = userForm.email.trim();

      if (modalMode === "create") {
        const { temporaryPassword, ...managed } = await createUser(session.token, {
          name: trimmedName,
          email: trimmedEmail,
          password: userForm.password,
          role: userForm.role,
          isActive: userForm.isActive,
          organizationId: userForm.organizationId,
          branchId: userForm.branchId,
          mainheadId: userForm.mainheadAccessIds[0] ?? userForm.mainheadId,
          teamId: userForm.teamId,
          capabilityIds: userForm.capabilityIds,
          mainheadAccessIds: userForm.mainheadAccessIds,
          operationalRegionAccessIds: userForm.operationalRegionAccessIds,
        });
        upsertUser(managed);
        closeUserModal();
        if (temporaryPassword) {
          setCredential({
            name: managed.name,
            email: managed.email,
            password: temporaryPassword,
          });
        } else {
          setSuccessMessage(`${managed.name} created.`);
        }
      } else if (selectedUser) {
        const updatedUser = await updateUser(session.token, selectedUser.id, {
          name: trimmedName,
          email: trimmedEmail,
          role: userForm.role,
          organizationId: userForm.organizationId,
          branchId: userForm.branchId,
          mainheadId: userForm.mainheadAccessIds[0] ?? userForm.mainheadId,
          teamId: userForm.teamId,
          capabilityIds: userForm.capabilityIds,
          mainheadAccessIds: userForm.mainheadAccessIds,
          operationalRegionAccessIds: userForm.operationalRegionAccessIds,
        });
        upsertUser(updatedUser);
        closeUserModal();
      } else {
        closeUserModal();
      }
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(requestErrorMessage(submitError, "Unable to save user."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || !passwordUser) {
      return;
    }

    setIsSaving(true);
    setPasswordError("");

    try {
      const { temporaryPassword, ...managed } = await resetUserPassword(
        session.token,
        passwordUser.id,
        password || undefined,
      );
      upsertUser(managed);
      closePasswordModal();
      if (temporaryPassword) {
        setCredential({
          name: managed.name,
          email: managed.email,
          password: temporaryPassword,
        });
      } else {
        setSuccessMessage(`Password updated for ${managed.name}.`);
      }
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        handleLogout();
        return;
      }

      setPasswordError(requestErrorMessage(submitError, "Unable to reset password."));
    } finally {
      setIsSaving(false);
    }
  }

  function requestStatusToggle(user: ManagedUser) {
    setStatusConfirmUser(user);
  }

  function closeStatusConfirm() {
    if (statusUserId) {
      return;
    }

    setStatusConfirmUser(null);
  }

  async function confirmStatusToggle() {
    const user = statusConfirmUser;

    if (!session?.token || !user || statusUserId) {
      return;
    }

    const nextIsActive = !user.isActive;

    setStatusUserId(user.id);
    setError("");
    setSuccessMessage("");

    try {
      const updatedUser = await updateUserStatus(session.token, user.id, nextIsActive);
      upsertUser(updatedUser);
      setStatusConfirmUser(null);
      setSuccessMessage(
        `${updatedUser.name} ${nextIsActive ? "activated" : "deactivated"}.`,
      );
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) {
        handleLogout();
        return;
      }

      setStatusConfirmUser(null);
      setError(requestErrorMessage(statusError, "Unable to update user status."));
    } finally {
      setStatusUserId(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
    setOrgFilter("ALL");
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Access Control"
            title="Users"
            subtitle="Provision console and field accounts, set each person's role and access scope, and issue or reset credentials."
            chips={
              <>
                <Chip tone="neutral">
                  <ShieldCheck size={13} />
                  {isAdmin ? "Admin access" : isManagerOnly ? "Manager access" : "Restricted"}
                </Chip>
                <Chip tone="neutral">{users.length} total</Chip>
                <Chip tone="success">{activeUserCount} active</Chip>
                <Chip tone="neutral">{activeAdminCount} active admins</Chip>
              </>
            }
            actions={
              <>
                <Tbtn
                  onClick={() => (session?.token ? loadUsers(session.token) : undefined)}
                  disabled={isLoading || !session?.token || !canManageUsers}
                >
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
                <Tbtn variant="primary" onClick={openCreateModal} disabled={!canManageUsers}>
                  <Plus size={16} />
                  Create User
                </Tbtn>
              </>
            }
          />

          <div className="mt-6">
            {isLoading && users.length === 0 ? (
              <UsersLoading />
            ) : error && users.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : (
              <Card padded={false}>
                <div className="border-b border-[var(--line2)] p-[18px]">
                  {successMessage ? (
                    <div className="mb-4 rounded-[var(--radius-control)] border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-[13px] text-[var(--success-text)]">
                      {successMessage}
                    </div>
                  ) : null}

                  {error ? (
                    <div className="mb-4 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
                      {error}
                    </div>
                  ) : null}

                  <FilterBar>
                    <SearchField
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search users"
                      aria-label="Search users"
                    />

                    <select
                      aria-label="Role"
                      value={roleFilter}
                      onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                      className={filterSelectClass}
                    >
                      {ROLE_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Status"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                      className={filterSelectClass}
                    >
                      {STATUS_FILTER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Organization"
                      value={orgFilter}
                      onChange={(event) => setOrgFilter(event.target.value)}
                      className={filterSelectClass}
                    >
                      <option value="ALL">All organizations</option>
                      {organizationOptions.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>

                    <Tbtn variant="ghost" onClick={resetFilters}>
                      <X size={16} />
                      Reset
                    </Tbtn>
                  </FilterBar>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className={tableHeadClass}>
                        <th className={tableHeadCellClass}>User</th>
                        <th className={`${tableHeadCellClass} whitespace-nowrap`}>Role</th>
                        <th className={tableHeadCellClass}>Organization</th>
                        <th className={tableHeadCellClass}>Capabilities</th>
                        <th className={`${tableHeadCellClass} whitespace-nowrap`}>Status</th>
                        <th className={`${tableHeadCellClass} text-right`}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((user) => {
                        const isCurrentUser = user.id === session?.user?.id;
                        const disableDeactivate = isCurrentUser && user.isActive;
                        const manageable = canManageTarget(user);
                        const orgLabel = user.organization
                          ? optionLabel(user.organization)
                          : "Not assigned";
                        const regionAccess = operationalRegionAccessNames(user);
                        const userCapabilities = capabilityNameList(user);

                        return (
                          <tr key={user.id} className={`${tableRowClass} last:border-b-0`}>
                            <td className={tableCellClass}>
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[11px] font-bold text-[var(--brand-strong)]">
                                  {initialsOf(user.name)}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-[var(--foreground)]">
                                    {user.name}
                                  </div>
                                  <div className="truncate text-[12px] text-[var(--muted)]">
                                    {user.email}
                                  </div>
                                  {user.department ? (
                                    <div className="truncate text-[11px] text-[var(--muted-2)]">
                                      {user.department.name}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className={`${tableCellClass} whitespace-nowrap`}>
                              <RoleBadge role={user.role} />
                            </td>
                            <td className={tableCellClass}>
                              <div className="max-w-52 truncate font-medium text-[var(--foreground)]">
                                {orgLabel}
                              </div>
                              {regionAccess ? (
                                <div className="mt-1 max-w-52 truncate text-[12px] text-[var(--muted)]">
                                  Regions: {regionAccess}
                                </div>
                              ) : null}
                            </td>
                            <td className={tableCellClass}>
                              {userCapabilities.length > 0 ? (
                                <div className="flex max-w-72 flex-wrap gap-1.5">
                                  {userCapabilities.map((name) => (
                                    <Chip key={name} tone="neutral">
                                      {name}
                                    </Chip>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[var(--muted-2)]">—</span>
                              )}
                            </td>
                            <td className={`${tableCellClass} whitespace-nowrap`}>
                              <StatusBadge isActive={user.isActive} />
                            </td>
                            <td className={tableCellClass}>
                              <div className="flex flex-wrap justify-end gap-2">
                                {manageable ? (
                                  <Tbtn onClick={() => openEditModal(user)}>
                                    <Pencil size={14} />
                                    Edit
                                  </Tbtn>
                                ) : null}
                                {manageable ? (
                                  <Tbtn onClick={() => openPasswordModal(user)}>
                                    <KeyRound size={14} />
                                    Password
                                  </Tbtn>
                                ) : null}
                                {manageable ? (
                                  <Tbtn
                                    onClick={() => requestStatusToggle(user)}
                                    disabled={disableDeactivate || statusUserId === user.id}
                                    title={
                                      disableDeactivate
                                        ? "You cannot deactivate your own account"
                                        : undefined
                                    }
                                  >
                                    <Power size={14} />
                                    {user.isActive ? "Deactivate" : "Activate"}
                                  </Tbtn>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredUsers.length === 0 ? (
                    <div className="border-t border-[var(--line2)] px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                        No users found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-[var(--line2)] px-[18px] py-3 text-[12.5px] text-[var(--muted)]">
                  Showing {filteredUsers.length} of {users.length}
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>

      {modalMode ? (
        <UserFormModal
          mode={modalMode}
          values={userForm}
          enterpriseOptions={enterpriseOptions}
          teams={teams}
          error={modalError}
          isSaving={isSaving}
          isManagerOnly={isManagerOnly}
          managerOrgId={managerOrgId}
          onChange={updateForm}
          onClose={closeUserModal}
          onSubmit={handleUserSubmit}
        />
      ) : null}

      {credential ? (
        <CredentialResultModal
          credential={credential}
          onClose={() => setCredential(null)}
        />
      ) : null}

      {passwordUser ? (
        <PasswordModal
          user={passwordUser}
          password={password}
          error={passwordError}
          isSaving={isSaving}
          setPassword={setPassword}
          onClose={closePasswordModal}
          onSubmit={handlePasswordSubmit}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(statusConfirmUser)}
        title={statusConfirmUser?.isActive ? "Deactivate record" : "Activate record"}
        message={
          statusConfirmUser?.isActive
            ? "Deactivate this record? It will no longer be available for assignment."
            : "Activate this record?"
        }
        confirmLabel={statusConfirmUser?.isActive ? "Deactivate" : "Activate"}
        tone={statusConfirmUser?.isActive ? "danger" : "default"}
        isBusy={Boolean(statusUserId)}
        onConfirm={confirmStatusToggle}
        onCancel={closeStatusConfirm}
      />
    </AppShell>
  );
}

export function UsersClient() {
  return (
    <AuthGuard>
      <UsersContent />
    </AuthGuard>
  );
}
