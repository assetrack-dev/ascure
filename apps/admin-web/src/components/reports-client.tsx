"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, MapPin, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  downloadBulkChecklist,
  downloadPencawangTemplateMasterlist,
  downloadSavtRouteChecklist,
  fetchReportSubstations,
  fetchSavtRoutes,
} from "@/lib/reports";
import { downloadCompiledReport } from "@/lib/report-templates";
import type { AuthSession } from "@/types/auth";
import type { ReportSavtRoute, ReportSubstation } from "@/types/reports";
import { DISPLAY_STATUS_LABELS, type DisplayStatus } from "@/types/site-visits";

const primaryButtonClassName =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const rowButtonClassName =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50";
const selectClassName =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";

// Status filter follows the unified display-status vocabulary (matches Site Visits).
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "NEEDS_AMENDMENT", label: "Needs Amendment" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "COMPLETED", label: "Completed" },
  { value: "ARCHIVED", label: "Archived" },
  { value: "CANCELLED", label: "Cancelled" },
];

const DISPLAY_STATUS_TONE: Record<DisplayStatus, string> = {
  NOT_STARTED: "border-slate-200 bg-slate-50 text-slate-600",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  NEEDS_AMENDMENT: "border-amber-200 bg-amber-50 text-amber-800",
  IN_REVIEW: "border-sky-200 bg-sky-50 text-sky-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ARCHIVED: "border-slate-200 bg-slate-100 text-slate-600",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-500",
};

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function StatusPill({
  status,
  label,
}: {
  status: DisplayStatus | null;
  label: string | null;
}) {
  if (!status) {
    return <span className="text-xs text-slate-400">No survey</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${DISPLAY_STATUS_TONE[status]}`}
    >
      {label ?? DISPLAY_STATUS_LABELS[status]}
    </span>
  );
}

function CoordCell({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  if (latitude == null || longitude == null) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const text = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  return (
    <a
      href={`https://www.google.com/maps?q=${latitude},${longitude}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-[var(--brand)]"
      title="Open in Google Maps"
    >
      <MapPin size={13} className="shrink-0 text-slate-400" />
      {text}
    </a>
  );
}

function ReportsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [substations, setSubstations] = useState<ReportSubstation[]>([]);
  const [routes, setRoutes] = useState<ReportSavtRoute[]>([]);
  const [scope, setScope] = useState<"SAVR" | "SAVT">("SAVR");
  const [mainhead, setMainhead] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isSavt = scope === "SAVT";

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        const [refreshedUser, nextSubstations, nextRoutes] = await Promise.all([
          refreshStoredSessionUser(token).catch(() => null),
          fetchReportSubstations(token),
          fetchSavtRoutes(token).catch(() => []),
        ]);
        if (refreshedUser) {
          setSession({ token, user: refreshedUser });
        }
        setSubstations(nextSubstations);
        setRoutes(nextRoutes);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("The REPORTING capability is required to access reports.");
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load the Pencawang list."));
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
    void loadData(storedSession.token);
  }, [loadData]);

  // Selection is per-scope (Pencawang ids vs route codes) — clear it on a switch.
  useEffect(() => {
    setSelectedKeys(new Set());
    setNotice("");
  }, [scope]);

  const mainheadOptions = useMemo(
    () =>
      Array.from(
        new Set(
          substations
            .map((substation) => substation.mainhead?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [substations],
  );

  const filteredSubstations = useMemo(() => {
    return substations.filter((substation) => {
      const matchesStatus = status === "ALL" || substation.displayStatus === status;
      const matchesMainhead = mainhead === "ALL" || substation.mainhead === mainhead;
      return matchesStatus && matchesMainhead;
    });
  }, [substations, status, mainhead]);

  const filteredRoutes = useMemo(() => {
    return routes.filter(
      (route) => status === "ALL" || route.displayStatus === status,
    );
  }, [routes, status]);

  // Keys currently shown (for select-all + bulk).
  const visibleKeys = useMemo(
    () =>
      isSavt
        ? filteredRoutes.map((route) => route.routeCode)
        : filteredSubstations.map((substation) => substation.id),
    [isSavt, filteredRoutes, filteredSubstations],
  );

  // Drop any selection that the current filter no longer shows.
  useEffect(() => {
    setSelectedKeys((previous) => {
      const allowed = new Set(visibleKeys);
      const next = new Set([...previous].filter((key) => allowed.has(key)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleKeys]);

  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  function toggleSelectAll() {
    setSelectedKeys((previous) =>
      allVisibleSelected ? new Set() : new Set(visibleKeys),
    );
  }

  function toggleOne(key: string) {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleDownloadError(
    downloadError: unknown,
    notFoundMessage = "That item could not be found.",
  ) {
    if (downloadError instanceof ApiError && downloadError.status === 401) {
      handleLogout();
      return;
    }
    if (downloadError instanceof ApiError && downloadError.status === 403) {
      setError("The REPORTING capability is required to download reports.");
      return;
    }
    if (downloadError instanceof ApiError && downloadError.status === 404) {
      setError(notFoundMessage);
      return;
    }
    setError(requestErrorMessage(downloadError, "Unable to generate the Excel report."));
  }

  /**
   * Download the frozen visual report PDF of the newest visit that has one.
   * `downloadingKey` is namespaced (`pdf:` / `xlsx:`) so the two buttons in a row
   * don't both show a spinner.
   */
  async function handleVisualReportDownload(
    key: string,
    reportVisitId: string | null,
    label: string,
  ) {
    if (!session?.token || downloadingKey || isBulkDownloading || !reportVisitId) {
      return;
    }
    setDownloadingKey(`pdf:${key}`);
    setError("");
    setNotice("");
    try {
      await downloadCompiledReport(session.token, {
        id: reportVisitId,
        pencawangCode: label,
      });
      setNotice(`Visual report downloaded for ${label}.`);
    } catch (downloadError) {
      handleDownloadError(
        downloadError,
        "No visual report has been compiled for this survey yet.",
      );
    } finally {
      setDownloadingKey(null);
    }
  }

  async function handleRowDownload(key: string) {
    if (!session?.token || downloadingKey || isBulkDownloading) {
      return;
    }
    setDownloadingKey(`xlsx:${key}`);
    setError("");
    setNotice("");
    try {
      if (isSavt) {
        const route = routes.find((item) => item.routeCode === key);
        if (route) {
          // The list filter is for finding/selecting; the download returns the
          // route's full checklist (latest inspection per pole).
          await downloadSavtRouteChecklist(session.token, route);
          setNotice(`Checklist generated for route ${route.routeCode}.`);
        }
      } else {
        const substation = substations.find((item) => item.id === key);
        if (substation) {
          await downloadPencawangTemplateMasterlist(
            session.token,
            substation,
            undefined,
            "SAVR",
          );
          setNotice(
            `Checklist generated for ${substation.code} - ${substation.name}.`,
          );
        }
      }
    } catch (downloadError) {
      handleDownloadError(downloadError);
    } finally {
      setDownloadingKey(null);
    }
  }

  async function handleBulkDownload() {
    if (!session?.token || selectedKeys.size === 0 || isBulkDownloading) {
      return;
    }
    setIsBulkDownloading(true);
    setError("");
    setNotice("");
    try {
      await downloadBulkChecklist(session.token, {
        scope,
        mainhead: isSavt ? undefined : mainhead,
        ids: [...selectedKeys],
      });
      const noun = isSavt ? "route" : "Pencawang";
      setNotice(
        `Checklist generated for ${selectedKeys.size} selected ${noun}${
          selectedKeys.size === 1 ? "" : "s"
        }.`,
      );
    } catch (downloadError) {
      handleDownloadError(downloadError);
    } finally {
      setIsBulkDownloading(false);
    }
  }

  const rowCount = isSavt ? filteredRoutes.length : filteredSubstations.length;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operational Reporting
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Reports</h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Every surveyed {isSavt ? "route (From → To)" : "Pencawang"} in one list —
                download the checklist (.xlsx, one pole per row, live checklist columns) per
                row, or tick several and download them as one merged sheet.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (session?.token ? loadData(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {notice}
            </div>
          ) : null}

          {/* Filters */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Survey type</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as "SAVR" | "SAVT")}
                className={`${selectClassName} mt-1.5`}
              >
                <option value="SAVR">SAVR (by Pencawang)</option>
                <option value="SAVT">SAVT (by route)</option>
              </select>
            </label>

            {!isSavt ? (
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Mainhead</span>
                <select
                  value={mainhead}
                  onChange={(event) => setMainhead(event.target.value)}
                  disabled={isLoading || mainheadOptions.length === 0}
                  className={`${selectClassName} mt-1.5`}
                >
                  <option value="ALL">All mainheads</option>
                  {mainheadOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className={`${selectClassName} mt-1.5`}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Bulk action bar */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--muted)]">
              {isLoading
                ? "Loading…"
                : `${rowCount} ${isSavt ? "route" : "Pencawang"}${
                    rowCount === 1 ? "" : "s"
                  }${selectedKeys.size > 0 ? ` · ${selectedKeys.size} selected` : ""}`}
            </p>
            <button
              type="button"
              onClick={handleBulkDownload}
              disabled={selectedKeys.size === 0 || isBulkDownloading || !!downloadingKey}
              className={primaryButtonClassName}
            >
              <Download size={16} />
              {isBulkDownloading
                ? "Generating…"
                : `Download selected${selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}`}
            </button>
          </div>

          {/* List */}
          <section className="mt-4 overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        disabled={visibleKeys.length === 0}
                        aria-label="Select all"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-3 font-semibold">
                      {isSavt ? "Route (From → To)" : "Nama Pencawang"}
                    </th>
                    <th className="px-3 py-3 font-semibold">Lokasi Pencawang</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 text-right font-semibold">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                        Loading…
                      </td>
                    </tr>
                  ) : rowCount === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                        No {isSavt ? "routes" : "Pencawang"} for this filter.
                      </td>
                    </tr>
                  ) : isSavt ? (
                    filteredRoutes.map((route) => {
                      const selected = selectedKeys.has(route.routeCode);
                      const downloading = downloadingKey === `xlsx:${route.routeCode}`;
                      const downloadingReport =
                        downloadingKey === `pdf:${route.routeCode}`;
                      return (
                        <tr key={route.routeCode} className={selected ? "bg-teal-50/40" : ""}>
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOne(route.routeCode)}
                              aria-label={`Select ${route.routeCode}`}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900">
                              {route.routeCode}
                            </div>
                            <div className="text-xs text-slate-500">
                              {(route.fromName || "?") + " → " + (route.toName || "?")} ·{" "}
                              {route.poleCount} pole{route.poleCount === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <CoordCell latitude={route.latitude} longitude={route.longitude} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill
                              status={route.displayStatus}
                              label={route.displayStatusLabel}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleRowDownload(route.routeCode)}
                                disabled={!!downloadingKey || isBulkDownloading}
                                className={rowButtonClassName}
                              >
                                {downloading ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <Download size={13} />
                                )}
                                {downloading ? "…" : "Download"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleVisualReportDownload(
                                    route.routeCode,
                                    route.reportVisitId,
                                    route.routeCode,
                                  )
                                }
                                disabled={
                                  !route.hasReport || !!downloadingKey || isBulkDownloading
                                }
                                title={
                                  route.hasReport
                                    ? "Download the latest compiled visual report (PDF)"
                                    : "No visual report yet — available once the survey reaches Laporan Selesai"
                                }
                                className={rowButtonClassName}
                              >
                                {downloadingReport ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <FileText size={13} />
                                )}
                                {downloadingReport ? "…" : "Report"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    filteredSubstations.map((substation) => {
                      const selected = selectedKeys.has(substation.id);
                      const downloading = downloadingKey === `xlsx:${substation.id}`;
                      const downloadingReport = downloadingKey === `pdf:${substation.id}`;
                      return (
                        <tr key={substation.id} className={selected ? "bg-teal-50/40" : ""}>
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOne(substation.id)}
                              aria-label={`Select ${substation.name}`}
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900">
                              {substation.name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {substation.code}
                              {substation.mainhead ? ` · ${substation.mainhead}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <CoordCell
                              latitude={substation.latitude}
                              longitude={substation.longitude}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusPill
                              status={substation.displayStatus}
                              label={substation.displayStatusLabel}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleRowDownload(substation.id)}
                                disabled={!!downloadingKey || isBulkDownloading}
                                className={rowButtonClassName}
                              >
                                {downloading ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <Download size={13} />
                                )}
                                {downloading ? "…" : "Download"}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleVisualReportDownload(
                                    substation.id,
                                    substation.reportVisitId,
                                    substation.code,
                                  )
                                }
                                disabled={
                                  !substation.hasReport ||
                                  !!downloadingKey ||
                                  isBulkDownloading
                                }
                                title={
                                  substation.hasReport
                                    ? "Download the latest compiled visual report (PDF)"
                                    : "No visual report yet — available once the survey reaches Laporan Selesai"
                                }
                                className={rowButtonClassName}
                              >
                                {downloadingReport ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <FileText size={13} />
                                )}
                                {downloadingReport ? "…" : "Report"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export function ReportsClient() {
  return (
    <AuthGuard>
      <ReportsContent />
    </AuthGuard>
  );
}
