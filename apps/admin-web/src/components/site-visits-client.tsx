"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchSiteVisits } from "@/lib/site-visits";
import type { AuthSession } from "@/types/auth";
import type {
  OperationalHealthStatus,
  SiteVisitListItem,
  SiteVisitStatus,
  SiteVisitType,
  SiteVisitValidationStatus,
} from "@/types/site-visits";

type SortKey =
  | "health"
  | "status"
  | "pencawang"
  | "mainhead"
  | "team"
  | "progress"
  | "defects"
  | "lastActivity"
  | "startedAt";
type SortDirection = "asc" | "desc";
type StatusFilter = "ALL" | SiteVisitStatus;
type HealthFilter = "ALL" | OperationalHealthStatus;
type ValidationFilter = "ALL" | SiteVisitValidationStatus;
type VisitTypeFilter = "ALL" | SiteVisitType;

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const AUTO_REFRESH_MS = 60000;
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Cancelled", value: "CANCELLED" },
];
const HEALTH_OPTIONS: Array<{ label: string; value: HealthFilter }> = [
  { label: "All health", value: "ALL" },
  { label: "Healthy", value: "HEALTHY" },
  { label: "Warning", value: "WARNING" },
  { label: "Critical", value: "CRITICAL" },
];
const VALIDATION_OPTIONS: Array<{ label: string; value: ValidationFilter }> = [
  { label: "All validation", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Validated", value: "VALIDATED" },
  { label: "Warning", value: "WARNING" },
  { label: "Failed", value: "FAILED" },
];
const VISIT_TYPE_OPTIONS: Array<{ label: string; value: VisitTypeFilter }> = [
  { label: "All types", value: "ALL" },
  { label: "Discovery", value: "DISCOVERY" },
  { label: "Reinspection", value: "REINSPECTION" },
  { label: "Special", value: "SPECIAL" },
  { label: "Audit", value: "AUDIT" },
  { label: "Unspecified", value: "UNSPECIFIED" },
];
const STATUS_RANK: Record<SiteVisitStatus, number> = {
  ACTIVE: 0,
  OPEN: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  CANCELLED: 4,
  UNKNOWN: 5,
};
const HEALTH_RANK: Record<OperationalHealthStatus, number> = {
  CRITICAL: 0,
  WARNING: 1,
  HEALTHY: 2,
};
const filterControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]";
const paginationButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function SiteVisitsLoading() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
      <div className="mt-5 h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
    </div>
  );
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
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function toDateInputValue(date: string | null | undefined) {
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

function displayTeam(visit: SiteVisitListItem) {
  return visit.team?.name?.trim() || visit.team?.code?.trim() || "Unassigned";
}

function displayPencawang(visit: SiteVisitListItem) {
  return (
    [visit.pencawangCode, visit.pencawangName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" - ") || "Not recorded"
  );
}

function getSortValue(visit: SiteVisitListItem, sortKey: SortKey) {
  if (sortKey === "health") {
    return HEALTH_RANK[visit.operationalHealthStatus];
  }

  if (sortKey === "status") {
    return STATUS_RANK[visit.status];
  }

  if (sortKey === "progress") {
    return visit.completionPercentage;
  }

  if (sortKey === "defects") {
    return visit.defectsFound;
  }

  if (sortKey === "lastActivity") {
    return dateSortValue(visit.lastActivityAt);
  }

  if (sortKey === "startedAt") {
    return dateSortValue(visit.startedAt);
  }

  if (sortKey === "pencawang") {
    return normalizeSearchText(displayPencawang(visit));
  }

  if (sortKey === "mainhead") {
    return normalizeSearchText(visit.mainhead);
  }

  return normalizeSearchText(displayTeam(visit));
}

function dateSortValue(date: string | null | undefined) {
  const timestamp = date ? new Date(date).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
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

function uniqueTeams(visits: SiteVisitListItem[]) {
  const teams = new Map<string, string>();

  visits.forEach((visit) => {
    if (!visit.team?.id) {
      return;
    }

    teams.set(visit.team.id, displayTeam(visit));
  });

  return Array.from(teams.entries()).sort((left, right) =>
    left[1].localeCompare(right[1], "en", { sensitivity: "base" }),
  );
}

function HealthBadge({ status }: { status: OperationalHealthStatus }) {
  const className =
    status === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${className}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: SiteVisitStatus }) {
  const className =
    status === "COMPLETED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "CANCELLED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function ValidationBadge({ status }: { status: SiteVisitValidationStatus }) {
  const className =
    status === "FAILED"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : status === "VALIDATED"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function ProgressBar({ percentage }: { percentage: number }) {
  const boundedPercentage = Math.min(Math.max(percentage, 0), 100);

  return (
    <div className="min-w-36">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
        <span>{boundedPercentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${boundedPercentage}%` }}
        />
      </div>
    </div>
  );
}

function OperationalStat({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClassName =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClassName}`}>
          <Icon size={17} />
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-950">{value}</p>
    </div>
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

function SiteVisitsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [visits, setVisits] = useState<SiteVisitListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [search, setSearch] = useState("");
  const [mainheadFilter, setMainheadFilter] = useState("");
  const [pencawangFilter, setPencawangFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [memberFilter, setMemberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("ALL");
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>("ALL");
  const [visitTypeFilter, setVisitTypeFilter] = useState<VisitTypeFilter>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActivity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadVisits = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");

      try {
        const nextVisits = await fetchSiteVisits(token);
        setVisits(nextVisits);
      } catch (visitsError) {
        if (visitsError instanceof ApiError && visitsError.status === 401) {
          handleLogout();
          return;
        }

        setError(visitsError instanceof Error ? visitsError.message : "Unable to load site visits.");
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadVisits(storedSession.token);
    }
  }, [loadVisits]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadVisits(session.token, false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadVisits, session?.token]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    mainheadFilter,
    pencawangFilter,
    teamFilter,
    memberFilter,
    statusFilter,
    healthFilter,
    validationFilter,
    visitTypeFilter,
    startDate,
    endDate,
    pageSize,
  ]);

  const teamOptions = useMemo(() => uniqueTeams(visits), [visits]);

  const filteredVisits = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);
    const normalizedMainhead = normalizeSearchText(mainheadFilter);
    const normalizedPencawang = normalizeSearchText(pencawangFilter);
    const normalizedMember = normalizeSearchText(memberFilter);

    return visits.filter((visit) => {
      const visitDate = toDateInputValue(visit.startedAt);
      const matchesSearch =
        !normalizedSearch ||
        [
          displayPencawang(visit),
          visit.mainhead,
          visit.functionalLocation,
          displayTeam(visit),
          formatEnum(visit.status),
          formatEnum(visit.validationStatus),
          formatEnum(visit.visitType),
          visit.createdBy?.name,
          visit.createdBy?.email,
          visit.teamMembers.map((member) => `${member.name ?? ""} ${member.email ?? ""}`).join(" "),
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));
      const matchesMainhead =
        !normalizedMainhead ||
        normalizeSearchText(visit.mainhead).includes(normalizedMainhead);
      const matchesPencawang =
        !normalizedPencawang ||
        normalizeSearchText(displayPencawang(visit)).includes(normalizedPencawang);
      const matchesTeam = teamFilter === "ALL" || visit.team?.id === teamFilter;
      const matchesMember =
        !normalizedMember ||
        visit.teamMembers.some((member) =>
          normalizeSearchText(`${member.name ?? ""} ${member.email ?? ""}`).includes(
            normalizedMember,
          ),
        );
      const matchesStatus = statusFilter === "ALL" || visit.status === statusFilter;
      const matchesHealth =
        healthFilter === "ALL" || visit.operationalHealthStatus === healthFilter;
      const matchesValidation =
        validationFilter === "ALL" || visit.validationStatus === validationFilter;
      const matchesVisitType =
        visitTypeFilter === "ALL" || visit.visitType === visitTypeFilter;
      const matchesStartDate = !startDate || (visitDate && visitDate >= startDate);
      const matchesEndDate = !endDate || (visitDate && visitDate <= endDate);

      return (
        matchesSearch &&
        matchesMainhead &&
        matchesPencawang &&
        matchesTeam &&
        matchesMember &&
        matchesStatus &&
        matchesHealth &&
        matchesValidation &&
        matchesVisitType &&
        matchesStartDate &&
        matchesEndDate
      );
    });
  }, [
    endDate,
    healthFilter,
    mainheadFilter,
    memberFilter,
    pencawangFilter,
    search,
    startDate,
    statusFilter,
    teamFilter,
    validationFilter,
    visitTypeFilter,
    visits,
  ]);

  const sortedVisits = useMemo(() => {
    return [...filteredVisits].sort((left, right) => {
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const primarySort =
        compareSortValues(getSortValue(left, sortKey), getSortValue(right, sortKey)) *
        directionMultiplier;

      if (primarySort !== 0) {
        return primarySort;
      }

      return displayPencawang(left).localeCompare(displayPencawang(right), "en", {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [filteredVisits, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedVisits.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItemIndex = sortedVisits.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItemIndex = Math.min(currentPage * pageSize, sortedVisits.length);
  const paginatedVisits = sortedVisits.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const isReadOnly = session?.user?.role !== "ADMIN";
  const activeVisitCount = visits.filter((visit) =>
    ["ACTIVE", "OPEN", "IN_PROGRESS"].includes(visit.status),
  ).length;
  const completedVisitCount = visits.filter((visit) => visit.status === "COMPLETED").length;
  const overdueVisitCount = visits.filter((visit) => visit.isOverdue).length;
  const criticalVisitCount = visits.filter(
    (visit) => visit.operationalHealthStatus === "CRITICAL",
  ).length;
  const averageCompletion =
    visits.length === 0
      ? 0
      : Math.round(
          visits.reduce((total, visit) => total + visit.completionPercentage, 0) /
            visits.length,
        );

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "lastActivity" || nextSortKey === "startedAt" ? "desc" : "asc",
    );
  }

  function resetFilters() {
    setSearch("");
    setMainheadFilter("");
    setPencawangFilter("");
    setTeamFilter("ALL");
    setMemberFilter("");
    setStatusFilter("ALL");
    setHealthFilter("ALL");
    setValidationFilter("ALL");
    setVisitTypeFilter("ALL");
    setStartDate("");
    setEndDate("");
  }

  function openVisit(visitId: string) {
    router.push(`/site-visits/${encodeURIComponent(visitId)}`);
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operations Control
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Site Visits
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  Auto-refresh 60s
                </label>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {visits.length} total
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadVisits(session.token, false) : undefined)}
              disabled={(isLoading && visits.length === 0) || isRefreshing || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && visits.length === 0 ? (
              <SiteVisitsLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <OperationalStat label="Active" value={activeVisitCount} icon={Activity} />
                  <OperationalStat
                    label="Completed"
                    value={completedVisitCount}
                    icon={ShieldCheck}
                    tone="success"
                  />
                  <OperationalStat
                    label="Overdue"
                    value={overdueVisitCount}
                    icon={Clock3}
                    tone={overdueVisitCount > 0 ? "danger" : "neutral"}
                  />
                  <OperationalStat
                    label="Critical"
                    value={criticalVisitCount}
                    icon={AlertTriangle}
                    tone={criticalVisitCount > 0 ? "danger" : "neutral"}
                  />
                  <OperationalStat
                    label="Completion"
                    value={`${averageCompletion}%`}
                    icon={CalendarDays}
                    tone="success"
                  />
                </div>

                <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                  <div className="border-b border-slate-200 p-5">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(9,minmax(128px,auto))_auto]">
                      <label className="relative block">
                        <span className="sr-only">Search visits</span>
                        <Search
                          size={17}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search operations"
                          className={searchControlClassName}
                        />
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
                        <span className="sr-only">Health</span>
                        <select
                          value={healthFilter}
                          onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
                          className={filterControlClassName}
                        >
                          {HEALTH_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="sr-only">Validation</span>
                        <select
                          value={validationFilter}
                          onChange={(event) =>
                            setValidationFilter(event.target.value as ValidationFilter)
                          }
                          className={filterControlClassName}
                        >
                          {VALIDATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="sr-only">Visit type</span>
                        <select
                          value={visitTypeFilter}
                          onChange={(event) =>
                            setVisitTypeFilter(event.target.value as VisitTypeFilter)
                          }
                          className={filterControlClassName}
                        >
                          {VISIT_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="sr-only">Team</span>
                        <select
                          value={teamFilter}
                          onChange={(event) => setTeamFilter(event.target.value)}
                          className={filterControlClassName}
                        >
                          <option value="ALL">All teams</option>
                          {teamOptions.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="sr-only">MAINHEAD</span>
                        <input
                          type="text"
                          value={mainheadFilter}
                          onChange={(event) => setMainheadFilter(event.target.value)}
                          placeholder="MAINHEAD"
                          className={filterControlClassName}
                        />
                      </label>

                      <label className="block">
                        <span className="sr-only">Pencawang</span>
                        <input
                          type="text"
                          value={pencawangFilter}
                          onChange={(event) => setPencawangFilter(event.target.value)}
                          placeholder="Pencawang"
                          className={filterControlClassName}
                        />
                      </label>

                      <label className="block">
                        <span className="sr-only">Team member</span>
                        <input
                          type="text"
                          value={memberFilter}
                          onChange={(event) => setMemberFilter(event.target.value)}
                          placeholder="Team/user"
                          className={filterControlClassName}
                        />
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
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Health"
                              sortKey="health"
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
                          <th className="min-w-64 px-5 py-3.5">
                            <SortButton
                              label="Pencawang"
                              sortKey="pencawang"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="MAINHEAD"
                              sortKey="mainhead"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Team"
                              sortKey="team"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Progress"
                              sortKey="progress"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Defects"
                              sortKey="defects"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">Validation</th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Last Activity"
                              sortKey="lastActivity"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="whitespace-nowrap px-5 py-3.5">
                            <SortButton
                              label="Started"
                              sortKey="startedAt"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedVisits.map((visit) => (
                          <tr
                            key={visit.id}
                            tabIndex={0}
                            onClick={() => openVisit(visit.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openVisit(visit.id);
                              }
                            }}
                            className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                            aria-label={`Open site visit ${displayPencawang(visit)}`}
                          >
                            <td className="whitespace-nowrap px-5 py-4">
                              <HealthBadge status={visit.operationalHealthStatus} />
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <StatusBadge status={visit.status} />
                            </td>
                            <td className="px-5 py-4">
                              <div className="font-semibold text-slate-900">
                                {displayPencawang(visit)}
                              </div>
                              <div className="mt-1 text-xs text-[var(--muted)]">
                                {formatEnum(visit.visitType)} / Cycle {visit.cycleNumber ?? "N/A"}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              {visit.mainhead ?? "Not recorded"}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                              <div className="font-medium text-slate-900">{displayTeam(visit)}</div>
                              <div className="mt-1 text-xs text-[var(--muted)]">
                                {visit.teamMembers.length} members
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <ProgressBar percentage={visit.completionPercentage} />
                              <div className="mt-1 text-xs text-slate-500">
                                {visit.inspectedAssets}/{visit.totalAssets} assets
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                              {visit.defectsFound.toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4">
                              <ValidationBadge status={visit.validationStatus} />
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                              {formatDateTime(visit.lastActivityAt)}
                            </td>
                            <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                              {formatDateTime(visit.startedAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {paginatedVisits.length === 0 ? (
                      <div className="border-t border-slate-100 px-5 py-12 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                          <SlidersHorizontal size={20} />
                        </div>
                        <p className="mt-4 text-sm font-semibold text-slate-900">
                          No site visits found
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-[var(--muted)]">
                      Showing {firstItemIndex}-{lastItemIndex} of {sortedVisits.length}
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
                          onClick={() =>
                            setPage((currentPageNumber) =>
                              Math.max(1, currentPageNumber - 1),
                            )
                          }
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
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function SiteVisitsClient() {
  return (
    <AuthGuard>
      <SiteVisitsContent />
    </AuthGuard>
  );
}
