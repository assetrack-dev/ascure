"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, Power, RefreshCw, Search, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  deletePencawangCascade,
  deleteSubstation,
  fetchSubstationsForAdmin,
  previewDeletePencawang,
  updateSubstationStatus,
  type PencawangDeletePreview,
} from "@/lib/substations";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";
import type { ManagedSubstation } from "@/types/substations";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const selectClassName =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const rowActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const dangerActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function sortSubstations(substations: ManagedSubstation[]) {
  return [...substations].sort((left, right) =>
    left.name.localeCompare(right.name, "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
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
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-teal-600" : "bg-slate-400"}`}
      />
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function PencawangContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [substations, setSubstations] = useState<ManagedSubstation[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [cascadePreview, setCascadePreview] =
    useState<PencawangDeletePreview | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextSubstations = await fetchSubstationsForAdmin(token);
        setSubstations(sortSubstations(nextSubstations));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("ADMIN role is required to manage Pencawang.");
          return;
        }

        setError(requestErrorMessage(loadError, "Unable to load Pencawang."));
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
      setError("ADMIN role is required to manage Pencawang.");
      setIsLoading(false);
      return;
    }

    void loadData(storedSession.token);
  }, [loadData]);

  const filteredSubstations = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return substations.filter((substation) => {
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "ACTIVE" ? substation.isActive : !substation.isActive);
      const matchesSearch =
        !normalizedSearch ||
        [substation.name, substation.code, substation.location]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, substations]);

  const activeCount = useMemo(
    () => substations.filter((substation) => substation.isActive).length,
    [substations],
  );

  const handleToggleStatus = useCallback(
    async (substation: ManagedSubstation) => {
      const token = session?.token;
      if (!token) {
        return;
      }

      setActionId(substation.id);
      setError("");
      setNotice("");

      try {
        const updated = await updateSubstationStatus(
          token,
          substation.id,
          !substation.isActive,
        );
        setSubstations((current) =>
          sortSubstations(
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
        setNotice(
          `${updated.name} is now ${updated.isActive ? "active" : "inactive"}.`,
        );
      } catch (toggleError) {
        if (toggleError instanceof ApiError && toggleError.status === 401) {
          handleLogout();
          return;
        }

        setError(requestErrorMessage(toggleError, "Unable to update Pencawang."));
      } finally {
        setActionId(null);
      }
    },
    [handleLogout, session?.token],
  );

  // First click: empty Pencawang → straight to confirm; non-empty → preview the
  // cascade (and surface any block reason) before arming the confirm.
  const handleRequestDelete = useCallback(
    async (substation: ManagedSubstation) => {
      const token = session?.token;
      if (!token) {
        return;
      }
      setError("");
      setNotice("");

      const isEmpty =
        (substation.assetCount ?? 0) === 0 && (substation.visitCount ?? 0) === 0;
      if (isEmpty) {
        setCascadePreview(null);
        setConfirmDeleteId(substation.id);
        return;
      }

      setActionId(substation.id);
      try {
        const preview = await previewDeletePencawang(token, substation.id);
        if (preview.blocked) {
          setError(preview.blocked);
          setConfirmDeleteId(null);
          setCascadePreview(null);
          return;
        }
        setCascadePreview(preview);
        setConfirmDeleteId(substation.id);
      } catch (previewError) {
        if (previewError instanceof ApiError && previewError.status === 401) {
          handleLogout();
          return;
        }
        setError(
          requestErrorMessage(previewError, "Unable to preview the delete."),
        );
      } finally {
        setActionId(null);
      }
    },
    [handleLogout, session?.token],
  );

  const handleDelete = useCallback(
    async (substation: ManagedSubstation) => {
      const token = session?.token;
      if (!token) {
        return;
      }

      setActionId(substation.id);
      setError("");
      setNotice("");

      const isCascade = cascadePreview?.pencawangId === substation.id;
      try {
        if (isCascade) {
          await deletePencawangCascade(token, substation.id);
        } else {
          await deleteSubstation(token, substation.id);
        }
        setSubstations((current) =>
          current.filter((item) => item.id !== substation.id),
        );
        setNotice(`${substation.name} was deleted.`);
        setConfirmDeleteId(null);
        setCascadePreview(null);
      } catch (deleteError) {
        if (deleteError instanceof ApiError && deleteError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          requestErrorMessage(
            deleteError,
            "Unable to delete Pencawang.",
          ),
        );
      } finally {
        setActionId(null);
      }
    },
    [handleLogout, session?.token, cascadePreview],
  );

  // Force-cascade (non-empty Pencawang) is ADMIN or a MANAGER (server flag —
  // MANAGER collapses to VIEWER client-side; the API still scopes to own company).
  const canForceDelete =
    session?.user?.role === "ADMIN" || (session?.user?.canDeleteSurvey ?? false);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-[var(--brand)]">
            <Factory className="h-5 w-5" />
            <h1 className="text-xl font-bold text-slate-900">Pencawang</h1>
          </div>
          <p className="text-sm text-slate-600">
            Manage the Pencawang (substations) that appear in check-in and route
            pickers. Deactivate one to hide it everywhere without losing its
            history. An empty Pencawang can be deleted outright; a non-empty one
            can be cascade-deleted (all its visits, poles and feeders) by a
            manager or admin.
          </p>
          <p className="text-xs font-semibold text-slate-500">
            {activeCount} active &middot; {substations.length} total
          </p>
        </header>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">
            {notice}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className={searchControlClassName}
              placeholder="Search by name, code, or location"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            className={selectClassName}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[var(--shadow-soft)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3 text-right">Poles</th>
                <th className="px-4 py-3 text-right">Visits</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    Loading Pencawang...
                  </td>
                </tr>
              ) : filteredSubstations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No Pencawang match your filters.
                  </td>
                </tr>
              ) : (
                filteredSubstations.map((substation) => {
                  const poleCount = substation.assetCount ?? 0;
                  const visitCount = substation.visitCount ?? 0;
                  const isEmpty = poleCount === 0 && visitCount === 0;
                  const isBusy = actionId === substation.id;
                  const isConfirmingDelete = confirmDeleteId === substation.id;
                  const isCascadeConfirm =
                    cascadePreview?.pencawangId === substation.id;

                  return (
                    <tr key={substation.id} className="align-middle">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {substation.code}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{substation.name}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {substation.location || "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {poleCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {visitCount}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge isActive={substation.isActive} />
                      </td>
                      <td className="px-4 py-3">
                        {isConfirmingDelete ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs font-semibold text-rose-700">
                              {isCascadeConfirm
                                ? `Delete ${cascadePreview?.siteVisits ?? 0} visit(s) + ${cascadePreview?.assets ?? 0} pole(s)?`
                                : "Delete?"}
                            </span>
                            <button
                              type="button"
                              className={dangerActionButtonClassName}
                              disabled={isBusy}
                              onClick={() => void handleDelete(substation)}
                            >
                              {isBusy
                                ? "Deleting..."
                                : isCascadeConfirm
                                  ? "Yes, delete all"
                                  : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              className={rowActionButtonClassName}
                              disabled={isBusy}
                              onClick={() => {
                                setConfirmDeleteId(null);
                                setCascadePreview(null);
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className={rowActionButtonClassName}
                              disabled={isBusy}
                              onClick={() => void handleToggleStatus(substation)}
                            >
                              {substation.isActive ? (
                                <>
                                  <Power className="h-3.5 w-3.5" />
                                  Deactivate
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Reactivate
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              className={dangerActionButtonClassName}
                              disabled={isBusy || (!isEmpty && !canForceDelete)}
                              title={
                                isEmpty
                                  ? "Delete this empty Pencawang"
                                  : canForceDelete
                                    ? "Delete this Pencawang and everything under it"
                                    : "Has poles or visits — deactivate instead"
                              }
                              onClick={() => void handleRequestDelete(substation)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

export function PencawangClient() {
  return (
    <AuthGuard>
      <PencawangContent />
    </AuthGuard>
  );
}
