"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileText,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  Chip,
  FilterBar,
  PageHeader,
  Tbtn,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  downloadBulkChecklist,
  downloadPencawangList,
  downloadPencawangTemplateMasterlist,
  downloadSavtRouteChecklist,
  downloadSavtRouteList,
  fetchReportSubstations,
  fetchSavtRoutes,
} from "@/lib/reports";
import { downloadCompiledReport } from "@/lib/report-templates";
import type { AuthSession } from "@/types/auth";
import type { ReportSavtRoute, ReportSubstation } from "@/types/reports";
import { DISPLAY_STATUS_LABELS, type DisplayStatus } from "@/types/site-visits";

// Compact 32px row button — the table's per-row actions. Tbtn is 38px, too tall
// for a dense row, so this is the one token-styled control the primitives don't
// cover.
const rowButtonClassName =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[7px] border border-[var(--line)] bg-[var(--panel)] px-2.5 text-[12px] font-semibold text-[var(--foreground-soft)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-50";

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

// Same mapping as Site Visits, so a survey reads identically on both pages.
const DISPLAY_STATUS_TONE: Record<DisplayStatus, Tone> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  NEEDS_AMENDMENT: "warning",
  IN_REVIEW: "brand",
  COMPLETED: "success",
  ARCHIVED: "neutral",
  CANCELLED: "neutral",
};

// Default keeps the API's order (SAVR = name A–Z, SAVT = route code). The date
// sorts answer "which survey started / completed first or last"; rows without
// that date always sink to the bottom so they never pose as the oldest.
type DateField = "surveyStartedAt" | "surveyCompletedAt";
type SortOrder =
  | "DEFAULT"
  | "STARTED_DESC"
  | "STARTED_ASC"
  | "COMPLETED_DESC"
  | "COMPLETED_ASC";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "DEFAULT", label: "Sort: Name" },
  { value: "STARTED_DESC", label: "Started: latest first" },
  { value: "STARTED_ASC", label: "Started: earliest first" },
  { value: "COMPLETED_DESC", label: "Completed: latest first" },
  { value: "COMPLETED_ASC", label: "Completed: earliest first" },
];

const SORT_SPEC: Record<
  Exclude<SortOrder, "DEFAULT">,
  { field: DateField; direction: 1 | -1 }
> = {
  STARTED_DESC: { field: "surveyStartedAt", direction: -1 },
  STARTED_ASC: { field: "surveyStartedAt", direction: 1 },
  COMPLETED_DESC: { field: "surveyCompletedAt", direction: -1 },
  COMPLETED_ASC: { field: "surveyCompletedAt", direction: 1 },
};

type DatedRow = Record<DateField, string | null>;

function dateTime(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function sortByDate<T extends DatedRow>(rows: T[], order: SortOrder): T[] {
  if (order === "DEFAULT") return rows;
  const { field, direction } = SORT_SPEC[order];
  // Array.prototype.sort is stable, so equal dates keep the API's name order.
  return [...rows].sort((a, b) => {
    const at = dateTime(a[field]);
    const bt = dateTime(b[field]);
    if (at === null || bt === null) {
      return at === bt ? 0 : at === null ? 1 : -1;
    }
    return (at - bt) * direction;
  });
}

// Field dates read in Malaysia time regardless of the viewer's browser zone.
const MYT = "Asia/Kuala_Lumpur";
const displayDateFormat = new Intl.DateTimeFormat("en-MY", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: MYT,
});
// en-CA formats as YYYY-MM-DD — the same shape <input type="date"> yields, so
// the range filter compares plain strings on the MYT calendar day.
const isoDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: MYT });

/** True when the survey started within [from, to] (MYT days, both inclusive). */
function startedWithin(value: string | null, from: string, to: string) {
  if (!from && !to) return true;
  const time = dateTime(value);
  if (time === null) return false;
  const day = isoDayFormat.format(time);
  return (!from || day >= from) && (!to || day <= to);
}

function DateCell({ value }: { value: string | null }) {
  const time = dateTime(value);
  if (time === null) {
    return <span className="text-[12px] text-[var(--muted-2)]">—</span>;
  }
  return (
    <span className="whitespace-nowrap text-[12.5px] font-medium text-[var(--foreground-soft)]">
      {displayDateFormat.format(time)}
    </span>
  );
}

