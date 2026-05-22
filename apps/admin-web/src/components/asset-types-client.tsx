"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Layers2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  createAssetType,
  fetchAssetTypesForAdmin,
  updateAssetType,
  updateAssetTypeStatus,
} from "@/lib/asset-types";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import type { AuthSession } from "@/types/auth";
import type { ManagedAssetType } from "@/types/asset-types";
import type { EnterpriseOptionRecord } from "@/types/enterprise";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";
type ModalMode = "create" | "edit";

interface AssetTypeFormState {
  code: string;
  name: string;
  capabilityId: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

const inputClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const textareaClassName =
  "min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const rowActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function defaultForm(): AssetTypeFormState {
  return {
    code: "",
    name: "",
    capabilityId: "",
    description: "",
    sortOrder: "",
    isActive: true,
  };
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function sortAssetTypes(assetTypes: ManagedAssetType[]) {
  return [...assetTypes].sort((left, right) => {
    const sortOrderComparison =
      (left.sortOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.sortOrder ?? Number.MAX_SAFE_INTEGER);

    if (sortOrderComparison !== 0) {
      return sortOrderComparison;
    }

    return left.name.localeCompare(right.name, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function upsertAssetType(assetTypes: ManagedAssetType[], nextAssetType: ManagedAssetType) {
  const exists = assetTypes.some((assetType) => assetType.id === nextAssetType.id);
  const nextAssetTypes = exists
    ? assetTypes.map((assetType) => (assetType.id === nextAssetType.id ? nextAssetType : assetType))
    : [nextAssetType, ...assetTypes];

  return sortAssetTypes(nextAssetTypes);
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${
        isActive
          ? "border-teal-200 bg-teal-50 text-teal-800"
          : "border-slate-200 bg-slate-100 text-slate-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-teal-600" : "bg-slate-400"}`} />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function AssetTypeModal({
  mode,
  values,
  capabilities,
  error,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  mode: ModalMode;
  values: AssetTypeFormState;
  capabilities: EnterpriseOptionRecord[];
  error: string;
  isSaving: boolean;
  onChange: (values: AssetTypeFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-6">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              {mode === "create" ? "New Asset Type" : "Edit Asset Type"}
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              {mode === "create" ? "Create Asset Type" : "Update Asset Type"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close asset type modal"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Name</span>
              <input
                type="text"
                value={values.name}
                onChange={(event) => onChange({ ...values, name: event.target.value })}
                className={`${inputClassName} mt-1.5`}
                maxLength={255}
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Code</span>
              <input
                type="text"
                value={values.code}
                onChange={(event) => onChange({ ...values, code: event.target.value.toUpperCase() })}
                className={`${inputClassName} mt-1.5`}
                maxLength={64}
                required
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Capability</span>
              <select
                value={values.capabilityId}
                onChange={(event) => onChange({ ...values, capabilityId: event.target.value })}
                className={`${inputClassName} mt-1.5`}
              >
                <option value="">No capability</option>
                {capabilities.map((capability) => (
                  <option key={capability.id} value={capability.id}>
                    {capability.code ? `${capability.code} - ${capability.name}` : capability.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Sort Order</span>
              <input
                type="number"
                min={0}
                value={values.sortOrder}
                onChange={(event) => onChange({ ...values, sortOrder: event.target.value })}
                className={`${inputClassName} mt-1.5`}
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Description</span>
            <textarea
              value={values.description}
              onChange={(event) => onChange({ ...values, description: event.target.value })}
              className={`${textareaClassName} mt-1.5`}
              maxLength={1000}
            />
          </label>

          <label className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
            />
            Active
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClassName}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssetTypesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [assetTypes, setAssetTypes] = useState<ManagedAssetType[]>([]);
  const [capabilities, setCapabilities] = useState<EnterpriseOptionRecord[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [capabilityFilter, setCapabilityFilter] = useState("ALL");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actionAssetTypeId, setActionAssetTypeId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selectedAssetType, setSelectedAssetType] = useState<ManagedAssetType | null>(null);
  const [formValues, setFormValues] = useState<AssetTypeFormState>(defaultForm());
  const [modalError, setModalError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const [nextAssetTypes, options] = await Promise.all([
          fetchAssetTypesForAdmin(token),
          fetchEnterpriseOptions(token),
        ]);
        setAssetTypes(sortAssetTypes(nextAssetTypes));
        setCapabilities(options.capabilities.filter((capability) => capability.isActive !== false));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("ADMIN role is required to manage asset types.");
          return;
        }

        setError(requestErrorMessage(loadError, "Unable to load asset types."));
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
      setError("ADMIN role is required to manage asset types.");
      setIsLoading(false);
      return;
    }

    void loadData(storedSession.token);
  }, [loadData]);

  const filteredAssetTypes = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return assetTypes.filter((assetType) => {
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" ? assetType.isActive : !assetType.isActive);
      const matchesCapability =
        capabilityFilter === "ALL" || assetType.capabilityId === capabilityFilter;
      const matchesSearch =
        !normalizedSearch ||
        [
          assetType.name,
          assetType.code,
          assetType.description,
          assetType.capability?.name,
          assetType.capability?.code,
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));

      return matchesStatus && matchesCapability && matchesSearch;
    });
  }, [assetTypes, capabilityFilter, search, statusFilter]);

  const isAdmin = session?.user?.role === "ADMIN";
  const activeCount = assetTypes.filter((assetType) => assetType.isActive).length;
  const inactiveCount = assetTypes.length - activeCount;

  function resetFilters() {
    setSearch("");
    setStatusFilter("ALL");
    setCapabilityFilter("ALL");
  }

  function openCreateModal() {
    setSelectedAssetType(null);
    setFormValues(defaultForm());
    setModalError("");
    setModalMode("create");
  }

  function openEditModal(assetType: ManagedAssetType) {
    setSelectedAssetType(assetType);
    setFormValues({
      code: assetType.code,
      name: assetType.name,
      capabilityId: assetType.capabilityId ?? "",
      description: assetType.description ?? "",
      sortOrder: assetType.sortOrder === null || assetType.sortOrder === undefined
        ? ""
        : String(assetType.sortOrder),
      isActive: assetType.isActive,
    });
    setModalError("");
    setModalMode("edit");
  }

  function closeModal() {
    if (isSaving) {
      return;
    }

    setModalMode(null);
    setSelectedAssetType(null);
    setModalError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || !modalMode) {
      return;
    }

    const code = formValues.code.trim().toUpperCase();
    const name = formValues.name.trim();
    const sortOrder = formValues.sortOrder.trim();

    if (!code || !name) {
      setModalError("Name and code are required.");
      return;
    }

    const payload = {
      code,
      name,
      capabilityId: formValues.capabilityId || null,
      description: formValues.description.trim() || null,
      isActive: formValues.isActive,
      sortOrder: sortOrder ? Number(sortOrder) : null,
    };

    if (payload.sortOrder !== null && !Number.isFinite(payload.sortOrder)) {
      setModalError("Sort order must be a number.");
      return;
    }

    setIsSaving(true);
    setModalError("");
    setNotice("");

    try {
      const savedAssetType =
        modalMode === "create"
          ? await createAssetType(session.token, payload)
          : selectedAssetType
            ? await updateAssetType(session.token, selectedAssetType.id, payload)
            : null;

      if (savedAssetType) {
        setAssetTypes((currentAssetTypes) => upsertAssetType(currentAssetTypes, savedAssetType));
        setNotice("Asset type saved.");
      }

      closeModal();
    } catch (submitError) {
      if (submitError instanceof ApiError && submitError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(requestErrorMessage(submitError, "Unable to save asset type."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleStatus(assetType: ManagedAssetType) {
    if (!session?.token || actionAssetTypeId) {
      return;
    }

    const nextIsActive = !assetType.isActive;
    const confirmed = window.confirm(
      `${nextIsActive ? "Activate" : "Deactivate"} ${assetType.code} - ${assetType.name}?`,
    );

    if (!confirmed) {
      return;
    }

    setActionAssetTypeId(assetType.id);
    setError("");
    setNotice("");

    try {
      const updatedAssetType = await updateAssetTypeStatus(
        session.token,
        assetType.id,
        nextIsActive,
      );
      setAssetTypes((currentAssetTypes) => upsertAssetType(currentAssetTypes, updatedAssetType));
      setNotice(nextIsActive ? "Asset type activated." : "Asset type deactivated.");
    } catch (toggleError) {
      if (toggleError instanceof ApiError && toggleError.status === 401) {
        handleLogout();
        return;
      }

      setError(requestErrorMessage(toggleError, "Unable to update asset type status."));
    } finally {
      setActionAssetTypeId(null);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operational Master Data
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Asset Types
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {assetTypes.length} total
                </span>
                <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 shadow-[var(--shadow-soft)]">
                  {activeCount} active
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-[var(--shadow-soft)]">
                  {inactiveCount} inactive
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (session?.token ? loadData(session.token) : undefined)}
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
                Create Asset Type
              </button>
            </div>
          </div>

          <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
            <div className="border-b border-slate-200 p-5">
              {error ? (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
              {notice ? (
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {notice}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(160px,auto))_auto]">
                <label className="relative block">
                  <span className="sr-only">Search asset types</span>
                  <Search
                    size={17}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search asset types"
                    className={searchControlClassName}
                  />
                </label>

                <label className="block">
                  <span className="sr-only">Capability</span>
                  <select
                    value={capabilityFilter}
                    onChange={(event) => setCapabilityFilter(event.target.value)}
                    className={inputClassName}
                  >
                    <option value="ALL">All capabilities</option>
                    {capabilities.map((capability) => (
                      <option key={capability.id} value={capability.id}>
                        {capability.name}
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
                    <option value="ALL">All statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
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
                    <th className="min-w-64 px-5 py-3.5 font-semibold">Asset Type</th>
                    <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Capability</th>
                    <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Status</th>
                    <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Sort</th>
                    <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Templates</th>
                    <th className="whitespace-nowrap px-5 py-3.5 font-semibold">Assets</th>
                    <th className="whitespace-nowrap px-5 py-3.5 text-right font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAssetTypes.map((assetType) => {
                    const isActionRunning = actionAssetTypeId === assetType.id;

                    return (
                      <tr key={assetType.id} className="transition hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                              <Layers2 size={17} />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">{assetType.name}</div>
                              <div className="mt-0.5 text-xs text-[var(--muted)]">{assetType.code}</div>
                              {assetType.description ? (
                                <div className="mt-1 max-w-md text-xs leading-5 text-[var(--muted)]">
                                  {assetType.description}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {assetType.capability?.name ?? "Not assigned"}
                          {assetType.capability?.code ? (
                            <div className="text-xs text-[var(--muted)]">
                              {assetType.capability.code}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge isActive={assetType.isActive} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {assetType.sortOrder ?? "-"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {assetType.templateCount ?? 0}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                          {assetType.assetCount ?? 0}
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditModal(assetType)}
                              disabled={!isAdmin || Boolean(actionAssetTypeId)}
                              className={rowActionButtonClassName}
                            >
                              <Pencil size={14} />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(assetType)}
                              disabled={!isAdmin || isActionRunning}
                              className={rowActionButtonClassName}
                            >
                              <Power size={14} />
                              {assetType.isActive ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!isLoading && filteredAssetTypes.length === 0 ? (
                <div className="border-t border-slate-100 px-5 py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                    <Layers2 size={20} />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-900">No asset types found</p>
                </div>
              ) : null}
            </div>

            <div className="border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
              Showing {filteredAssetTypes.length} of {assetTypes.length}
            </div>
          </section>
        </div>
      </main>

      {modalMode ? (
        <AssetTypeModal
          mode={modalMode}
          values={formValues}
          capabilities={capabilities}
          error={modalError}
          isSaving={isSaving}
          onChange={setFormValues}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      ) : null}
    </AppShell>
  );
}

export function AssetTypesClient() {
  return (
    <AuthGuard>
      <AssetTypesContent />
    </AuthGuard>
  );
}
