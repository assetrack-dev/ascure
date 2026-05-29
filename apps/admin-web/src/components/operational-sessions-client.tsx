"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import {
  createOperationalSession,
  fetchOperationalSessions,
} from "@/lib/operational-sessions";
import { fetchUsers } from "@/lib/users";
import type { AuthSession } from "@/types/auth";
import type { EnterpriseOptionRecord, EnterpriseOptions } from "@/types/enterprise";
import type {
  CreateOperationalSessionPayload,
  OperationalSession,
  OperationalSessionFilters,
  OperationalSessionScope,
  OperationalSessionStatus,
} from "@/types/operational-sessions";
import {
  OPERATIONAL_SESSION_SCOPES,
  OPERATIONAL_SESSION_STATUSES,
} from "@/types/operational-sessions";
import type { ManagedUser } from "@/types/users";

type FilterState = {
  scope: "" | OperationalSessionScope;
  status: "" | OperationalSessionStatus;
  assignedCompanyId: string;
  assignedQaUserId: string;
  mainheadId: string;
};

type CreateSessionForm = {
  workspaceId: string;
  organizationId: string;
  branchId: string;
  mainheadId: string;
  assignedCompanyId: string;
  assignedQaUserId: string;
  scope: OperationalSessionScope;
  targetDate: string;
  dueDate: string;
  remarks: string;
  pencawang: string;
  fromPencawang: string;
  toPencawang: string;
  assetReference: string;
  assetName: string;
};

const DEFAULT_FILTERS: FilterState = {
  scope: "",
  status: "",
  assignedCompanyId: "",
  assignedQaUserId: "",
  mainheadId: "",
};

const DEFAULT_CREATE_FORM: CreateSessionForm = {
  workspaceId: "",
  organizationId: "",
  branchId: "",
  mainheadId: "",
  assignedCompanyId: "",
  assignedQaUserId: "",
  scope: "SAVR",
  targetDate: "",
  dueDate: "",
  remarks: "",
  pencawang: "",
  fromPencawang: "",
  toPencawang: "",
  assetReference: "",
  assetName: "",
};

const filterControlClassName =
  "h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const labelClassName = "mb-1.5 block text-[11px] font-bold uppercase text-slate-500";

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

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "Not set";
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

function formatDateTime(date: string | null | undefined) {
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function optionLabel(option: {
  name?: string | null;
  code?: string | null;
  email?: string | null;
}) {
  const name = option.name?.trim();
  const code = option.code?.trim();

  if (code && name) {
    return `${code} - ${name}`;
  }

  return name || code || option.email?.trim() || "Unnamed";
}

function displayOrganization(
  organization: OperationalSession["assignedCompany"] | EnterpriseOptionRecord | null | undefined,
) {
  return organization ? optionLabel(organization) : "Not assigned";
}

function metadataSummary(session: OperationalSession) {
  const metadata = session.metadata;

  if (!metadata) {
    return "Metadata not recorded";
  }

  const values =
    session.scope === "SAVR"
      ? [metadata.pencawang]
      : session.scope === "SAVT"
        ? [metadata.fromPencawang, metadata.toPencawang]
        : [metadata.assetReference, metadata.assetName];

  return (
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .join(" / ") || "Metadata not recorded"
  );
}

function statusBadgeClassName(status: OperationalSessionStatus) {
  if (status === "APPROVED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "CANCELLED") {
    return "border-slate-300 bg-slate-100 text-slate-600";
  }

  if (status === "REJECTED") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "AMENDMENT_REQUIRED") {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }

  if (status === "QA_REVIEW" || status === "SUBMITTED") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (status === "IN_PROGRESS") {
    return "border-teal-200 bg-teal-50 text-teal-700";
  }

  return "border-slate-200 bg-white text-slate-700";
}

