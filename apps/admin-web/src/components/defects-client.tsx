"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  MapPin,
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
import { DEFECT_SEVERITIES, MAINTENANCE_CATEGORIES } from "@/types/defects";

type SeverityFilter = "ALL" | DefectSeverity;
type StatusFilter = "ALL" | DefectWorkflowStatus;
type AssignedUserFilter = "ALL" | "UNASSIGNED" | string;
type PencawangFilter = "ALL" | string;

// The list is grouped Pencawang -> pole. Groups collapse (and paginate) so the
// page shows at most this many headers instead of every pole of every Pencawang.
const PENCAWANG_PAGE_SIZE = 20;
const paginationButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
type CategoryFilter = "ALL" | MaintenanceCategory;

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
const filterControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]";

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

function formatCategory(category: MaintenanceCategory): string {
  if (category === "RENTIS") {
    return "Rentis";
  }

  if (category === "CAT_TIANG") {
    return "Cat Tiang";
  }

  return "Selenggaraan";
}

function orderedSeverities(defects: DefectListItem[]): DefectSeverity[] {
  const present = new Set(
    defects
      .map((defect) => defect.severity)
      .filter((severity): severity is DefectSeverity => Boolean(severity)),
  );

  return DEFECT_SEVERITIES.filter((severity) => present.has(severity));
}

function orderedCategories(defects: DefectListItem[]): MaintenanceCategory[] {
  const present = new Set(
    defects
      .map((defect) => defect.maintenanceCategory)
      .filter((category): category is MaintenanceCategory => Boolean(category)),
  );

  return MAINTENANCE_CATEGORIES.filter((category) => present.has(category));
}

