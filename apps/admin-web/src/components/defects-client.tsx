"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchDefects } from "@/lib/defects";
import type { AuthSession } from "@/types/auth";
import type {
  DefectListItem,
  DefectLifecycleStatus,
  DefectResolutionOutcome,
  DefectSeverity,
  DefectStatus,
  DefectWorkflowStatus,
  MaintenanceCategory,
} from "@/types/defects";

type SortKey =
  | "assetCode"
  | "defectType"
  | "severity"
  | "status"
  | "lifecycleStatus"
  | "assignedTo"
  | "date"
  | "dueDate"
  | "location";
type SortDirection = "asc" | "desc";
type SeverityFilter = "ALL" | DefectSeverity;
type StatusFilter = "ALL" | DefectWorkflowStatus;
type AssignedUserFilter = "ALL" | "UNASSIGNED" | string;
type PencawangFilter = "ALL" | string;
type CategoryFilter = "ALL" | MaintenanceCategory;

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const SEVERITY_OPTIONS: Array<{ label: string; value: SeverityFilter }> = [
  { label: "All severities", value: "ALL" },
  { label: "Critical", value: "CRITICAL" },
  { label: "High", value: "HIGH" },
  { label: "Medium", value: "MEDIUM" },
  { label: "Low", value: "LOW" },
];
const MAINTENANCE_CATEGORY_OPTIONS: Array<{ label: string; value: CategoryFilter }> = [
  { label: "All categories", value: "ALL" },
  { label: "Rentis", value: "RENTIS" },
  { label: "Cat Tiang", value: "CAT_TIANG" },
  { label: "Selenggaraan", value: "SELENGGARAAN" },
];
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Monitoring", value: "MONITORING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];
const SEVERITY_RANK: Record<DefectSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
const STATUS_RANK: Record<DefectStatus, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  MONITORING: 2,
  RESOLVED: 3,
  CLOSED: 4,
  UNKNOWN: 5,
};
const LIFECYCLE_RANK: Record<DefectLifecycleStatus, number> = {
  DETECTED: 0,
  UNDER_REVIEW: 1,
  VERIFIED: 2,
  ASSIGNED: 3,
  IN_PROGRESS: 4,
  COMPLETED: 5,
  VERIFICATION_PENDING: 6,
  CLOSED: 7,
  REJECTED: 8,
  UNKNOWN: 9,
};
const filterControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]";
const paginationButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function DefectsLoading() {
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

function formatStatus(status: DefectStatus) {
  if (status === "UNKNOWN") {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEnumLabel(value: string | null | undefined) {
  if (!value || value === "UNKNOWN") {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSeverity(severity: DefectSeverity | null) {
  if (!severity) {
    return "Unspecified";
  }

  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

function formatDate(date: string | null) {
  if (!date) {
    return "No date";
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

function formatDueDate(date: string | null | undefined) {
  if (!date) {
    return "No due date";
  }

  return formatDate(date);
}

function formatSlaState(state: DefectListItem["slaState"]) {
  if (!state || state === "UNKNOWN") {
    return "Unknown";
  }

  return state
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAssignee(defect: DefectListItem) {
  return defect.assignedTo?.trim() || "Unassigned";
}

function pencawangKeyOf(defect: DefectListItem) {
  return defect.substation?.code?.trim() || defect.substation?.name?.trim() || "";
}

function pencawangLabelOf(defect: DefectListItem) {
  return (
    defect.substation?.name?.trim() ||
    defect.substation?.code?.trim() ||
    pencawangKeyOf(defect)
  );
}

function toDateInputValue(date: string | null) {
  if (!date) {
    return "";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getSortValue(defect: DefectListItem, sortKey: SortKey) {
  if (sortKey === "severity") {
    return defect.severity ? SEVERITY_RANK[defect.severity] : 99;
  }

  if (sortKey === "status") {
    return STATUS_RANK[defect.status];
  }

  if (sortKey === "lifecycleStatus") {
    return defect.lifecycleStatus ? LIFECYCLE_RANK[defect.lifecycleStatus] : 99;
  }

  if (sortKey === "date") {
    const parsedDate = defect.date ? new Date(defect.date).getTime() : 0;
    return Number.isFinite(parsedDate) ? parsedDate : 0;
  }

  if (sortKey === "dueDate") {
    const parsedDate = defect.dueDate ? new Date(defect.dueDate).getTime() : 0;
    return Number.isFinite(parsedDate) ? parsedDate : 0;
  }

  if (sortKey === "location") {
    return normalizeSearchText(defect.location);
  }

  if (sortKey === "assignedTo") {
    return normalizeSearchText(formatAssignee(defect));
  }

  return normalizeSearchText(defect[sortKey]);
}

function compareSortValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function SeverityBadge({ severity }: { severity: DefectSeverity | null }) {
  const className =
    severity === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-700"
      : severity === "HIGH"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : severity === "MEDIUM"
          ? "border-yellow-200 bg-yellow-50 text-yellow-800"
          : severity === "LOW"
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex min-w-20 justify-center rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${className}`}>
      {severity ?? "UNSPECIFIED"}
    </span>
  );
}

function StatusBadge({ status }: { status: DefectStatus }) {
  const className =
    status === "OPEN"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "CLOSED"
        ? "border-green-200 bg-green-50 text-green-700"
        : status === "RESOLVED"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : status === "MONITORING"
            ? "border-violet-200 bg-violet-50 text-violet-700"
        : status === "IN_PROGRESS"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatStatus(status)}
    </span>
  );
}

function LifecycleBadge({ status }: { status: DefectLifecycleStatus | null | undefined }) {
  const className =
    status === "VERIFIED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "REJECTED"
        ? "border-red-200 bg-red-50 text-red-700"
        : status === "CLOSED"
          ? "border-green-200 bg-green-50 text-green-700"
          : status === "COMPLETED" || status === "VERIFICATION_PENDING"
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : status === "ASSIGNED" || status === "IN_PROGRESS"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : status === "UNDER_REVIEW"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : status === "DETECTED"
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : "border-slate-200 bg-slate-50 text-slate-500";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnumLabel(status)}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: DefectResolutionOutcome | null | undefined }) {
  if (!outcome || outcome === "UNKNOWN") {
    return null;
  }

  const className =
    outcome === "RESOLVED" || outcome === "REPAIRED"
      ? "border-green-200 bg-green-50 text-green-700"
      : outcome === "EXTERNAL_CONSTRAINT" || outcome === "ESCALATED"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : outcome === "TEMPORARY_FIX" ||
            outcome === "MONITORING_REQUIRED" ||
            outcome === "PARTIAL" ||
            outcome === "DEFERRED" ||
            outcome === "MONITOR_ONLY"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnumLabel(outcome)}
    </span>
  );
}

function SlaBadge({ defect }: { defect: DefectListItem }) {
  const className = defect.isOverdue
    ? "border-red-200 bg-red-50 text-red-700"
    : defect.slaState === "ON_TRACK"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : defect.slaState === "STOPPED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {defect.isOverdue ? <AlertTriangle size={13} /> : null}
      {formatSlaState(defect.slaState)}
    </span>
  );
}

function SortButton({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1 text-left font-semibold text-slate-600 transition hover:text-[var(--brand)]"
    >
      {label}
      <ChevronsUpDown size={14} className={isActive ? "text-[var(--brand)]" : "text-slate-400"} />
      {isActive ? <span className="sr-only">sorted {direction}</span> : null}
    </button>
  );
}

function DefectsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [defects, setDefects] = useState<DefectListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [assignedUserFilter, setAssignedUserFilter] = useState<AssignedUserFilter>("ALL");
  const [pencawangFilter, setPencawangFilter] = useState<PencawangFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadDefects = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextDefects = await fetchDefects(token);
        setDefects(nextDefects);
      } catch (defectsError) {
        if (defectsError instanceof ApiError && defectsError.status === 401) {
          handleLogout();
          return;
        }

        setError(defectsError instanceof Error ? defectsError.message : "Unable to load defects.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadDefects(storedSession.token);
    }
  }, [loadDefects]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    severityFilter,
    statusFilter,
    assignedUserFilter,
    pencawangFilter,
    categoryFilter,
    overdueOnly,
    startDate,
    endDate,
    pageSize,
  ]);

  const assignedUserOptions = useMemo(() => {
    const options = new Map<string, string>();

    defects.forEach((defect) => {
      if (!defect.assignedUserId) {
        return;
      }

      options.set(
        defect.assignedUserId,
        defect.assignedUser?.name?.trim() ||
          defect.assignedUser?.email?.trim() ||
          defect.assignedTo?.trim() ||
          "Assigned user",
      );
    });

    return Array.from(options.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], "en", { sensitivity: "base" }),
    );
  }, [defects]);

  const pencawangOptions = useMemo(() => {
    const options = new Map<string, string>();

    defects.forEach((defect) => {
      const key = pencawangKeyOf(defect);

      if (!key || options.has(key)) {
        return;
      }

      options.set(key, pencawangLabelOf(defect));
    });

    return Array.from(options.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], "en", { numeric: true, sensitivity: "base" }),
    );
  }, [defects]);

  const filteredDefects = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return defects.filter((defect) => {
      const defectDate = toDateInputValue(defect.date);
      const matchesSeverity =
        severityFilter === "ALL" || defect.severity === severityFilter;
      const matchesStatus = statusFilter === "ALL" || defect.status === statusFilter;
      const matchesAssignedUser =
        assignedUserFilter === "ALL" ||
        (assignedUserFilter === "UNASSIGNED"
          ? !defect.assignedUserId
          : defect.assignedUserId === assignedUserFilter);
      const matchesPencawang =
        pencawangFilter === "ALL" || pencawangKeyOf(defect) === pencawangFilter;
      const matchesCategory =
        categoryFilter === "ALL" || defect.maintenanceCategory === categoryFilter;
      const matchesOverdue = !overdueOnly || Boolean(defect.isOverdue);
      const matchesStartDate = !startDate || (defectDate && defectDate >= startDate);
      const matchesEndDate = !endDate || (defectDate && defectDate <= endDate);
      const matchesSearch =
        !normalizedSearch ||
        [
          defect.assetCode,
          defect.assetType,
          defect.defectType,
          formatSeverity(defect.severity),
          formatStatus(defect.status),
          formatEnumLabel(defect.lifecycleStatus),
          formatEnumLabel(defect.resolutionOutcome),
          formatDate(defect.date),
          formatDueDate(defect.dueDate),
          formatAssignee(defect),
          formatSlaState(defect.slaState),
          defect.location,
          defect.substation?.name,
          defect.substation?.code,
          defect.remark,
          defect.actionRemark,
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));

      return (
        matchesSeverity &&
        matchesStatus &&
        matchesAssignedUser &&
        matchesPencawang &&
        matchesCategory &&
        matchesOverdue &&
        matchesStartDate &&
        matchesEndDate &&
        matchesSearch
      );
    });
  }, [
    assignedUserFilter,
    pencawangFilter,
    categoryFilter,
    defects,
    endDate,
    overdueOnly,
    search,
    severityFilter,
    startDate,
    statusFilter,
  ]);

  const sortedDefects = useMemo(() => {
    return [...filteredDefects].sort((left, right) => {
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const primarySort =
        compareSortValues(getSortValue(left, sortKey), getSortValue(right, sortKey)) *
        directionMultiplier;

      if (primarySort !== 0) {
        return primarySort;
      }

      return left.assetCode.localeCompare(right.assetCode, "en", {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [filteredDefects, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedDefects.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItemIndex = sortedDefects.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItemIndex = Math.min(currentPage * pageSize, sortedDefects.length);
  const paginatedDefects = sortedDefects.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const isReadOnly = session?.user?.role !== "ADMIN";

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "date" ? "desc" : "asc");
  }

  function resetFilters() {
    setSearch("");
    setSeverityFilter("ALL");
    setStatusFilter("ALL");
    setAssignedUserFilter("ALL");
    setPencawangFilter("ALL");
    setCategoryFilter("ALL");
    setOverdueOnly(false);
    setStartDate("");
    setEndDate("");
  }

  function openDefect(defectId: string) {
    router.push(`/defects/${encodeURIComponent(defectId)}`);
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Defect Table
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Defects
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {defects.length} total
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 shadow-[var(--shadow-soft)]">
                  <AlertTriangle size={13} />
                  {defects.filter((defect) => defect.isOverdue).length} overdue
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadDefects(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && defects.length === 0 ? (
              <DefectsLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    <label className="relative block">
                      <span className="sr-only">Search defects</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search defects"
                        className={searchControlClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">Severity</span>
                      <select
                        value={severityFilter}
                        onChange={(event) =>
                          setSeverityFilter(event.target.value as SeverityFilter)
                        }
                        className={filterControlClassName}
                      >
                        {SEVERITY_OPTIONS.map((option) => (
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
                        className={filterControlClassName}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Pencawang</span>
                      <select
                        value={pencawangFilter}
                        onChange={(event) =>
                          setPencawangFilter(event.target.value as PencawangFilter)
                        }
                        className={filterControlClassName}
                      >
                        <option value="ALL">All Pencawang</option>
                        {pencawangOptions.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Maintenance category</span>
                      <select
                        value={categoryFilter}
                        onChange={(event) =>
                          setCategoryFilter(event.target.value as CategoryFilter)
                        }
                        className={filterControlClassName}
                      >
                        {MAINTENANCE_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Assigned user</span>
                      <select
                        value={assignedUserFilter}
                        onChange={(event) =>
                          setAssignedUserFilter(event.target.value as AssignedUserFilter)
                        }
                        className={filterControlClassName}
                      >
                        <option value="ALL">All assignees</option>
                        <option value="UNASSIGNED">Unassigned</option>
                        {assignedUserOptions.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Start date</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                        className={filterControlClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">End date</span>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                        className={filterControlClassName}
                      />
                    </label>

                    <label className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                      <input
                        type="checkbox"
                        checked={overdueOnly}
                        onChange={(event) => setOverdueOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                      />
                      Overdue only
                    </label>

                    <button
                      type="button"
                      onClick={resetFilters}
                      className={secondaryButtonClassName}
                    >
                      <X size={16} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Asset Code"
                            sortKey="assetCode"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="min-w-64 px-5 py-3.5">
                          <SortButton
                            label="Defect Type"
                            sortKey="defectType"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Severity"
                            sortKey="severity"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Status"
                            sortKey="status"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Governance"
                            sortKey="lifecycleStatus"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Assignee"
                            sortKey="assignedTo"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Date"
                            sortKey="date"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Due Date"
                            sortKey="dueDate"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Location"
                            sortKey="location"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedDefects.map((defect) => (
                        <tr
                          key={defect.id}
                          tabIndex={0}
                          onClick={() => openDefect(defect.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openDefect(defect.id);
                            }
                          }}
                          className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                          aria-label={`Open defect ${defect.defectType} for ${defect.assetCode}`}
                        >
                          <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                            {defect.assetCode}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            <div className="font-medium text-slate-900">{defect.defectType}</div>
                            {defect.remark ? (
                              <div className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                                {defect.remark}
                              </div>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <SeverityBadge severity={defect.severity} />
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <StatusBadge status={defect.status} />
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <div className="flex flex-col items-start gap-2">
                              <LifecycleBadge status={defect.lifecycleStatus} />
                              <OutcomeBadge outcome={defect.resolutionOutcome} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                            {formatAssignee(defect)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                            {formatDate(defect.date)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <div className="flex flex-col items-start gap-2">
                              <span className="text-sm text-slate-600">
                                {formatDueDate(defect.dueDate)}
                              </span>
                              <SlaBadge defect={defect} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                            {defect.location ?? "Not recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {paginatedDefects.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No defects found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-[var(--muted)]">
                    Showing {firstItemIndex}-{lastItemIndex} of {sortedDefects.length}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      Rows
                      <select
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value))}
                        className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
                      >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((currentPageNumber) => Math.max(1, currentPageNumber - 1))}
                        disabled={currentPage === 1}
                        className={paginationButtonClassName}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <span className="min-w-20 text-center text-sm font-semibold text-slate-700">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((currentPageNumber) =>
                            Math.min(totalPages, currentPageNumber + 1),
                          )
                        }
                        disabled={currentPage === totalPages}
                        className={paginationButtonClassName}
                        aria-label="Next page"
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function DefectsClient() {
  return (
    <AuthGuard>
      <DefectsContent />
    </AuthGuard>
  );
}
