"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
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
type ModalMode = "create" | "edit";

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
const inputClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";

function UsersLoading() {
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

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function roleLabel(role: UserRole) {
  return role.charAt(0) + role.slice(1).toLowerCase();
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
  const className = isActive
    ? "border-green-200 bg-green-50 text-green-700"
    : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const className =
    role === "ADMIN"
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : role === "MANAGER"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : role === "SUPERVISOR"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : role === "CLIENT"
            ? "border-cyan-200 bg-cyan-50 text-cyan-700"
            : role === "VIEWER"
              ? "border-violet-200 bg-violet-50 text-violet-700"
              : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {roleLabel(role)}
    </span>
  );
}

function UserCapabilityPicker({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: EnterpriseOptions | null;
  onChange: (nextValues: string[]) => void;
}) {
  if (!options?.capabilities.length) {
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
    <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-700">
        Capabilities
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.capabilities.map((capability) => (
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
    <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-sm font-semibold text-slate-700">
        {title}
      </legend>
      <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.id}
            className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
          >
            <input
              type="checkbox"
              checked={values.includes(option.id)}
              onChange={(event) => toggleOption(option.id, event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
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

function UserFormModal({
  mode,
  values,
  enterpriseOptions,
  teams,
  error,
  isSaving,
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
  onChange: <K extends keyof UserFormState>(field: K, value: UserFormState[K]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isCreateMode = mode === "create";
  const activeMainheads = enterpriseOptions?.mainheads ?? [];
  const activeOperationalRegions = enterpriseOptions?.operationalRegions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              {isCreateMode ? "New User" : "Edit User"}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {isCreateMode ? "Create User" : "Update User"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close user modal"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} autoComplete="off" className="space-y-4 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

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
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <input
              type="email"
              value={values.email}
              onChange={(event) => onChange("email", event.target.value)}
              autoComplete="new-email"
              className={`${inputClassName} mt-1.5`}
              required
              maxLength={320}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Role</span>
            <select
              value={values.role}
              onChange={(event) => onChange("role", event.target.value as UserRole)}
              className={`${inputClassName} mt-1.5`}
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Organization</span>
              <select
                value={values.organizationId}
                onChange={(event) => onChange("organizationId", event.target.value)}
                className={`${inputClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Branch</span>
              <select
                value={values.branchId}
                onChange={(event) => onChange("branchId", event.target.value)}
                className={`${inputClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Team</span>
              <select
                value={values.teamId}
                onChange={(event) => onChange("teamId", event.target.value)}
                className={`${inputClassName} mt-1.5`}
              >
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {optionLabel(team)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <UserAccessPicker
            title="MAINHEAD Access"
            values={values.mainheadAccessIds}
            options={activeMainheads}
            onChange={(nextValues) => {
              onChange("mainheadAccessIds", nextValues);
              onChange("mainheadId", nextValues[0] ?? "");
            }}
          />

          <UserAccessPicker
            title="Region Access"
            values={values.operationalRegionAccessIds}
            options={activeOperationalRegions}
            onChange={(nextValues) => onChange("operationalRegionAccessIds", nextValues)}
          />

          <UserCapabilityPicker
            values={values.capabilityIds}
            options={enterpriseOptions}
            onChange={(nextValues) => onChange("capabilityIds", nextValues)}
          />

          {isCreateMode ? (
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input
                type="password"
                value={values.password}
                onChange={(event) => onChange("password", event.target.value)}
                autoComplete="new-password"
                className={`${inputClassName} mt-1.5`}
                required
                minLength={8}
                maxLength={128}
              />
            </label>
          ) : null}

          {isCreateMode ? (
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

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClassName}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : isCreateMode ? "Create User" : "Save Changes"}
            </button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              Reset Password
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{user.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close password modal"
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

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">New Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className={`${inputClassName} mt-1.5`}
              required
              minLength={8}
              maxLength={128}
            />
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClassName}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
              <KeyRound size={16} />
              {isSaving ? "Saving" : "Reset Password"}
            </button>
          </div>
        </form>
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
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() => createDefaultUserForm());
  const [modalError, setModalError] = useState("");
  const [passwordUser, setPasswordUser] = useState<ManagedUser | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusUserId, setStatusUserId] = useState<string | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadUsers = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

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

    if (storedSession.user && storedSession.user.role !== "ADMIN") {
      setError("ADMIN role is required to manage users.");
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

        return matchesRole && matchesStatus && matchesSearch;
      })
      .sort((left, right) => {
        const nameSort = left.name.localeCompare(right.name, "en", {
          numeric: true,
          sensitivity: "base",
        });

        return nameSort || left.email.localeCompare(right.email, "en", { sensitivity: "base" });
      });
  }, [roleFilter, search, statusFilter, users]);

  const isAdmin = session?.user?.role === "ADMIN";
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
      const updatedUser =
        modalMode === "create"
          ? await createUser(session.token, {
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
            })
          : selectedUser
            ? await updateUser(session.token, selectedUser.id, {
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
              })
            : null;

      if (updatedUser) {
        upsertUser(updatedUser);
      }

      closeUserModal();
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
      const updatedUser = await resetUserPassword(session.token, passwordUser.id, password);
      upsertUser(updatedUser);
      closePasswordModal();
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

  async function handleStatusToggle(user: ManagedUser) {
    if (!session?.token || statusUserId) {
      return;
    }

    const nextIsActive = !user.isActive;

    setStatusUserId(user.id);
    setError("");

    try {
      const updatedUser = await updateUserStatus(session.token, user.id, nextIsActive);
      upsertUser(updatedUser);
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) {
        handleLogout();
        return;
      }

      setError(requestErrorMessage(statusError, "Unable to update user status."));
    } finally {
      setStatusUserId(null);
    }
  }

  function resetFilters() {
    setSearch("");
    setRoleFilter("ALL");
    setStatusFilter("ALL");
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                User Management
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Users
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isAdmin ? "Admin access" : "Restricted"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {users.length} total
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {activeUserCount} active
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {activeAdminCount} active admins
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (session?.token ? loadUsers(session.token) : undefined)}
                disabled={isLoading || !session?.token || !isAdmin}
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
                Create User
              </button>
            </div>
          </div>

          <div className="mt-6">
            {isLoading && users.length === 0 ? (
              <UsersLoading />
            ) : error && users.length === 0 ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  {error ? (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(150px,auto))_auto]">
                    <label className="relative block">
                      <span className="sr-only">Search users</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search users"
                        className={searchControlClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">Role</span>
                      <select
                        value={roleFilter}
                        onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                        className={inputClassName}
                      >
                        {ROLE_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Status</span>
                      <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                        className={inputClassName}
                      >
                        {STATUS_FILTER_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button type="button" onClick={resetFilters} className={secondaryButtonClassName}>
                      <X size={16} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="min-w-56 px-5 py-3.5 font-semibold">Name</th>
                        <th className="min-w-64 px-5 py-3.5 font-semibold">Email</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Role</th>
                        <th className="min-w-64 px-5 py-3.5 font-semibold">Scope</th>
                        <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Status</th>
                        <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((user) => {
                        const isCurrentUser = user.id === session?.user?.id;
                        const disableDeactivate = isCurrentUser && user.isActive;
                        const scopeLabel =
                          [
                            user.organization?.code || user.organization?.name,
                            user.branch?.code || user.branch?.name,
                            mainheadAccessNames(user),
                            user.team?.code || user.team?.name,
                          ]
                            .filter(Boolean)
                            .join(" / ") || "Not assigned";
                        const regionAccess = operationalRegionAccessNames(user);
                        const userCapabilities = capabilityNames(user);

                        return (
                          <tr key={user.id} className="transition hover:bg-teal-50/40">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                  <UserRound size={17} />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-semibold text-slate-900">
                                    {user.name}
                                  </div>
                                  {user.department ? (
                                    <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                                      {user.department.name}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {user.email}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <RoleBadge role={user.role} />
                            </td>
                            <td className="px-5 py-4 text-slate-700">
                              <div className="max-w-72 truncate font-medium text-slate-900">
                                {scopeLabel}
                              </div>
                              {userCapabilities ? (
                                <div className="mt-1 max-w-72 truncate text-xs text-[var(--muted)]">
                                  {userCapabilities}
                                </div>
                              ) : null}
                              {regionAccess ? (
                                <div className="mt-1 max-w-72 truncate text-xs text-[var(--muted)]">
                                  Regions: {regionAccess}
                                </div>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <StatusBadge isActive={user.isActive} />
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-wrap justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(user)}
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                                >
                                  <Pencil size={14} />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openPasswordModal(user)}
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                                >
                                  <KeyRound size={14} />
                                  Password
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleStatusToggle(user)}
                                  disabled={disableDeactivate || statusUserId === user.id}
                                  title={
                                    disableDeactivate
                                      ? "You cannot deactivate your own account"
                                      : undefined
                                  }
                                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  <Power size={14} />
                                  {user.isActive ? "Deactivate" : "Activate"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredUsers.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No users found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
                  Showing {filteredUsers.length} of {users.length}
                </div>
              </section>
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
          onChange={updateForm}
          onClose={closeUserModal}
          onSubmit={handleUserSubmit}
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