function CategoryChip({ category }: { category: MaintenanceCategory }) {
  return (
    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
      {formatCategory(category)}
    </span>
  );
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
  const [expandedPoles, setExpandedPoles] = useState<Set<string>>(new Set());
  const [expandedPencawang, setExpandedPencawang] = useState<Set<string>>(new Set());
  const [groupPage, setGroupPage] = useState(1);

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

  const pencawangGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; poles: Map<string, DefectListItem[]> }
    >();

    for (const defect of filteredDefects) {
      const key = pencawangKeyOf(defect) || "__unassigned__";

      if (!groups.has(key)) {
        groups.set(key, { key, label: pencawangLabelOf(defect), poles: new Map() });
      }

      const poleKey = defect.assetCode || "Unassigned";
      const group = groups.get(key)!;

      if (!group.poles.has(poleKey)) {
        group.poles.set(poleKey, []);
      }

      group.poles.get(poleKey)!.push(defect);
    }

    return Array.from(groups.values())
      .map((group) => ({
        key: group.key,
        label: group.label,
        defectCount: Array.from(group.poles.values()).reduce(
          (total, list) => total + list.length,
          0,
        ),
        poles: Array.from(group.poles.entries())
          .map(([assetCode, poleDefects]) => ({ assetCode, defects: poleDefects }))
          .sort((left, right) =>
            left.assetCode.localeCompare(right.assetCode, "en", {
              numeric: true,
              sensitivity: "base",
            }),
          ),
      }))
      .sort((left, right) =>
        left.label.localeCompare(right.label, "en", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [filteredDefects]);

  const totalPoleCount = pencawangGroups.reduce(
    (total, group) => total + group.poles.length,
    0,
  );
  const isReadOnly = session?.user?.role !== "ADMIN";

  const totalGroupPages = Math.max(
    1,
    Math.ceil(pencawangGroups.length / PENCAWANG_PAGE_SIZE),
  );
  // Clamp rather than trust state: a filter can shrink the list under our feet.
  const currentGroupPage = Math.min(groupPage, totalGroupPages);
  const visibleGroups = pencawangGroups.slice(
    (currentGroupPage - 1) * PENCAWANG_PAGE_SIZE,
    currentGroupPage * PENCAWANG_PAGE_SIZE,
  );

  // A search — or a filter that narrows to a single Pencawang — must reveal its
  // hits immediately, otherwise matches hide behind a collapsed header.
  const forceExpandGroups =
    search.trim() !== "" ||
    pencawangFilter !== "ALL" ||
    pencawangGroups.length === 1;

  // Any filter change rebuilds filteredDefects, so page 1 is the right landing.
  useEffect(() => {
    setGroupPage(1);
  }, [filteredDefects]);

  function toggleGroup(groupKey: string) {
    setExpandedPencawang((current) => {
      const next = new Set(current);

      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }

      return next;
    });
  }

  function togglePole(poleKey: string) {
    setExpandedPoles((current) => {
      const next = new Set(current);

      if (next.has(poleKey)) {
        next.delete(poleKey);
      } else {
        next.add(poleKey);
      }

      return next;
    });
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

                <div className="divide-y divide-slate-100">
                  {visibleGroups.map((group) => {
                    const isGroupExpanded =
                      forceExpandGroups || expandedPencawang.has(group.key);

                    return (
                    <div key={group.key} className="px-5 py-4">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={isGroupExpanded}
                        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md text-left transition hover:bg-slate-50"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <ChevronRight
                            size={16}
                            className={`shrink-0 text-slate-400 transition-transform ${
                              isGroupExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <MapPin size={16} className="shrink-0 text-slate-400" />
                          <span className="truncate text-sm font-bold uppercase tracking-wide text-slate-700">
                            {group.label}
                          </span>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-[var(--muted)]">
                          {group.poles.length} pole{group.poles.length === 1 ? "" : "s"}
                          {" · "}
                          {group.defectCount} defect{group.defectCount === 1 ? "" : "s"}
                        </span>
                      </button>

                      {isGroupExpanded ? (
                      <div className="mt-3 space-y-2">
                        {group.poles.map((pole) => {
                          const poleKey = `${group.key}::${pole.assetCode}`;
                          const isExpanded = expandedPoles.has(poleKey);
                          const severities = orderedSeverities(pole.defects);
                          const categories = orderedCategories(pole.defects);
                          const poleOverdue = pole.defects.some(
                            (defect) => defect.isOverdue,
                          );

                          return (
                            <div
                              key={poleKey}
                              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                            >
                              <button
                                type="button"
                                onClick={() => togglePole(poleKey)}
                                aria-expanded={isExpanded}
                                className="flex w-full flex-wrap items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50"
                              >
                                <ChevronRight
                                  size={16}
                                  className={`shrink-0 text-slate-400 transition-transform ${
                                    isExpanded ? "rotate-90" : ""
                                  }`}
                                />
                                <span className="font-semibold text-slate-900">
                                  {pole.assetCode}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                  {pole.defects.length} defect
                                  {pole.defects.length === 1 ? "" : "s"}
                                </span>
                                {severities.map((severity) => (
                                  <SeverityBadge key={severity} severity={severity} />
                                ))}
                                {categories.map((category) => (
                                  <CategoryChip key={category} category={category} />
                                ))}
                                {poleOverdue ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                                    <AlertTriangle size={12} />
                                    Overdue
                                  </span>
                                ) : null}
                              </button>

                              {isExpanded ? (
                                <div className="divide-y divide-slate-100 border-t border-slate-100">
                                  {pole.defects.map((defect) => (
                                    <button
                                      key={defect.id}
                                      type="button"
                                      onClick={() => openDefect(defect.id)}
                                      className="flex w-full flex-wrap items-center gap-2.5 py-2.5 pl-9 pr-4 text-left text-sm transition hover:bg-teal-50/40"
                                    >
                                      <span className="min-w-0 flex-1 truncate font-medium text-slate-900">
                                        {defect.defectType}
                                      </span>
                                      <SeverityBadge severity={defect.severity} />
                                      {defect.maintenanceCategory ? (
                                        <CategoryChip
                                          category={defect.maintenanceCategory}
                                        />
                                      ) : null}
                                      <StatusBadge status={defect.status} />
                                      <LifecycleBadge status={defect.lifecycleStatus} />
                                      <OutcomeBadge outcome={defect.resolutionOutcome} />
                                      <SlaBadge defect={defect} />
                                      <span className="shrink-0 text-xs text-[var(--muted)]">
                                        {formatDate(defect.date)}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      ) : null}
                    </div>
                    );
                  })}

                  {pencawangGroups.length === 0 ? (
                    <div className="px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No defects found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
                  <span>
                    {totalPoleCount} pole{totalPoleCount === 1 ? "" : "s"} with defects
                    across {pencawangGroups.length} Pencawang · {filteredDefects.length}{" "}
                    defect{filteredDefects.length === 1 ? "" : "s"} total
                  </span>

                  {totalGroupPages > 1 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-600">
                        Page {currentGroupPage} of {totalGroupPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setGroupPage(Math.max(1, currentGroupPage - 1))}
                        disabled={currentGroupPage === 1}
                        className={paginationButtonClassName}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setGroupPage(Math.min(totalGroupPages, currentGroupPage + 1))
                        }
                        disabled={currentGroupPage === totalGroupPages}
                        className={paginationButtonClassName}
                        aria-label="Next page"
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  ) : null}
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
