"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  MapPin,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  Chip,
  FilterBar,
  PageHeader,
  SearchField,
  TableFooter,
  Tag,
  Tbtn,
  filterSelectClass,
  type Tone,
} from "@/components/ui";
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

function DefectsLoading() {
  return (
    <Card>
      <div className="h-[38px] w-full animate-pulse rounded-[var(--radius-control)] bg-[var(--panel-muted)]" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-[9px] bg-[var(--panel-muted)]" />
        ))}
      </div>
    </Card>
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

function severityTone(severity: DefectSeverity | null): Tone {
  if (severity === "CRITICAL") return "critical";
  if (severity === "HIGH") return "high";
  if (severity === "MEDIUM") return "warning";
  if (severity === "LOW") return "success";
  return "neutral";
}

function statusTone(status: DefectStatus): Tone {
  if (status === "OPEN") return "critical";
  if (status === "CLOSED" || status === "RESOLVED") return "success";
  if (status === "MONITORING") return "monitor";
  if (status === "IN_PROGRESS") return "info";
  return "neutral";
}

function lifecycleTone(status: DefectLifecycleStatus | null | undefined): Tone {
  if (status === "VERIFIED" || status === "CLOSED") return "success";
  if (status === "REJECTED") return "critical";
  if (status === "COMPLETED" || status === "VERIFICATION_PENDING") return "brand";
  if (status === "ASSIGNED" || status === "IN_PROGRESS") return "info";
  if (status === "UNDER_REVIEW") return "warning";
  return "neutral";
}

function outcomeTone(outcome: DefectResolutionOutcome): Tone {
  if (outcome === "RESOLVED" || outcome === "REPAIRED") return "success";
  if (outcome === "EXTERNAL_CONSTRAINT" || outcome === "ESCALATED") return "high";
  if (
    outcome === "TEMPORARY_FIX" ||
    outcome === "MONITORING_REQUIRED" ||
    outcome === "PARTIAL" ||
    outcome === "DEFERRED" ||
    outcome === "MONITOR_ONLY"
  ) {
    return "warning";
  }
  return "neutral";
}

function slaTone(defect: DefectListItem): Tone {
  if (defect.isOverdue) return "critical";
  if (defect.slaState === "ON_TRACK") return "success";
  if (defect.slaState === "STOPPED") return "neutral";
  return "warning";
}

function CategoryChip({ category }: { category: MaintenanceCategory }) {
  return <Chip tone="info">{formatCategory(category)}</Chip>;
}

function SeverityBadge({ severity }: { severity: DefectSeverity | null }) {
  return <Chip tone={severityTone(severity)}>{formatSeverity(severity)}</Chip>;
}

function StatusBadge({ status }: { status: DefectStatus }) {
  return <Chip tone={statusTone(status)}>{formatStatus(status)}</Chip>;
}

function LifecycleBadge({ status }: { status: DefectLifecycleStatus | null | undefined }) {
  return <Chip tone={lifecycleTone(status)}>{formatEnumLabel(status)}</Chip>;
}

function OutcomeBadge({ outcome }: { outcome: DefectResolutionOutcome | null | undefined }) {
  if (!outcome || outcome === "UNKNOWN") {
    return null;
  }

  return <Chip tone={outcomeTone(outcome)}>{formatEnumLabel(outcome)}</Chip>;
}