/** Clickable date header: cycles latest first → earliest first → name order. */
function SortableDateHeader({
  label,
  desc,
  asc,
  sortOrder,
  onSort,
}: {
  label: string;
  desc: SortOrder;
  asc: SortOrder;
  sortOrder: SortOrder;
  onSort: (next: SortOrder) => void;
}) {
  const next = sortOrder === desc ? asc : sortOrder === asc ? "DEFAULT" : desc;
  return (
    <th
      className={tableHeadCellClass}
      aria-sort={sortOrder === asc ? "ascending" : sortOrder === desc ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(next)}
        title={`Sort by survey ${label.toLowerCase()} date`}
        className="inline-flex items-center gap-1 uppercase tracking-[inherit] transition hover:text-[var(--foreground)]"
      >
        {label}
        {sortOrder === asc ? (
          <ArrowUp size={12} />
        ) : sortOrder === desc ? (
          <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} className="opacity-50" />
        )}
      </button>
    </th>
  );
}

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
    return <span className="text-[12px] text-[var(--muted-2)]">No survey</span>;
  }
  return <Chip tone={DISPLAY_STATUS_TONE[status]}>{label ?? DISPLAY_STATUS_LABELS[status]}</Chip>;
}

function CoordCell({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}) {
  if (latitude == null || longitude == null) {
    return <span className="text-[12px] text-[var(--muted-2)]">—</span>;
  }
  const text = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  return (
    <a
      href={`https://www.google.com/maps?q=${latitude},${longitude}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[12px] font-medium text-[var(--foreground-soft)] transition hover:text-[var(--brand)]"
      title="Open in Google Maps"
    >
      <MapPin size={13} className="shrink-0 text-[var(--muted-2)]" />
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
  const [sortOrder, setSortOrder] = useState<SortOrder>("DEFAULT");
  // "Started between" range (YYYY-MM-DD, MYT days); blank = open-ended.
  const [startedFrom, setStartedFrom] = useState("");
  const [startedTo, setStartedTo] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [isListDownloading, setIsListDownloading] = useState(false);
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

  // Selection is per-scope (Pencawang ids vs route codes) — clear it on a
  // switch, along with the Mainhead filter (the option sets differ per scope).
  useEffect(() => {
    setSelectedKeys(new Set());
    setMainhead("ALL");
    setNotice("");
  }, [scope]);

  // Scope-aware: SAVR draws from the Pencawang list, SAVT from the routes
  // (a route's Mainhead = its most recent visit's).
  const mainheadOptions = useMemo(() => {
    const values = isSavt
      ? routes.map((route) => route.mainhead?.trim())
      : substations.map((substation) => substation.mainhead?.trim());
    return Array.from(
      new Set(values.filter((value): value is string => Boolean(value))),
    ).sort((a, b) => a.localeCompare(b));
  }, [isSavt, routes, substations]);

  const filteredSubstations = useMemo(() => {
    const matching = substations.filter((substation) => {
      const matchesStatus = status === "ALL" || substation.displayStatus === status;
      const matchesMainhead = mainhead === "ALL" || substation.mainhead === mainhead;
      return (
        matchesStatus &&
        matchesMainhead &&
        startedWithin(substation.surveyStartedAt, startedFrom, startedTo)
      );
    });
    return sortByDate(matching, sortOrder);
  }, [substations, status, mainhead, startedFrom, startedTo, sortOrder]);

  const filteredRoutes = useMemo(() => {
    const matching = routes.filter((route) => {
      const matchesStatus = status === "ALL" || route.displayStatus === status;
      const matchesMainhead = mainhead === "ALL" || route.mainhead === mainhead;
      return (
        matchesStatus &&
        matchesMainhead &&
        startedWithin(route.surveyStartedAt, startedFrom, startedTo)
      );
    });
    return sortByDate(matching, sortOrder);
  }, [routes, status, mainhead, startedFrom, startedTo, sortOrder]);

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
    setSelectedKeys(() => (allVisibleSelected ? new Set() : new Set(visibleKeys)));
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

  // DC master reference as .xlsx — scope-aware: the SAVR view downloads the
  // Pencawang list, the SAVT view the Route list (KOD TIANG + From/To + pole
  // count per route). With rows ticked, only the selection is exported;
  // otherwise EVERY accessible row — independent of the on-screen filters.
  const listSelection = selectedKeys.size > 0 ? [...selectedKeys] : undefined;
  const listNoun = isSavt ? "route" : "Pencawang";
  const listLabel = isSavt ? "Route list" : "Pencawang list";

  async function handleDownloadPencawangList() {
    if (!session?.token || isListDownloading) {
      return;
    }
    setIsListDownloading(true);
    setError("");
    setNotice("");
    try {
      if (isSavt) {
        await downloadSavtRouteList(session.token, listSelection);
      } else {
        await downloadPencawangList(session.token, listSelection);
      }
      setNotice(
        listSelection
          ? `${listLabel} downloaded for ${listSelection.length} selected ${listNoun}${
              listSelection.length === 1 ? "" : "s"
            }.`
          : `${listLabel} downloaded.`,
      );
    } catch (downloadError) {
      handleDownloadError(downloadError);
    } finally {
      setIsListDownloading(false);
    }
  }

  const rowCount = isSavt ? filteredRoutes.length : filteredSubstations.length;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Operational Reporting"
            title="Reports"
            subtitle={`Every surveyed ${
              isSavt ? "route (From → To)" : "Pencawang"
            } in one list — download the checklist (.xlsx, one pole per row, live checklist columns) per row, or tick several and download them as one merged sheet.`}
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadData(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          {error ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--success-text)]">
              {notice}
            </div>
          ) : null}

          <Card padded={false} className="mt-6">
            {/* Filters */}
            <div className="border-b border-[var(--line2)] p-[18px]">
              <FilterBar>
                <select
                  aria-label="Survey type"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as "SAVR" | "SAVT")}
                  className={filterSelectClass}
                >
                  <option value="SAVR">SAVR (by Pencawang)</option>
                  <option value="SAVT">SAVT (by route)</option>
                </select>

                <select
                  aria-label="Mainhead"
                  value={mainhead}
                  onChange={(event) => setMainhead(event.target.value)}
                  disabled={isLoading || mainheadOptions.length === 0}
                  className={filterSelectClass}
                >
                  <option value="ALL">All mainheads</option>
                  {mainheadOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className={filterSelectClass}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Sort"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                  className={filterSelectClass}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  aria-label="Started from"
                  title="Started on or after"
                  value={startedFrom}
                  max={startedTo || undefined}
                  onChange={(event) => setStartedFrom(event.target.value)}
                  className={filterSelectClass}
                />
                <input
                  type="date"
                  aria-label="Started to"
                  title="Started on or before"
                  value={startedTo}
                  min={startedFrom || undefined}
                  onChange={(event) => setStartedTo(event.target.value)}
                  className={filterSelectClass}
                />

                <div className="ml-auto flex items-center gap-3">
                  <span className="text-[12.5px] text-[var(--muted)]">
                    {isLoading
                      ? "Loading…"
                      : `${rowCount} ${isSavt ? "route" : "Pencawang"}${
                          rowCount === 1 ? "" : "s"
                        }${selectedKeys.size > 0 ? ` · ${selectedKeys.size} selected` : ""}`}
                  </span>
                  <Tbtn
                    variant="secondary"
                    onClick={handleDownloadPencawangList}
                    disabled={isListDownloading || isBulkDownloading || !!downloadingKey}
                    title={
                      isSavt
                        ? listSelection
                          ? `Download the ${listSelection.length} ticked routes (KOD TIANG, From/To Pencawang, Mainhead, lat/long, number of poles, survey date, status) as XLSX`
                          : "Download every route (KOD TIANG, From/To Pencawang, Mainhead, lat/long, number of poles, survey date, status) as XLSX"
                        : listSelection
                          ? `Download the ${listSelection.length} ticked Pencawang (ID, Nama, Functional Location, lat/long, poles, start/complete dates, days on site, team, status) as XLSX`
                          : "Download every Pencawang (ID, Nama, Functional Location, lat/long, poles, start/complete dates, days on site, team, status) as XLSX — blank lat/long = never visited"
                    }
                  >
                    <Download size={16} />
                    {isListDownloading
                      ? "Preparing…"
                      : `${listLabel}${
                          listSelection ? ` (${listSelection.length})` : ""
                        }`}
                  </Tbtn>
                  <Tbtn
                    variant="primary"
                    onClick={handleBulkDownload}
                    disabled={selectedKeys.size === 0 || isBulkDownloading || !!downloadingKey}
                  >
                    <Download size={16} />
                    {isBulkDownloading
                      ? "Generating…"
                      : `Download selected${selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}`}
                  </Tbtn>
                </div>
              </FilterBar>
            </div>

            {/* List */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-left">
                <thead>
                  <tr className={`${tableHeadClass} border-b border-[var(--line2)]`}>
                    <th className="w-10 px-3.5 py-2.5">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        disabled={visibleKeys.length === 0}
                        aria-label="Select all"
                        className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                      />
                    </th>
                    <th className={tableHeadCellClass}>
                      {isSavt ? "Route (From → To)" : "Nama Pencawang"}
                    </th>
                    <th className={tableHeadCellClass}>Lokasi Pencawang</th>
                    <SortableDateHeader
                      label="Started"
                      desc="STARTED_DESC"
                      asc="STARTED_ASC"
                      sortOrder={sortOrder}
                      onSort={setSortOrder}
                    />
                    <SortableDateHeader
                      label="Completed"
                      desc="COMPLETED_DESC"
                      asc="COMPLETED_ASC"
                      sortOrder={sortOrder}
                      onSort={setSortOrder}
                    />
                    <th className={tableHeadCellClass}>Status</th>
                    <th className={`${tableHeadCellClass} text-right`}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-10 text-center text-[13px] text-[var(--muted)]">
                        Loading…
                      </td>
                    </tr>
                  ) : rowCount === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3.5 py-10 text-center text-[13px] text-[var(--muted)]">
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
                        <tr
                          key={route.routeCode}
                          className={`${tableRowClass} ${selected ? "bg-[var(--brand-tint)]" : ""}`}
                        >
                          <td className="px-3.5 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOne(route.routeCode)}
                              aria-label={`Select ${route.routeCode}`}
                              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                            />
                          </td>
                          <td className={tableCellClass}>
                            <div className="font-semibold text-[var(--foreground)]">
                              {route.routeCode}
                            </div>
                            <div className="text-[12px] text-[var(--muted)]">
                              {(route.fromName || "?") + " → " + (route.toName || "?")} ·{" "}
                              {route.poleCount} pole{route.poleCount === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className={tableCellClass}>
                            <CoordCell latitude={route.latitude} longitude={route.longitude} />
                          </td>
                          <td className={tableCellClass}>
                            <DateCell value={route.surveyStartedAt} />
                          </td>
                          <td className={tableCellClass}>
                            <DateCell value={route.surveyCompletedAt} />
                          </td>
                          <td className={tableCellClass}>
                            <StatusPill
                              status={route.displayStatus}
                              label={route.displayStatusLabel}
                            />
                          </td>
                          <td className={`${tableCellClass} text-right`}>
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
                        <tr
                          key={substation.id}
                          className={`${tableRowClass} ${selected ? "bg-[var(--brand-tint)]" : ""}`}
                        >
                          <td className="px-3.5 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOne(substation.id)}
                              aria-label={`Select ${substation.name}`}
                              className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                            />
                          </td>
                          <td className={tableCellClass}>
                            <div className="font-semibold text-[var(--foreground)]">
                              {substation.name}
                            </div>
                            <div className="font-mono text-[12px] text-[var(--muted)]">
                              {substation.code}
                              {substation.mainhead ? ` · ${substation.mainhead}` : ""}
                            </div>
                          </td>
                          <td className={tableCellClass}>
                            <CoordCell
                              latitude={substation.latitude}
                              longitude={substation.longitude}
                            />
                          </td>
                          <td className={tableCellClass}>
                            <DateCell value={substation.surveyStartedAt} />
                          </td>
                          <td className={tableCellClass}>
                            <DateCell value={substation.surveyCompletedAt} />
                          </td>
                          <td className={tableCellClass}>
                            <StatusPill
                              status={substation.displayStatus}
                              label={substation.displayStatusLabel}
                            />
                          </td>
                          <td className={`${tableCellClass} text-right`}>
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
          </Card>
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
