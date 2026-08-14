"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Siren,
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
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableMonoCellClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  fetchDefectRegistryDefects,
  fetchDefectRegistryRollup,
  searchDefectRegistry,
} from "@/lib/defects";
import type { AuthSession } from "@/types/auth";
import type {
  DefectListItem,
  DefectLifecycleStatus,
  DefectRegistryGroup,
  DefectRegistryLevel,
  DefectRegistryTotals,
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

// Search mode can span many Pencawang; groups paginate so the page shows at
// most this many headers at once. The leaf is a single drilled Pencawang.
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

/** Where the user currently is in the Region → Mainhead → Pencawang drill. */
type DrillState = {
  regionId: string | null;
  regionName: string | null;
  mainheadId: string | null;
  mainheadName: string | null;
  pencawangId: string | null;
  pencawangName: string | null;
};

const EMPTY_DRILL: DrillState = {
  regionId: null,
  regionName: null,
  mainheadId: null,
  mainheadName: null,
  pencawangId: null,
  pencawangName: null,
};

// Survives an in-tab visit to the defect detail page, so Back lands on the same
// drilled view instead of the top of the hierarchy.
const DRILL_STORAGE_KEY = "ascure.defects.drill";

function readStoredDrill(): DrillState {
  if (typeof window === "undefined") {
    return EMPTY_DRILL;
  }
  try {
    const raw = window.sessionStorage.getItem(DRILL_STORAGE_KEY);
    if (!raw) {
      return EMPTY_DRILL;
    }
    const parsed = JSON.parse(raw) as Partial<DrillState>;
    return {
      regionId: typeof parsed.regionId === "string" ? parsed.regionId : null,
      regionName: typeof parsed.regionName === "string" ? parsed.regionName : null,
      mainheadId: typeof parsed.mainheadId === "string" ? parsed.mainheadId : null,
      mainheadName:
        typeof parsed.mainheadName === "string" ? parsed.mainheadName : null,
      pencawangId:
        typeof parsed.pencawangId === "string" ? parsed.pencawangId : null,
      pencawangName:
        typeof parsed.pencawangName === "string" ? parsed.pencawangName : null,
    };
  } catch {
    return EMPTY_DRILL;
  }
}

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

/** Level being LISTED for a given drill position. */
function listedLevel(drill: DrillState): DefectRegistryLevel {
  if (drill.mainheadId) {
    return "pencawang";
  }
  if (drill.regionId) {
    return "mainhead";
  }
  return "region";
}

const LEVEL_NOUN: Record<DefectRegistryLevel, string> = {
  region: "Region",
  mainhead: "Mainhead",
  pencawang: "Pencawang",
};

function DefectsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [drill, setDrill] = useState<DrillState>(() => readStoredDrill());
  // True once a single-Region tenant auto-skips the pointless region list.
  const [regionAutoSkipped, setRegionAutoSkipped] = useState(false);
  const [groups, setGroups] = useState<DefectRegistryGroup[]>([]);
  const [totals, setTotals] = useState<DefectRegistryTotals | null>(null);
  const [defects, setDefects] = useState<DefectListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  // Cross-scope pole search (group views only — the leaf filters locally).
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{
    defects: DefectListItem[];
    truncated: boolean;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [assignedUserFilter, setAssignedUserFilter] = useState<AssignedUserFilter>("ALL");
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

  // Load whatever the current drill position needs: rollup counts for a group
  // view, or the one drilled Pencawang's defects. Nothing tenant-wide, ever.
  const loadView = useCallback(
    async (token: string, current: DrillState) => {
      setIsLoading(true);
      setError("");

      try {
        if (current.pencawangId) {
          const nextDefects = await fetchDefectRegistryDefects(
            token,
            current.pencawangId,
          );
          setDefects(nextDefects);
          return;
        }

        const level = listedLevel(current);
        const rollup = await fetchDefectRegistryRollup(token, level, {
          regionId: current.regionId ?? undefined,
          mainheadId: current.mainheadId ?? undefined,
        });

        if (level === "region" && rollup.groups.length === 1) {
          setRegionAutoSkipped(true);
          setDrill((previous) => ({
            ...previous,
            regionId: rollup.groups[0].id,
            regionName: rollup.groups[0].name,
          }));
          return;
        }
        if (level === "region") {
          setRegionAutoSkipped(false);
        }

        setGroups(rollup.groups);
        setTotals(rollup.totals);
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
  }, []);

  useEffect(() => {
    if (session?.token) {
      void loadView(session.token, drill);
    }
  }, [session?.token, drill, loadView]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(drill));
  }, [drill]);

  // Debounced cross-scope pole search while on a group view.
  useEffect(() => {
    if (drill.pencawangId) {
      setSearchResults(null);
      return;
    }
    const term = globalSearch.trim();
    if (term.length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    if (!session?.token) {
      return;
    }
    const token = session.token;
    setIsSearching(true);
    const timer = window.setTimeout(() => {
      searchDefectRegistry(token, term)
        .then(setSearchResults)
        .catch((searchError) => {
          if (searchError instanceof ApiError && searchError.status === 401) {
            handleLogout();
            return;
          }
          setSearchResults({ defects: [], truncated: false });
        })
        .finally(() => setIsSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [globalSearch, drill.pencawangId, session?.token, handleLogout]);

  const mode: "groups" | "leaf" | "search" = drill.pencawangId
    ? "leaf"
    : searchResults !== null
      ? "search"
      : "groups";
  const listLevel = listedLevel(drill);
  const listSource = mode === "leaf" ? defects : (searchResults?.defects ?? []);

  const assignedUserOptions = useMemo(() => {
    const options = new Map<string, string>();

    listSource.forEach((defect) => {
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
  }, [listSource]);

  const filteredDefects = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return listSource.filter((defect) => {
      const defectDate = toDateInputValue(defect.date);
      const matchesSeverity =
        severityFilter === "ALL" || defect.severity === severityFilter;
      const matchesStatus = statusFilter === "ALL" || defect.status === statusFilter;
      const matchesAssignedUser =
        assignedUserFilter === "ALL" ||
        (assignedUserFilter === "UNASSIGNED"
          ? !defect.assignedUserId
          : defect.assignedUserId === assignedUserFilter);
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
        matchesCategory &&
        matchesOverdue &&
        matchesStartDate &&
        matchesEndDate &&
        matchesSearch
      );
    });
  }, [
    assignedUserFilter,
    categoryFilter,
    listSource,
    endDate,
    overdueOnly,
    search,
    severityFilter,
    startDate,
    statusFilter,
  ]);

  const pencawangGroups = useMemo(() => {
    const grouped = new Map<
      string,
      { key: string; label: string; poles: Map<string, DefectListItem[]> }
    >();

    for (const defect of filteredDefects) {
      const key = pencawangKeyOf(defect) || "__unassigned__";

      if (!grouped.has(key)) {
        grouped.set(key, { key, label: pencawangLabelOf(defect), poles: new Map() });
      }

      const poleKey = defect.assetCode || "Unassigned";
      const group = grouped.get(key)!;

      if (!group.poles.has(poleKey)) {
        group.poles.set(poleKey, []);
      }

      group.poles.get(poleKey)!.push(defect);
    }

    return Array.from(grouped.values())
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
  const overdueCount = listSource.filter((defect) => defect.isOverdue).length;
  const openCount = useMemo(
    () =>
      listSource.filter(
        (defect) =>
          defect.status === "OPEN" ||
          defect.status === "IN_PROGRESS" ||
          defect.status === "MONITORING",
      ).length,
    [listSource],
  );

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

  // The leaf is one Pencawang (a single group) and a search must reveal its
  // hits immediately — collapsed headers would hide both.
  const forceExpandGroups =
    mode === "leaf" ||
    mode === "search" ||
    search.trim() !== "" ||
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
    setCategoryFilter("ALL");
    setOverdueOnly(false);
    setStartDate("");
    setEndDate("");
  }

  function drillInto(group: DefectRegistryGroup) {
    setGlobalSearch("");
    resetFilters();
    if (listLevel === "region") {
      setDrill((previous) => ({
        ...previous,
        regionId: group.id,
        regionName: group.name,
      }));
      return;
    }
    if (listLevel === "mainhead") {
      setDrill((previous) => ({
        ...previous,
        mainheadId: group.id,
        mainheadName: group.name,
      }));
      return;
    }
    setDrill((previous) => ({
      ...previous,
      pencawangId: group.id,
      pencawangName: group.name,
    }));
  }

  function drillUpTo(level: "root" | "region" | "mainhead") {
    resetFilters();
    setGlobalSearch("");
    if (level === "root") {
      setDrill(EMPTY_DRILL);
      return;
    }
    if (level === "region") {
      setDrill((previous) => ({
        ...previous,
        mainheadId: null,
        mainheadName: null,
        pencawangId: null,
        pencawangName: null,
      }));
      return;
    }
    setDrill((previous) => ({
      ...previous,
      pencawangId: null,
      pencawangName: null,
    }));
  }

  function openDefect(defectId: string) {
    router.push(`/defects/${encodeURIComponent(defectId)}`);
  }

  // Breadcrumb entries down to (but excluding) the current view.
  const crumbs: Array<{ label: string; onClick: () => void }> = [];
  if (!regionAutoSkipped && drill.regionId) {
    crumbs.push({ label: "All regions", onClick: () => drillUpTo("root") });
  }
  if (drill.regionId && (drill.mainheadId || drill.pencawangId)) {
    crumbs.push({
      label: regionAutoSkipped ? "All mainheads" : (drill.regionName ?? "Region"),
      onClick: () => drillUpTo("region"),
    });
  }
  if (drill.mainheadId && drill.pencawangId) {
    crumbs.push({
      label: drill.mainheadName ?? "Mainhead",
      onClick: () => drillUpTo("mainhead"),
    });
  }
  const currentCrumb = drill.pencawangId
    ? (drill.pencawangName ?? "Pencawang")
    : drill.mainheadId
      ? (drill.mainheadName ?? "Mainhead")
      : drill.regionId && !regionAutoSkipped
        ? (drill.regionName ?? "Region")
        : regionAutoSkipped
          ? "All mainheads"
          : "All regions";

  const showList = mode === "leaf" || mode === "search";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Defect Register"
            title="Defects"
            subtitle="Drill from Region to Mainhead to Pencawang — each step loads only its own counts, and a Pencawang loads only its own defects."
            chips={
              <>
                <Chip tone="neutral">
                  <ShieldCheck size={13} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </Chip>
                {mode === "groups" && totals ? (
                  <>
                    <Chip tone="neutral">{totals.defectCount} in scope</Chip>
                    <Chip tone={totals.openCount > 0 ? "critical" : "success"}>
                      {totals.openCount} open
                    </Chip>
                    {totals.emergencyCount > 0 ? (
                      <Chip tone="critical">
                        <Siren size={12} />
                        {totals.emergencyCount} emergency
                      </Chip>
                    ) : null}
                  </>
                ) : null}
                {mode === "leaf" ? (
                  <>
                    <Chip tone="neutral">{defects.length} in this Pencawang</Chip>
                    <Chip tone={openCount > 0 ? "critical" : "success"}>
                      {openCount} open
                    </Chip>
                    {overdueCount > 0 ? (
                      <Chip tone="critical">
                        <AlertTriangle size={12} />
                        {overdueCount} overdue
                      </Chip>
                    ) : null}
                  </>
                ) : null}
              </>
            }
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadView(session.token, drill) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          {/* Drill breadcrumb */}
          <nav
            aria-label="Drill-down position"
            className="mt-4 flex flex-wrap items-center gap-1.5 text-[13px]"
          >
            {crumbs.map((crumb) => (
              <span key={crumb.label} className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="font-semibold text-[var(--brand)] transition hover:underline"
                >
                  {crumb.label}
                </button>
                <ChevronRight size={14} className="text-[var(--muted-2)]" />
              </span>
            ))}
            <span className="font-semibold text-[var(--foreground)]">{currentCrumb}</span>
          </nav>

          <div className="mt-5">
            {isLoading && !showList && groups.length === 0 ? (
              <DefectsLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : mode === "groups" || mode === "search" ? (
              <Card padded={false}>
                <div className="border-b border-[var(--line2)] p-[18px]">
                  <FilterBar>
                    <SearchField
                      value={globalSearch}
                      onChange={(event) => setGlobalSearch(event.target.value)}
                      placeholder="Find a pole's defects anywhere (code or old number)…"
                      aria-label="Search all defects by pole"
                    />
                    {isSearching ? (
                      <Chip tone="neutral">
                        <Loader2 size={13} className="animate-spin" />
                        Searching
                      </Chip>
                    ) : null}
                    {mode === "search" && searchResults ? (
                      <>
                        <Chip tone={searchResults.truncated ? "warning" : "neutral"}>
                          {searchResults.truncated
                            ? `Top ${searchResults.defects.length} matches`
                            : `${searchResults.defects.length} match${
                                searchResults.defects.length === 1 ? "" : "es"
                              }`}
                        </Chip>
                        <Tbtn variant="ghost" onClick={() => setGlobalSearch("")}>
                          <X size={16} />
                          Clear
                        </Tbtn>
                      </>
                    ) : null}
                  </FilterBar>
                </div>

                {mode === "groups" ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead>
                        <tr className={`${tableHeadClass} border-b border-[var(--line2)]`}>
                          <th className={`${tableHeadCellClass} min-w-56`}>
                            {LEVEL_NOUN[listLevel]}
                          </th>
                          {listLevel !== "pencawang" ? (
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              Pencawang
                            </th>
                          ) : null}
                          <th className={`${tableHeadCellClass} whitespace-nowrap`}>Defects</th>
                          <th className={`${tableHeadCellClass} whitespace-nowrap`}>Open</th>
                          <th className={`${tableHeadCellClass} whitespace-nowrap`}>Critical</th>
                          <th className={`${tableHeadCellClass} whitespace-nowrap`}>Emergency</th>
                          <th className="w-10 px-3.5 py-2.5" aria-hidden />
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((group) => (
                          <tr
                            key={group.id}
                            tabIndex={0}
                            onClick={() => drillInto(group)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                drillInto(group);
                              }
                            }}
                            className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--panel-muted)]`}
                            aria-label={`Open ${group.name}`}
                          >
                            <td className={`${tableCellClass} font-semibold text-[var(--foreground)]`}>
                              {group.name}
                            </td>
                            {listLevel !== "pencawang" ? (
                              <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                                {group.pencawangCount}
                              </td>
                            ) : null}
                            <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                              {group.defectCount}
                            </td>
                            <td className={`${tableCellClass} whitespace-nowrap`}>
                              {group.openCount > 0 ? (
                                <Chip tone="critical">{group.openCount}</Chip>
                              ) : (
                                <span className="font-mono text-[var(--muted)]">0</span>
                              )}
                            </td>
                            <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                              {group.criticalCount}
                            </td>
                            <td className={`${tableCellClass} whitespace-nowrap`}>
                              {group.emergencyCount > 0 ? (
                                <Chip tone="critical">
                                  <Siren size={12} />
                                  {group.emergencyCount}
                                </Chip>
                              ) : (
                                <span className="font-mono text-[var(--muted)]">0</span>
                              )}
                            </td>
                            <td className="px-3.5 py-3 text-[var(--muted-2)]">
                              <ChevronRight size={16} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {groups.length === 0 && !isLoading ? (
                      <div className="border-t border-[var(--line2)] px-5 py-12 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                          <MapPin size={20} />
                        </div>
                        <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                          No defects in your scope
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <DefectGroupList
                    visibleGroups={visibleGroups}
                    pencawangGroups={pencawangGroups}
                    filteredDefects={filteredDefects}
                    totalPoleCount={totalPoleCount}
                    forceExpandGroups={forceExpandGroups}
                    expandedPencawang={expandedPencawang}
                    expandedPoles={expandedPoles}
                    toggleGroup={toggleGroup}
                    togglePole={togglePole}
                    openDefect={openDefect}
                    currentGroupPage={currentGroupPage}
                    totalGroupPages={totalGroupPages}
                    setGroupPage={setGroupPage}
                  />
                )}
              </Card>
            ) : (
              <Card padded={false}>
                <div className="border-b border-[var(--line2)] p-[18px]">
                  <FilterBar>
                    <SearchField
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search this Pencawang's defects"
                      aria-label="Search defects in this Pencawang"
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

                <DefectGroupList
                  visibleGroups={visibleGroups}
                  pencawangGroups={pencawangGroups}
                  filteredDefects={filteredDefects}
                  totalPoleCount={totalPoleCount}
                  forceExpandGroups={forceExpandGroups}
                  expandedPencawang={expandedPencawang}
                  expandedPoles={expandedPoles}
                  toggleGroup={toggleGroup}
                  togglePole={togglePole}
                  openDefect={openDefect}
                  currentGroupPage={currentGroupPage}
                  totalGroupPages={totalGroupPages}
                  setGroupPage={setGroupPage}
                />
              </Card>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

/** The Pencawang → pole → defect collapsible list + its footer (shared by the
 *  drilled-Pencawang leaf and cross-scope search results). */
function DefectGroupList({
  visibleGroups,
  pencawangGroups,
  filteredDefects,
  totalPoleCount,
  forceExpandGroups,
  expandedPencawang,
  expandedPoles,
  toggleGroup,
  togglePole,
  openDefect,
  currentGroupPage,
  totalGroupPages,
  setGroupPage,
}: {
  visibleGroups: Array<{
    key: string;
    label: string;
    defectCount: number;
    poles: Array<{ assetCode: string; defects: DefectListItem[] }>;
  }>;
  pencawangGroups: Array<{ key: string }>;
  filteredDefects: DefectListItem[];
  totalPoleCount: number;
  forceExpandGroups: boolean;
  expandedPencawang: Set<string>;
  expandedPoles: Set<string>;
  toggleGroup: (groupKey: string) => void;
  togglePole: (poleKey: string) => void;
  openDefect: (defectId: string) => void;
  currentGroupPage: number;
  totalGroupPages: number;
  setGroupPage: (page: number) => void;
}) {
  return (
    <>
      <div>
        {visibleGroups.map((group) => {
          const isGroupExpanded = forceExpandGroups || expandedPencawang.has(group.key);

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
                    const poleOverdue = pole.defects.some((defect) => defect.isOverdue);

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
    </>
  );
}

export function DefectsClient() {
  return (
    <AuthGuard>
      <DefectsContent />
    </AuthGuard>
  );
}