function StatusBadge({ status }: { status: OperationalSessionStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClassName(status)}`}
    >
      {formatEnum(status)}
    </span>
  );
}

function ProgressCell({ session }: { session: OperationalSession }) {
  const percentage = Math.min(Math.max(session.progress.completionPercentage, 0), 100);

  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
        <span>{percentage}%</span>
        <span className="text-[var(--muted)]">
          {session.progress.completedAssets}/{session.progress.totalAssets}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function toApiFilters(filters: FilterState, workspaceId?: string): OperationalSessionFilters {
  return {
    workspaceId,
    scope: filters.scope || undefined,
    status: filters.status || undefined,
    assignedCompanyId: filters.assignedCompanyId || undefined,
    assignedQaUserId: filters.assignedQaUserId || undefined,
    mainheadId: filters.mainheadId || undefined,
  };
}

function buildMetadata(form: CreateSessionForm) {
  const clean = (value: string) => value.trim();

  if (form.scope === "SAVR") {
    return clean(form.pencawang)
      ? {
          pencawang: clean(form.pencawang),
        }
      : undefined;
  }

  if (form.scope === "SAVT") {
    return clean(form.fromPencawang) || clean(form.toPencawang)
      ? {
          fromPencawang: clean(form.fromPencawang),
          toPencawang: clean(form.toPencawang),
        }
      : undefined;
  }

  return clean(form.assetReference) || clean(form.assetName)
    ? {
        assetReference: clean(form.assetReference),
        assetName: clean(form.assetName),
      }
    : undefined;
}

function uniqueQaUsers(sessions: OperationalSession[], users: ManagedUser[]) {
  const options = new Map<string, string>();

  users
    .filter((user) => user.isActive && user.role !== "VIEWER" && user.role !== "CLIENT")
    .forEach((user) => options.set(user.id, optionLabel(user)));

  sessions.forEach((session) => {
    if (session.assignedQaUserId) {
      options.set(
        session.assignedQaUserId,
        optionLabel(session.assignedQaUser ?? { name: "Assigned QA/QC" }),
      );
    }
  });

  return Array.from(options.entries()).sort((left, right) =>
    left[1].localeCompare(right[1], "en", { sensitivity: "base" }),
  );
}

function SessionCreateModal({
  form,
  enterpriseOptions,
  users,
  error,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  form: CreateSessionForm;
  enterpriseOptions: EnterpriseOptions | null;
  users: ManagedUser[];
  error: string;
  isSaving: boolean;
  onChange: <K extends keyof CreateSessionForm>(key: K, value: CreateSessionForm[K]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const organizations = enterpriseOptions?.organizations ?? [];
  const branches = (enterpriseOptions?.branches ?? []).filter(
    (branch) => !form.organizationId || branch.organizationId === form.organizationId,
  );
  const mainheads = (enterpriseOptions?.mainheads ?? []).filter(
    (mainhead) => !form.branchId || mainhead.branchId === form.branchId,
  );
  const qaUsers = users.filter(
    (user) => user.isActive && user.role !== "VIEWER" && user.role !== "CLIENT",
  );

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/45 px-4 py-6">
      <div className="mx-auto w-full max-w-4xl rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Create Operational Session</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Assign an inspection coordination container for field and QA/QC work.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close create session form"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-5 py-5">
          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className={labelClassName}>Workspace</span>
              <input
                value={form.workspaceId}
                readOnly
                className={`${filterControlClassName} bg-slate-50 text-slate-600`}
              />
            </label>

            <label className="block">
              <span className={labelClassName}>Organization</span>
              <select
                value={form.organizationId}
                onChange={(event) => {
                  onChange("organizationId", event.target.value);
                  onChange("branchId", "");
                  onChange("mainheadId", "");
                }}
                className={filterControlClassName}
                required
              >
                <option value="">Select organization</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {optionLabel(organization)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>Branch</span>
              <select
                value={form.branchId}
                onChange={(event) => {
                  onChange("branchId", event.target.value);
                  onChange("mainheadId", "");
                }}
                className={filterControlClassName}
              >
                <option value="">No branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {optionLabel(branch)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>MAINHEAD</span>
              <select
                value={form.mainheadId}
                onChange={(event) => onChange("mainheadId", event.target.value)}
                className={filterControlClassName}
              >
                <option value="">No MAINHEAD</option>
                {mainheads.map((mainhead) => (
                  <option key={mainhead.id} value={mainhead.id}>
                    {optionLabel(mainhead)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>Assigned Company</span>
              <select
                value={form.assignedCompanyId}
                onChange={(event) => onChange("assignedCompanyId", event.target.value)}
                className={filterControlClassName}
                required
              >
                <option value="">Select company</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {optionLabel(organization)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>Scope</span>
              <select
                value={form.scope}
                onChange={(event) =>
                  onChange("scope", event.target.value as OperationalSessionScope)
                }
                className={filterControlClassName}
              >
                {OPERATIONAL_SESSION_SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {formatEnum(scope)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>Assigned QA/QC</span>
              <select
                value={form.assignedQaUserId}
                onChange={(event) => onChange("assignedQaUserId", event.target.value)}
                className={filterControlClassName}
              >
                <option value="">No QA/QC assigned</option>
                {qaUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {optionLabel(user)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={labelClassName}>Target Date</span>
              <input
                type="date"
                value={form.targetDate}
                onChange={(event) => onChange("targetDate", event.target.value)}
                className={filterControlClassName}
              />
            </label>

            <label className="block">
              <span className={labelClassName}>Due Date</span>
              <input
                type="date"
                value={form.dueDate}
                onChange={(event) => onChange("dueDate", event.target.value)}
                className={filterControlClassName}
              />
            </label>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {form.scope === "SAVR" ? (
              <label className="block">
                <span className={labelClassName}>Pencawang</span>
                <input
                  value={form.pencawang}
                  onChange={(event) => onChange("pencawang", event.target.value)}
                  className={filterControlClassName}
                  placeholder="Pencawang code or name"
                />
              </label>
            ) : null}

            {form.scope === "SAVT" ? (
              <>
                <label className="block">
                  <span className={labelClassName}>From Pencawang</span>
                  <input
                    value={form.fromPencawang}
                    onChange={(event) => onChange("fromPencawang", event.target.value)}
                    className={filterControlClassName}
                  />
                </label>
                <label className="block">
                  <span className={labelClassName}>To Pencawang</span>
                  <input
                    value={form.toPencawang}
                    onChange={(event) => onChange("toPencawang", event.target.value)}
                    className={filterControlClassName}
                  />
                </label>
              </>
            ) : null}

            {form.scope !== "SAVR" && form.scope !== "SAVT" ? (
              <>
                <label className="block">
                  <span className={labelClassName}>Asset Reference</span>
                  <input
                    value={form.assetReference}
                    onChange={(event) => onChange("assetReference", event.target.value)}
                    className={filterControlClassName}
                  />
                </label>
                <label className="block">
                  <span className={labelClassName}>Asset Name</span>
                  <input
                    value={form.assetName}
                    onChange={(event) => onChange("assetName", event.target.value)}
                    className={filterControlClassName}
                  />
                </label>
              </>
            ) : null}

            <label className="block md:col-span-2">
              <span className={labelClassName}>Remarks</span>
              <textarea
                value={form.remarks}
                onChange={(event) => onChange("remarks", event.target.value)}
                rows={3}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className={secondaryButtonClassName}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className={primaryButtonClassName} disabled={isSaving}>
              {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
              Create Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SessionsLoading() {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </section>
  );
}

function OperationalSessionsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessions, setSessions] = useState<OperationalSession[]>([]);
  const [enterpriseOptions, setEnterpriseOptions] = useState<EnterpriseOptions | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [createForm, setCreateForm] = useState<CreateSessionForm>(DEFAULT_CREATE_FORM);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalError, setModalError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadSessions = useCallback(
    async (token: string, nextFilters: FilterState, workspaceId?: string) => {
      setIsLoading(true);
      setError("");

      try {
        setSessions(
          await fetchOperationalSessions(token, toApiFilters(nextFilters, workspaceId)),
        );
      } catch (sessionsError) {
        if (sessionsError instanceof ApiError && sessionsError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          sessionsError instanceof Error
            ? sessionsError.message
            : "Unable to load operational sessions.",
        );
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
      return;
    }

    setCreateForm((currentForm) => ({
      ...currentForm,
      workspaceId: storedSession.user?.tenantId ?? "",
    }));

    void loadSessions(
      storedSession.token,
      DEFAULT_FILTERS,
      storedSession.user?.tenantId,
    );

    void fetchEnterpriseOptions(storedSession.token)
      .then(setEnterpriseOptions)
      .catch(() => setEnterpriseOptions(null));

    if (storedSession.user?.role === "ADMIN") {
      void fetchUsers(storedSession.token)
        .then(setUsers)
        .catch((usersError) => {
          if (usersError instanceof ApiError && usersError.status === 401) {
            handleLogout();
            return;
          }

          setUsers([]);
        });
    }
  }, [handleLogout, loadSessions]);

  useEffect(() => {
    if (!session?.token) {
      return;
    }

    void loadSessions(session.token, filters, session.user?.tenantId);
  }, [filters, loadSessions, session?.token, session?.user?.tenantId]);

  const qaFilterOptions = useMemo(() => uniqueQaUsers(sessions, users), [sessions, users]);
  const canCreate = session?.user?.role === "ADMIN";
  const finalCount = sessions.filter(
    (item) => item.status === "APPROVED" || item.status === "CANCELLED",
  ).length;
  const activeCount = sessions.length - finalCount;

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  function updateCreateForm<K extends keyof CreateSessionForm>(
    key: K,
    value: CreateSessionForm[K],
  ) {
    setCreateForm((currentForm) => ({
      ...currentForm,
      [key]: value,
    }));
  }

  function openCreateModal() {
    setModalError("");
    setCreateForm({
      ...DEFAULT_CREATE_FORM,
      workspaceId: session?.user?.tenantId ?? "",
    });
    setIsCreateOpen(true);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  async function handleCreateSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || isSaving) {
      return;
    }

    if (!createForm.workspaceId || !createForm.organizationId || !createForm.assignedCompanyId) {
      setModalError("Workspace, organization, and assigned company are required.");
      return;
    }

    const payload: CreateOperationalSessionPayload = {
      workspaceId: createForm.workspaceId,
      organizationId: createForm.organizationId,
      branchId: createForm.branchId || undefined,
      mainheadId: createForm.mainheadId || undefined,
      assignedCompanyId: createForm.assignedCompanyId,
      assignedQaUserId: createForm.assignedQaUserId || undefined,
      scope: createForm.scope,
      metadata: buildMetadata(createForm),
      targetDate: createForm.targetDate || undefined,
      dueDate: createForm.dueDate || undefined,
      remarks: createForm.remarks.trim() || undefined,
    };

    setIsSaving(true);
    setModalError("");
    setNotice("");

    try {
      const createdSession = await createOperationalSession(session.token, payload);
      setIsCreateOpen(false);
      router.push(`/operational-sessions/${encodeURIComponent(createdSession.id)}`);
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(
        createError instanceof Error
          ? createError.message
          : "Unable to create operational session.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operational Coordination
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Operations / Sessions
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {canCreate ? "Admin manage" : "Scoped access"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {sessions.length} visible sessions
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {activeCount} active / {finalCount} final
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() =>
                  session?.token
                    ? loadSessions(session.token, filters, session.user?.tenantId)
                    : undefined
                }
                disabled={isLoading || !session?.token}
                className={secondaryButtonClassName}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </button>
              {canCreate ? (
                <button type="button" onClick={openCreateModal} className={primaryButtonClassName}>
                  <Plus size={16} />
                  Create Session
                </button>
              ) : null}
            </div>
          </div>

          <section className="mt-6 rounded-lg border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-soft)]">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
              <label className="block">
                <span className={labelClassName}>Scope</span>
                <select
                  value={filters.scope}
                  onChange={(event) =>
                    updateFilter("scope", event.target.value as FilterState["scope"])
                  }
                  className={filterControlClassName}
                >
                  <option value="">All scopes</option>
                  {OPERATIONAL_SESSION_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>
                      {formatEnum(scope)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelClassName}>Status</span>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    updateFilter("status", event.target.value as FilterState["status"])
                  }
                  className={filterControlClassName}
                >
                  <option value="">All statuses</option>
                  {OPERATIONAL_SESSION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatEnum(status)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelClassName}>Company</span>
                <select
                  value={filters.assignedCompanyId}
                  onChange={(event) => updateFilter("assignedCompanyId", event.target.value)}
                  className={filterControlClassName}
                >
                  <option value="">All companies</option>
                  {(enterpriseOptions?.organizations ?? []).map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {optionLabel(organization)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelClassName}>QA/QC</span>
                <select
                  value={filters.assignedQaUserId}
                  onChange={(event) => updateFilter("assignedQaUserId", event.target.value)}
                  className={filterControlClassName}
                >
                  <option value="">All QA/QC</option>
                  {qaFilterOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelClassName}>MAINHEAD</span>
                <select
                  value={filters.mainheadId}
                  onChange={(event) => updateFilter("mainheadId", event.target.value)}
                  className={filterControlClassName}
                >
                  <option value="">All MAINHEADs</option>
                  {(enterpriseOptions?.mainheads ?? []).map((mainhead) => (
                    <option key={mainhead.id} value={mainhead.id}>
                      {optionLabel(mainhead)}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={resetFilters}
                className={`${secondaryButtonClassName} self-end`}
              >
                <X size={16} />
                Reset
              </button>
            </div>
          </section>

          <div className="mt-6">
            {notice ? (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                {notice}
              </div>
            ) : null}

            {isLoading && sessions.length === 0 ? (
              <SessionsLoading />
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[13%]" />
                      <col className="w-[8%]" />
                      <col className="w-[20%]" />
                      <col className="w-[14%]" />
                      <col className="w-[12%]" />
                      <col className="w-[11%]" />
                      <col className="w-[9%]" />
                      <col className="w-[7%]" />
                      <col className="w-[6%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="px-3 py-3.5">Session No</th>
                        <th className="px-3 py-3.5">Scope</th>
                        <th className="px-3 py-3.5">Location / Metadata</th>
                        <th className="px-3 py-3.5">Assigned Company</th>
                        <th className="px-3 py-3.5">QA/QC</th>
                        <th className="px-3 py-3.5">Status</th>
                        <th className="px-3 py-3.5">Progress</th>
                        <th className="px-3 py-3.5">Due Date</th>
                        <th className="px-3 py-3.5">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sessions.map((item) => (
                        <tr
                          key={item.id}
                          tabIndex={0}
                          onClick={() =>
                            router.push(`/operational-sessions/${encodeURIComponent(item.id)}`)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              router.push(
                                `/operational-sessions/${encodeURIComponent(item.id)}`,
                              );
                            }
                          }}
                          className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                        >
                          <td className="px-3 py-4 align-top">
                            <div className="truncate font-bold text-slate-950">
                              {item.sessionNo}
                            </div>
                            <div className="mt-1 truncate text-xs text-[var(--muted)]">
                              {item.workspace?.code ?? item.workspaceId}
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top font-semibold text-slate-700">
                            {formatEnum(item.scope)}
                          </td>
                          <td className="px-3 py-4 align-top">
                            <div className="truncate font-semibold text-slate-900">
                              {metadataSummary(item)}
                            </div>
                            <div className="mt-1 truncate text-xs text-[var(--muted)]">
                              {item.mainhead ? optionLabel(item.mainhead) : "MAINHEAD not set"}
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top text-slate-700">
                            <div className="truncate font-semibold">
                              {displayOrganization(item.assignedCompany)}
                            </div>
                            <div className="mt-1 truncate text-xs text-[var(--muted)]">
                              Owner: {displayOrganization(item.organization)}
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top text-slate-700">
                            <div className="truncate font-semibold">
                              {item.assignedQaUser
                                ? optionLabel(item.assignedQaUser)
                                : "Unassigned"}
                            </div>
                          </td>
                          <td className="px-3 py-4 align-top">
                            <StatusBadge status={item.status} />
                          </td>
                          <td className="px-3 py-4 align-top">
                            <ProgressCell session={item} />
                          </td>
                          <td className="px-3 py-4 align-top text-slate-700">
                            {formatDate(item.dueDate)}
                          </td>
                          <td className="px-3 py-4 align-top text-slate-600">
                            {formatDateTime(item.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {sessions.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No operational sessions found
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      {isCreateOpen ? (
        <SessionCreateModal
          form={createForm}
          enterpriseOptions={enterpriseOptions}
          users={users}
          error={modalError}
          isSaving={isSaving}
          onChange={updateCreateForm}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleCreateSession}
        />
      ) : null}
    </AppShell>
  );
}

export function OperationalSessionsClient() {
  return (
    <AuthGuard>
      <OperationalSessionsContent />
    </AuthGuard>
  );
}