function SlaBadge({ defect }: { defect: DefectListItem }) {
  return <Tag tone={slaTone(defect)}>{formatSlaState(defect.slaState)}</Tag>;
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
  const overdueCount = defects.filter((defect) => defect.isOverdue).length;

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
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Defect Register"
            title="Defects"
            chips={
              <>
                <Chip tone="neutral">
                  <ShieldCheck size={13} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </Chip>
                <Chip tone="neutral">{defects.length} open</Chip>
                {overdueCount > 0 ? (
                  <Chip tone="critical">
                    <AlertTriangle size={12} />
                    {overdueCount} overdue
                  </Chip>
                ) : null}
              </>
            }
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadDefects(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6">
            {isLoading && defects.length === 0 ? (
              <DefectsLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : (
              <Card padded={false}>
                <div className="border-b border-[var(--line2)] p-[18px]">
                  <FilterBar>
                    <SearchField
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search defects"
                      aria-label="Search defects"
                    />

                    <select
                      aria-label="Severity"
                      value={severityFilter}
                      onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                      className={filterSelectClass}
                    >
                      {SEVERITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Status"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                      className={filterSelectClass}
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Pencawang"
                      value={pencawangFilter}
                      onChange={(event) => setPencawangFilter(event.target.value as PencawangFilter)}
                      className={filterSelectClass}
                    >
                      <option value="ALL">All Pencawang</option>
                      {pencawangOptions.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Maintenance category"
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                      className={filterSelectClass}
                    >
                      {MAINTENANCE_CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="Assigned user"
                      value={assignedUserFilter}
                      onChange={(event) =>
                        setAssignedUserFilter(event.target.value as AssignedUserFilter)
                      }
                      className={filterSelectClass}
                    >
                      <option value="ALL">All assignees</option>
                      <option value="UNASSIGNED">Unassigned</option>
                      {assignedUserOptions.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>

                    <input
                      type="date"
                      aria-label="Start date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      className={filterSelectClass}
                    />

                    <input
                      type="date"
                      aria-label="End date"
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      className={filterSelectClass}
                    />

                    <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 text-[13px] font-semibold text-[var(--foreground-soft)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--panel-muted)]">
                      <input
                        type="checkbox"
                        checked={overdueOnly}
                        onChange={(event) => setOverdueOnly(event.target.checked)}
                        className="h-4 w-4 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                      />
                      Overdue only
                    </label>

                    <Tbtn variant="ghost" onClick={resetFilters}>
                      <X size={16} />
                      Reset
                    </Tbtn>
                  </FilterBar>
                </div>

                <div>
                  {visibleGroups.map((group) => {
                    const isGroupExpanded =
                      forceExpandGroups || expandedPencawang.has(group.key);

                    return (
                      <div key={group.key} className="border-b border-[var(--line2)] last:border-b-0">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          aria-expanded={isGroupExpanded}
                          className="flex w-full flex-wrap items-center justify-between gap-2 bg-[var(--panel-muted)] px-[18px] py-3 text-left transition hover:bg-[var(--surface-pressed)]"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <ChevronRight
                              size={16}
                              className={`shrink-0 text-[var(--muted-2)] transition-transform ${
                                isGroupExpanded ? "rotate-90" : ""
                              }`}
                            />
                            <MapPin size={15} className="shrink-0 text-[var(--muted-2)]" />
                            <span className="truncate font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-[var(--foreground-soft)]">
                              {group.label}
                            </span>
                          </div>
                          <span className="shrink-0 text-[12px] font-medium text-[var(--muted)]">
                            {group.poles.length} pole{group.poles.length === 1 ? "" : "s"}
                            {" · "}
                            {group.defectCount} defect{group.defectCount === 1 ? "" : "s"}
                          </span>
                        </button>

                        {isGroupExpanded ? (
                          <div>
                            {group.poles.map((pole) => {
                              const poleKey = `${group.key}::${pole.assetCode}`;
                              const isExpanded = expandedPoles.has(poleKey);
                              const severities = orderedSeverities(pole.defects);
                              const categories = orderedCategories(pole.defects);
                              const poleOverdue = pole.defects.some(
                                (defect) => defect.isOverdue,
                              );

                              return (
                                <div key={poleKey} className="border-t border-[var(--line2)]">
                                  <button
                                    type="button"
                                    onClick={() => togglePole(poleKey)}
                                    aria-expanded={isExpanded}
                                    className="flex w-full flex-wrap items-center gap-2 px-[18px] py-2.5 text-left transition hover:bg-[var(--panel-muted)]"
                                  >
                                    <ChevronRight
                                      size={15}
                                      className={`shrink-0 text-[var(--muted-2)] transition-transform ${
                                        isExpanded ? "rotate-90" : ""
                                      }`}
                                    />
                                    <span className="text-[13px] font-semibold text-[var(--foreground)]">
                                      {pole.assetCode}
                                    </span>
                                    <Chip tone="neutral">
                                      {pole.defects.length} defect
                                      {pole.defects.length === 1 ? "" : "s"}
                                    </Chip>
                                    {severities.map((severity) => (
                                      <SeverityBadge key={severity} severity={severity} />
                                    ))}
                                    {categories.map((category) => (
                                      <CategoryChip key={category} category={category} />
                                    ))}
                                    {poleOverdue ? (
                                      <Chip tone="critical">
                                        <AlertTriangle size={12} />
                                        Overdue
                                      </Chip>
                                    ) : null}
                                  </button>

                                  {isExpanded ? (
                                    <div className="bg-[var(--panel-muted)]">
                                      {pole.defects.map((defect) => (
                                        <button
                                          key={defect.id}
                                          type="button"
                                          onClick={() => openDefect(defect.id)}
                                          className="flex w-full flex-wrap items-center gap-2 border-t border-[var(--line2)] py-2.5 pl-[44px] pr-[18px] text-left transition hover:bg-[var(--brand-tint)]"
                                        >
                                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--foreground)]">
                                            {defect.defectType}
                                          </span>
                                          <SeverityBadge severity={defect.severity} />
                                          {defect.maintenanceCategory ? (
                                            <CategoryChip category={defect.maintenanceCategory} />
                                          ) : null}
                                          <StatusBadge status={defect.status} />
                                          <LifecycleBadge status={defect.lifecycleStatus} />
                                          <OutcomeBadge outcome={defect.resolutionOutcome} />
                                          <SlaBadge defect={defect} />
                                          <span className="shrink-0 font-mono text-[12px] text-[var(--muted)]">
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
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                        No defects found
                      </p>
                    </div>
                  ) : null}
                </div>

                <TableFooter
                  summary={
                    <>
                      {totalPoleCount} pole{totalPoleCount === 1 ? "" : "s"} with defects across{" "}
                      {pencawangGroups.length} Pencawang · {filteredDefects.length} defect
                      {filteredDefects.length === 1 ? "" : "s"} total
                    </>
                  }
                  page={currentGroupPage}
                  pageCount={totalGroupPages}
                  onPageChange={setGroupPage}
                />
              </Card>
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
