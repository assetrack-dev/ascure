"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Factory,
  MapPin,
  Pencil,
  Power,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  assignSubstationMainhead,
  deletePencawangCascade,
  deleteSubstation,
  fetchMainheadOptions,
  fetchSubstationsForAdmin,
  previewDeletePencawang,
  updateSubstationDetails,
  updateSubstationStatus,
  type MainheadOption,
  type PencawangDeletePreview,
} from "@/lib/substations";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";
import type { ManagedSubstation } from "@/types/substations";

// Client-side only — Google Maps cannot render during SSR.
const PencawangLocationPicker = dynamic(
  () => import("@/components/pencawang-location-picker"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Loading map...
      </div>
    ),
  },
);

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE";

const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const selectClassName =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const mainheadSelectClassName =
  "h-9 w-full max-w-[190px] rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const rowActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const dangerActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400";

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Blank → null; valid number in range → the number; anything else → undefined. */
function parseCoordinateInput(
  value: string,
  min: number,
  max: number,
): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
}

function formatCoordinate(value: number | null | undefined) {
  return typeof value === "number" ? value.toFixed(6) : "";
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
  const [mainheads, setMainheads] = useState<MainheadOption[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [mainheadActionId, setMainheadActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [cascadePreview, setCascadePreview] =
    useState<PencawangDeletePreview | null>(null);
  // Edit-details dialog. Coordinate inputs prefill with the EFFECTIVE position
  // (manual pin, else latest check-in) so a correction is a tweak, not a
  // retype; only fields the user actually changed are sent.
  const [editTarget, setEditTarget] = useState<ManagedSubstation | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    location: "",
    latitude: "",
    longitude: "",
  });
  const [editInitial, setEditInitial] = useState(editForm);
  const [editError, setEditError] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [mapLoadError, setMapLoadError] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const [nextSubstations, nextMainheads] = await Promise.all([
          fetchSubstationsForAdmin(token),
          // Best-effort: without the options the assign dropdown just falls back
          // to showing the current value, so a mainheads failure shouldn't block
          // the page.
          fetchMainheadOptions(token).catch(() => [] as MainheadOption[]),
        ]);
        setSubstations(sortSubstations(nextSubstations));
        setMainheads(nextMainheads);
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
        [
          substation.name,
          substation.code,
          substation.location,
          substation.mainhead?.name,
        ]
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

  const handleAssignMainhead = useCallback(
    async (substation: ManagedSubstation, rawMainheadId: string) => {
      const token = session?.token;
      if (!token) {
        return;
      }

      const nextMainheadId = rawMainheadId === "" ? null : rawMainheadId;
      if ((substation.mainheadId ?? null) === nextMainheadId) {
        return; // no change
      }

      setMainheadActionId(substation.id);
      setError("");
      setNotice("");

      try {
        const updated = await assignSubstationMainhead(
          token,
          substation.id,
          nextMainheadId,
        );
        setSubstations((current) =>
          sortSubstations(
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
        setNotice(
          updated.mainhead
            ? `${updated.name} is now under ${updated.mainhead.name}.`
            : `${updated.name} is now unassigned.`,
        );
      } catch (assignError) {
        if (assignError instanceof ApiError && assignError.status === 401) {
          handleLogout();
          return;
        }

        setError(requestErrorMessage(assignError, "Unable to assign the Mainhead."));
      } finally {
        setMainheadActionId(null);
      }
    },
    [handleLogout, session?.token],
  );

  // The picker's pin position — the form's coordinate strings, when valid.
  const editPosition = useMemo(() => {
    const lat = parseCoordinateInput(editForm.latitude, -90, 90);
    const lng = parseCoordinateInput(editForm.longitude, -180, 180);
    return typeof lat === "number" && typeof lng === "number"
      ? { lat, lng }
      : null;
  }, [editForm.latitude, editForm.longitude]);

  const handlePickLocation = useCallback((lat: number, lng: number) => {
    setEditForm((form) => ({
      ...form,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
    }));
  }, []);

  const handleOpenEdit = useCallback((substation: ManagedSubstation) => {
    const form = {
      name: substation.name ?? "",
      location: substation.location ?? "",
      latitude: formatCoordinate(substation.effectiveLatitude),
      longitude: formatCoordinate(substation.effectiveLongitude),
    };
    setEditForm(form);
    setEditInitial(form);
    setEditError("");
    setEditTarget(substation);
  }, []);

  const handleCloseEdit = useCallback(() => {
    if (isSavingEdit) {
      return;
    }
    setEditTarget(null);
    setEditError("");
  }, [isSavingEdit]);

  const handleSaveEdit = useCallback(async () => {
    const token = session?.token;
    if (!token || !editTarget) {
      return;
    }

    const payload: {
      name?: string;
      location?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } = {};

    const nextName = editForm.name.trim();
    if (nextName !== editInitial.name.trim()) {
      if (!nextName) {
        setEditError("The Pencawang name cannot be empty.");
        return;
      }
      payload.name = nextName;
    }

    const nextLocation = editForm.location.trim();
    if (nextLocation !== editInitial.location.trim()) {
      payload.location = nextLocation || null;
    }

    const coordinatesTouched =
      editForm.latitude.trim() !== editInitial.latitude.trim() ||
      editForm.longitude.trim() !== editInitial.longitude.trim();
    if (coordinatesTouched) {
      const latitude = parseCoordinateInput(editForm.latitude, -90, 90);
      const longitude = parseCoordinateInput(editForm.longitude, -180, 180);
      if (latitude === undefined || longitude === undefined) {
        setEditError(
          "Coordinates must be numbers: latitude -90 to 90, longitude -180 to 180.",
        );
        return;
      }
      if ((latitude === null) !== (longitude === null)) {
        setEditError("Enter both latitude and longitude, or clear both.");
        return;
      }
      if (latitude === null && longitude === null) {
        // Both cleared: with a manual pin this reverts to check-in-derived;
        // without one there is nothing to clear server-side.
        if (editTarget.locationSource === "MANUAL") {
          payload.latitude = null;
          payload.longitude = null;
        }
      } else {
        payload.latitude = latitude;
        payload.longitude = longitude;
      }
    }

    if (Object.keys(payload).length === 0) {
      handleCloseEdit();
      return;
    }

    setIsSavingEdit(true);
    setEditError("");
    setError("");
    setNotice("");

    try {
      const updated = await updateSubstationDetails(token, editTarget.id, payload);
      setSubstations((current) =>
        sortSubstations(
          current.map((item) => (item.id === updated.id ? updated : item)),
        ),
      );
      setNotice(
        payload.latitude !== undefined && payload.latitude !== null
          ? `${updated.name} updated — its map location is now pinned manually.`
          : payload.latitude === null
            ? `${updated.name} updated — its map location follows check-ins again.`
            : `${updated.name} updated.`,
      );
      setEditTarget(null);
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 401) {
        handleLogout();
        return;
      }
      setEditError(requestErrorMessage(saveError, "Unable to update Pencawang."));
    } finally {
      setIsSavingEdit(false);
    }
  }, [
    editForm,
    editInitial,
    editTarget,
    handleCloseEdit,
    handleLogout,
    session?.token,
  ]);

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

      // Always preview before confirming. The list only carries pole/visit
      // counts, but a Pencawang can also be pinned by FEEDERS or route From/To
      // links — the preview counts all of those (and surfaces any hard block),
      // so we never mis-route a cascadable Pencawang to the plain delete (409).
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
              placeholder="Search by name, code, location, or Mainhead"
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
                <th className="px-4 py-3">Mainhead</th>
                <th className="px-4 py-3 text-right">Poles</th>
                <th className="px-4 py-3 text-right">Visits</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    Loading Pencawang...
                  </td>
                </tr>
              ) : filteredSubstations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
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
                  const cascadeTotal =
                    (cascadePreview?.assets ?? 0) +
                    (cascadePreview?.siteVisits ?? 0) +
                    (cascadePreview?.feeders ?? 0);
                  const cascadeLabel =
                    cascadeTotal > 0
                      ? `Delete ${cascadePreview?.assets ?? 0} pole(s) + ${cascadePreview?.siteVisits ?? 0} visit(s) + ${cascadePreview?.feeders ?? 0} feeder(s)?`
                      : "Delete this Pencawang?";

                  return (
                    <tr key={substation.id} className="align-middle">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {substation.code}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{substation.name}</td>
                      <td className="px-4 py-3 text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                          {substation.locationSource === "MANUAL" ? (
                            <MapPin
                              className="h-3.5 w-3.5 shrink-0 text-teal-600"
                              aria-label="Map location pinned manually"
                            />
                          ) : null}
                          {substation.location || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className={mainheadSelectClassName}
                          value={substation.mainheadId ?? ""}
                          disabled={isBusy || mainheadActionId === substation.id}
                          aria-label={`Mainhead for ${substation.name}`}
                          title={
                            substation.mainheadId
                              ? "Change this Pencawang's Mainhead"
                              : "Unassigned — pick a Mainhead so it groups on the map"
                          }
                          onChange={(event) =>
                            void handleAssignMainhead(substation, event.target.value)
                          }
                        >
                          <option value="">— Unassigned —</option>
                          {/* A current mainhead that isn't in the fetched options
                              (e.g. inactive) still renders so the value shows. */}
                          {substation.mainhead &&
                          !mainheads.some((m) => m.id === substation.mainheadId) ? (
                            <option value={substation.mainhead.id}>
                              {substation.mainhead.name}
                            </option>
                          ) : null}
                          {mainheads.map((mainhead) => (
                            <option key={mainhead.id} value={mainhead.id}>
                              {mainhead.name}
                            </option>
                          ))}
                        </select>
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
                              {isCascadeConfirm ? cascadeLabel : "Delete?"}
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
                              title="Edit name, functional location, or map location"
                              onClick={() => handleOpenEdit(substation)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </button>
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

        {editTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editTarget.name}`}
          >
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Edit Pencawang
                  </h2>
                  <p className="text-xs font-semibold text-slate-500">
                    {editTarget.code}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseEdit}
                  disabled={isSavingEdit}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:text-slate-300"
                  aria-label="Close edit dialog"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="space-y-4 px-5 py-5">
                {editError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                    {editError}
                  </div>
                ) : null}

                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Name</span>
                  <input
                    className={`mt-1 ${searchControlClassName} pl-3`}
                    value={editForm.name}
                    disabled={isSavingEdit}
                    onChange={(event) =>
                      setEditForm((form) => ({ ...form, name: event.target.value }))
                    }
                  />
                </label>

                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">
                    Functional location
                  </span>
                  {/* TNB's identifier for the Pencawang — an ID, not an address. */}
                  <input
                    className={`mt-1 ${searchControlClassName} pl-3`}
                    value={editForm.location}
                    disabled={isSavingEdit}
                    placeholder="e.g. CKTN/PCE/J01685"
                    onChange={(event) =>
                      setEditForm((form) => ({
                        ...form,
                        location: event.target.value,
                      }))
                    }
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    The TNB functional-location ID for this Pencawang.
                  </span>
                </label>

                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-700">
                      Map location
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {editTarget.locationSource === "MANUAL"
                        ? `Pinned manually${
                            editTarget.locationSetAt
                              ? ` on ${new Date(
                                  editTarget.locationSetAt,
                                ).toLocaleDateString()}`
                              : ""
                          }${
                            editTarget.locationSetByEmail
                              ? ` by ${editTarget.locationSetByEmail}`
                              : ""
                          }`
                        : editTarget.locationSource === "CHECK_IN"
                          ? "From the latest check-in GPS"
                          : "No location yet (never visited)"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Crews check in AT the Pencawang, so its map position follows
                    the latest check-in. Save corrected coordinates to pin it —
                    a pin wins over every future check-in. Clear both fields to
                    follow check-ins again.
                  </p>
                  {GOOGLE_MAPS_API_KEY && !mapLoadError ? (
                    <>
                      <div className="mt-3 h-72 overflow-hidden rounded-md border border-slate-200">
                        <PencawangLocationPicker
                          apiKey={GOOGLE_MAPS_API_KEY}
                          position={editPosition}
                          onPick={handlePickLocation}
                          onLoadError={() => setMapLoadError(true)}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Click the satellite map (or drag the pin) to place the
                        Pencawang — the coordinates below follow.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      Map picker unavailable — enter the coordinates manually
                      (right-click the spot in Google Maps to copy them).
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block text-sm">
                      <span className="font-semibold text-slate-700">Latitude</span>
                      <input
                        className={`mt-1 ${searchControlClassName} pl-3`}
                        value={editForm.latitude}
                        disabled={isSavingEdit}
                        placeholder="e.g. 5.483033"
                        inputMode="decimal"
                        onChange={(event) =>
                          setEditForm((form) => ({
                            ...form,
                            latitude: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-semibold text-slate-700">Longitude</span>
                      <input
                        className={`mt-1 ${searchControlClassName} pl-3`}
                        value={editForm.longitude}
                        disabled={isSavingEdit}
                        placeholder="e.g. 101.125401"
                        inputMode="decimal"
                        onChange={(event) =>
                          setEditForm((form) => ({
                            ...form,
                            longitude: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  {(() => {
                    const latitude = parseCoordinateInput(editForm.latitude, -90, 90);
                    const longitude = parseCoordinateInput(
                      editForm.longitude,
                      -180,
                      180,
                    );
                    if (typeof latitude !== "number" || typeof longitude !== "number") {
                      return null;
                    }
                    return (
                      <a
                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)] hover:underline"
                        href={`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Verify these coordinates in Google Maps
                      </a>
                    );
                  })()}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={handleCloseEdit}
                    disabled={isSavingEdit}
                    className={rowActionButtonClassName}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveEdit()}
                    disabled={isSavingEdit}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-xs font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isSavingEdit ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
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
