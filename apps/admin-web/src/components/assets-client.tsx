"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  ChevronsUpDown,
  CircleCheckBig,
  Clock,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  Chip,
  FilterBar,
  KpiCard,
  PageHeader,
  SearchField,
  TableFooter,
  Tbtn,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableMonoCellClass,
  tableRowClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { storeAssetNavContext } from "@/lib/asset-nav";
import {
  bulkDeleteAssets,
  deleteAssetsBySession,
  deleteAssetsBySubstation,
  fetchAssetRegistryAssets,
  fetchAssetRegistryRollup,
  searchAssetRegistry,
  type DeleteAssetsResult,
} from "@/lib/assets";
import { fetchOperationalSessions } from "@/lib/operational-sessions";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";
import type {
  AssetInspectionStatus,
  AssetListItem,
  AssetRegistryGroup,
  AssetRegistryLevel,
  AssetRegistryTotals,
} from "@/types/assets";
import type { OperationalSession } from "@/types/operational-sessions";

type PendingDelete = {
  title: string;
  countLabel: string;
  description: string;
  run: (token: string) => Promise<DeleteAssetsResult>;
};

type SortKey =
  | "assetCode"
  | "assetType"
  | "feeder"
  | "location"
  | "pencawangName"
  | "inspectionStatus"
  | "date";
type SortDirection = "asc" | "desc";

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

// Survives an in-tab visit to the asset detail page, so Back lands on the same
// drilled view instead of the top of the hierarchy (mirrors the map's view key).
const DRILL_STORAGE_KEY = "ascure.assets.drill";

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

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const STATUS_RANK: Record<AssetInspectionStatus, number> = {
  COMPLETED: 0,
  PENDING: 1,
};

function AssetsLoading() {
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

function formatInspectionStatus(status: AssetInspectionStatus) {
  return status === "COMPLETED" ? "Completed" : "Pending";
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

function formatNullable(value: string | null) {
  return value?.trim() || "Not recorded";
}

/** Whole-percent share of `total`, safe at zero. */
function percentOf(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function getSortValue(asset: AssetListItem, sortKey: SortKey) {
  if (sortKey === "inspectionStatus") {
    return STATUS_RANK[asset.inspectionStatus];
  }

  if (sortKey === "date") {
    const parsedDate = asset.date ? new Date(asset.date).getTime() : 0;
    return Number.isFinite(parsedDate) ? parsedDate : 0;
  }

  return normalizeSearchText(asset[sortKey]);
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

function uniqueOptions(assets: AssetListItem[], key: "assetType" | "feeder") {
  return Array.from(
    new Set(
      assets
        .map((asset) => asset[key]?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function StatusBadge({ status }: { status: AssetInspectionStatus }) {
  return (
    <Chip tone={status === "COMPLETED" ? "success" : "neutral"}>
      {formatInspectionStatus(status)}
    </Chip>
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
      className={`inline-flex items-center gap-1 text-left transition ${
        isActive ? "text-[var(--foreground)]" : "hover:text-[var(--foreground-soft)]"
      }`}
    >
      {label}
      <ChevronsUpDown
        size={13}
        className={isActive ? "text-[var(--brand)]" : "text-[var(--muted-2)]"}
      />
      {isActive ? <span className="sr-only">sorted {direction}</span> : null}
    </button>
  );
}

/** Level being LISTED for a given drill position. */
function listedLevel(drill: DrillState): AssetRegistryLevel {
  if (drill.mainheadId) {
    return "pencawang";
  }
  if (drill.regionId) {
    return "mainhead";
  }
  return "region";
}

const LEVEL_NOUN: Record<AssetRegistryLevel, string> = {
  region: "Region",
  mainhead: "Mainhead",
  pencawang: "Pencawang",
};

function AssetsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [drill, setDrill] = useState<DrillState>(() => readStoredDrill());
  // True once a single-Region tenant auto-skips the pointless region list, so
  // the breadcrumb roots at Mainheads instead of a one-row Regions view.
  const [regionAutoSkipped, setRegionAutoSkipped] = useState(false);
  const [groups, setGroups] = useState<AssetRegistryGroup[]>([]);
  const [totals, setTotals] = useState<AssetRegistryTotals | null>(null);
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  // Cross-scope pole search (group views only — the leaf filters locally).
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{
    assets: AssetListItem[];
    truncated: boolean;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("ALL");
  const [feederFilter, setFeederFilter] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("assetCode");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<OperationalSession[]>([]);
  const [sessionToDelete, setSessionToDelete] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  // Load whatever the current drill position needs: rollup counts for a group
  // view, or the one drilled Pencawang's rows. Nothing tenant-wide, ever.
  const loadView = useCallback(
    async (token: string, current: DrillState) => {
      setIsLoading(true);
      setError("");

      try {
        if (current.pencawangId) {
          const nextAssets = await fetchAssetRegistryAssets(
            token,
            current.pencawangId,
          );
          setAssets(nextAssets);
          setSelectedIds(new Set());
          return;
        }

        const level = listedLevel(current);
        const rollup = await fetchAssetRegistryRollup(token, level, {
          regionId: current.regionId ?? undefined,
          mainheadId: current.mainheadId ?? undefined,
        });

        // A single-Region tenant (or one with Regions not configured — a lone
        // "Unassigned" bucket) skips straight to the Mainhead list.
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
        setSelectedIds(new Set());
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Unable to load assets.");
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

  // Keep the drill position across an in-tab round trip to the asset detail.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(DRILL_STORAGE_KEY, JSON.stringify(drill));
  }, [drill]);

  // Sessions populate the ADMIN "delete all in session" dropdown — only needed
  // once a Pencawang table (the danger strip's home) is on screen.
  useEffect(() => {
    if (!session?.token || session.user?.role !== "ADMIN" || !drill.pencawangId) {
      return;
    }
    fetchOperationalSessions(session.token)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [session?.token, session?.user?.role, drill.pencawangId]);

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
      searchAssetRegistry(token, term)
        .then((results) => {
          setSearchResults(results);
          setSelectedIds(new Set());
        })
        .catch((searchError) => {
          if (searchError instanceof ApiError && searchError.status === 401) {
            handleLogout();
            return;
          }
          setSearchResults({ assets: [], truncated: false });
        })
        .finally(() => setIsSearching(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [globalSearch, drill.pencawangId, session?.token, handleLogout]);

  useEffect(() => {
    setPage(1);
  }, [search, assetTypeFilter, feederFilter, startDate, endDate, pageSize, drill, searchResults]);

  const mode: "groups" | "leaf" | "search" = drill.pencawangId
    ? "leaf"
    : searchResults !== null
      ? "search"
      : "groups";
  const listLevel = listedLevel(drill);

  const tableSource = mode === "leaf" ? assets : (searchResults?.assets ?? []);

  const assetTypeOptions = useMemo(() => uniqueOptions(assets, "assetType"), [assets]);
  const feederOptions = useMemo(() => uniqueOptions(assets, "feeder"), [assets]);

  // Leaf KPI strip — derived from the loaded Pencawang, no extra request.
  const inspectedCount = useMemo(
    () => assets.filter((asset) => asset.inspectionStatus === "COMPLETED").length,
    [assets],
  );
  const pendingCount = useMemo(
    () => assets.filter((asset) => asset.inspectionStatus === "PENDING").length,
    [assets],
  );

  const filteredAssets = useMemo(() => {
    if (mode === "search") {
      return tableSource;
    }
    const normalizedSearch = normalizeSearchText(search);

    return tableSource.filter((asset) => {
      const assetDate = toDateInputValue(asset.date);
      const matchesAssetType =
        assetTypeFilter === "ALL" || asset.assetType === assetTypeFilter;
      const matchesFeeder = feederFilter === "ALL" || asset.feeder === feederFilter;
      const matchesStartDate = !startDate || (assetDate && assetDate >= startDate);
      const matchesEndDate = !endDate || (assetDate && assetDate <= endDate);
      const matchesSearch =
        !normalizedSearch ||
        [
          asset.assetCode,
          asset.assetType,
          asset.feeder,
          asset.location,
          asset.pencawangName,
          formatInspectionStatus(asset.inspectionStatus),
          formatDate(asset.date),
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));

      return (
        matchesAssetType &&
        matchesFeeder &&
        matchesStartDate &&
        matchesEndDate &&
        matchesSearch
      );
    });
  }, [
    mode,
    tableSource,
    assetTypeFilter,
    endDate,
    feederFilter,
    search,
    startDate,
  ]);

  const sortedAssets = useMemo(() => {
    return [...filteredAssets].sort((left, right) => {
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
  }, [filteredAssets, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedAssets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItemIndex = sortedAssets.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItemIndex = Math.min(currentPage * pageSize, sortedAssets.length);
  const paginatedAssets = sortedAssets.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const isAdmin = session?.user?.role === "ADMIN";
  // ADMIN, or a Main Contractor manager (server-provided flag) who may delete
  // across their own org + active subcontractor subtree. The API enforces the
  // exact scope, so an out-of-scope id just falls through to "not found".
  const canDeleteAssets =
    isAdmin || session?.user?.canOverseeSubcontractors === true;

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
    setAssetTypeFilter("ALL");
    setFeederFilter("ALL");
    setStartDate("");
    setEndDate("");
  }

  function drillInto(group: AssetRegistryGroup) {
    setGlobalSearch("");
    // A leaf filter from a previously-open Pencawang must not carry into this
    // one (a stale feeder pick would silently blank the new table).
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

  function openAsset(assetId: string) {
    // Stash the full filtered+sorted list (not just the current page) so the
    // detail page's Prev/Next can walk every pole this view contains.
    storeAssetNavContext(
      sortedAssets.map((asset) => asset.id),
      "",
      assetId,
    );
    router.push(`/assets/${encodeURIComponent(assetId)}`);
  }

  const allVisibleSelected =
    paginatedAssets.length > 0 &&
    paginatedAssets.every((asset) => selectedIds.has(asset.id));

  function toggleRow(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        paginatedAssets.forEach((asset) => next.delete(asset.id));
      } else {
        paginatedAssets.forEach((asset) => next.add(asset.id));
      }
      return next;
    });
  }

  async function runPendingDelete() {
    if (!session?.token || !pendingDelete) {
      return;
    }
    setIsDeleting(true);
    setError("");
    setActionMessage("");
    try {
      const result = await pendingDelete.run(session.token);
      setActionMessage(
        `Deleted ${result.deleted} asset${result.deleted === 1 ? "" : "s"}.`,
      );
      setPendingDelete(null);
      setSessionToDelete("");
      await loadView(session.token, drill); // also clears the selection
    } catch (deleteError) {
      if (deleteError instanceof ApiError && deleteError.status === 401) {
        handleLogout();
        return;
      }
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

  // Breadcrumb entries down to (but excluding) the current view.
  const crumbs: Array<{ label: string; onClick: () => void }> = [];
  if (!regionAutoSkipped) {
    if (drill.regionId) {
      crumbs.push({ label: "All regions", onClick: () => drillUpTo("root") });
    }
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

  const showTable = mode === "leaf" || mode === "search";
  const kpiTotals = totals;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Asset Registry"
            title="Assets"
            subtitle="Drill from Region to Mainhead to Pencawang — each step loads only its own counts, and a Pencawang loads only its own poles."
            chips={
              <>
                <Chip tone="neutral">
                  <ShieldCheck size={13} />
                  {isAdmin
                    ? "Full access"
                    : canDeleteAssets
                      ? "Delete access"
                      : "Read-only"}
                </Chip>
                {kpiTotals && mode === "groups" ? (
                  <Chip tone="neutral">{kpiTotals.assetCount} in scope</Chip>
                ) : null}
                {mode === "leaf" ? (
                  <Chip tone="neutral">{assets.length} in this Pencawang</Chip>
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
            {isLoading && !showTable && groups.length === 0 ? (
              <AssetsLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : (
              <>
                {mode === "groups" && kpiTotals ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Assets in scope"
                      value={kpiTotals.assetCount}
                      icon={Boxes}
                      context={`Across ${kpiTotals.pencawangCount} Pencawang`}
                    />
                    <KpiCard
                      label="Inspected"
                      value={kpiTotals.inspectedCount}
                      icon={CircleCheckBig}
                      tone="success"
                      context={`${percentOf(kpiTotals.inspectedCount, kpiTotals.assetCount)}% of assets in scope`}
                    />
                    <KpiCard
                      label="Pending"
                      value={kpiTotals.pendingCount}
                      icon={Clock}
                      context={`${percentOf(kpiTotals.pendingCount, kpiTotals.assetCount)}% awaiting inspection`}
                    />
                    <KpiCard
                      label="Poles with open defects"
                      value={kpiTotals.defectAssetCount}
                      icon={AlertTriangle}
                      tone={kpiTotals.defectAssetCount > 0 ? "critical" : "neutral"}
                      context={`${percentOf(kpiTotals.defectAssetCount, kpiTotals.assetCount)}% of assets in scope`}
                    />
                  </div>
                ) : null}

                {mode === "leaf" ? (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Assets in this Pencawang"
                      value={assets.length}
                      icon={MapPin}
                      context={drill.pencawangName ?? undefined}
                    />
                    <KpiCard
                      label="Inspected"
                      value={inspectedCount}
                      icon={CircleCheckBig}
                      tone="success"
                      context={`${percentOf(inspectedCount, assets.length)}% of this Pencawang`}
                    />
                    <KpiCard
                      label="Pending"
                      value={pendingCount}
                      icon={Clock}
                      context={`${percentOf(pendingCount, assets.length)}% awaiting inspection`}
                    />
                    <KpiCard
                      label="Feeders"
                      value={feederOptions.length}
                      icon={Zap}
                      context={`${assetTypeOptions.length} asset type${
                        assetTypeOptions.length === 1 ? "" : "s"
                      }`}
                    />
                  </div>
                ) : null}

                {mode !== "leaf" ? (
                  <Card padded={false} className="mt-4">
                    <div className="border-b border-[var(--line2)] p-[18px]">
                      <FilterBar>
                        <SearchField
                          value={globalSearch}
                          onChange={(event) => setGlobalSearch(event.target.value)}
                          placeholder="Find a pole anywhere (code or old number)…"
                          aria-label="Search all poles"
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
                                ? `Top ${searchResults.assets.length} matches`
                                : `${searchResults.assets.length} match${
                                    searchResults.assets.length === 1 ? "" : "es"
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
                              <th className={`${tableHeadCellClass} whitespace-nowrap`}>Assets</th>
                              <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                                Inspected
                              </th>
                              <th className={`${tableHeadCellClass} whitespace-nowrap`}>Pending</th>
                              <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                                Open-defect poles
                              </th>
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
                                  {group.assetCount}
                                </td>
                                <td className={`${tableCellClass} whitespace-nowrap`}>
                                  <span className="font-mono">{group.inspectedCount}</span>
                                  <span className="ml-1.5 text-[11px] text-[var(--muted)]">
                                    {percentOf(group.inspectedCount, group.assetCount)}%
                                  </span>
                                </td>
                                <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                                  {group.pendingCount}
                                </td>
                                <td className={`${tableCellClass} whitespace-nowrap`}>
                                  {group.defectAssetCount > 0 ? (
                                    <Chip tone="critical">{group.defectAssetCount}</Chip>
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
                              <Boxes size={20} />
                            </div>
                            <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                              No assets in your scope
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </Card>
                ) : null}

                {showTable ? (
                  <Card padded={false} className="mt-4">
                    {mode === "leaf" ? (
                      <div className="border-b border-[var(--line2)] p-[18px]">
                        <FilterBar>
                          <SearchField
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search this Pencawang"
                            aria-label="Search assets in this Pencawang"
                          />

                          <select
                            aria-label="Asset type"
                            value={assetTypeFilter}
                            onChange={(event) => setAssetTypeFilter(event.target.value)}
                            className={filterSelectClass}
                          >
                            <option value="ALL">All asset types</option>
                            {assetTypeOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>

                          <select
                            aria-label="Feeder"
                            value={feederFilter}
                            onChange={(event) => setFeederFilter(event.target.value)}
                            className={filterSelectClass}
                          >
                            <option value="ALL">All feeders</option>
                            {feederOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
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

                          <Tbtn variant="ghost" onClick={resetFilters}>
                            <X size={16} />
                            Reset
                          </Tbtn>
                        </FilterBar>
                      </div>
                    ) : null}

                    {/* Destructive actions keep their own strip *below* the filter bar.
                        "Delete all in this Pencawang" acts on the drilled Pencawang. */}
                    {canDeleteAssets && showTable ? (
                      <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--line2)] bg-[var(--danger-tint)] px-[18px] py-3">
                        <span className="mr-1 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--critical-text)]">
                          Danger zone
                        </span>

                        <Tbtn
                          variant="danger"
                          disabled={selectedIds.size === 0}
                          onClick={() =>
                            setPendingDelete({
                              title: "Delete selected assets",
                              countLabel: `${selectedIds.size} asset${selectedIds.size === 1 ? "" : "s"}`,
                              description:
                                "This permanently deletes the selected assets and all of their inspections, defects, and photos. This cannot be undone.",
                              run: (token) => bulkDeleteAssets(token, Array.from(selectedIds)),
                            })
                          }
                        >
                          <Trash2 size={15} />
                          Delete selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                        </Tbtn>

                        {/* Bulk wipes (by Pencawang / by session) hit ADMIN-only API
                            endpoints, so keep them ADMIN-only in the UI too. */}
                        {isAdmin && mode === "leaf" && drill.pencawangId ? (
                          <>
                            <Tbtn
                              variant="danger"
                              disabled={assets.length === 0}
                              onClick={() => {
                                const pencawangId = drill.pencawangId;
                                if (!pencawangId) {
                                  return;
                                }
                                setPendingDelete({
                                  title: `Delete every asset in ${drill.pencawangName ?? "this Pencawang"}`,
                                  countLabel: `${assets.length} asset${assets.length === 1 ? "" : "s"}`,
                                  description:
                                    "This permanently deletes every asset in this Pencawang and all of their inspections, defects, and photos. This cannot be undone.",
                                  run: (token) => deleteAssetsBySubstation(token, pencawangId),
                                });
                              }}
                            >
                              <Trash2 size={15} />
                              Delete all in {drill.pencawangName ?? "Pencawang"}
                            </Tbtn>

                            <select
                              aria-label="Operational session to delete assets from"
                              value={sessionToDelete}
                              onChange={(event) => setSessionToDelete(event.target.value)}
                              className={filterSelectClass}
                            >
                              <option value="">Select a session…</option>
                              {sessions.map((sessionOption) => (
                                <option key={sessionOption.id} value={sessionOption.id}>
                                  {sessionOption.sessionNo} · {sessionOption.scope} · {sessionOption.status}
                                </option>
                              ))}
                            </select>

                            <Tbtn
                              variant="danger"
                              disabled={!sessionToDelete}
                              onClick={() => {
                                const sess = sessions.find((item) => item.id === sessionToDelete);
                                setPendingDelete({
                                  title: `Delete all assets in session ${sess?.sessionNo ?? ""}`.trim(),
                                  countLabel: "all assets in this session",
                                  description:
                                    "This permanently deletes every asset on this session's roster or inspected under it. Because assets are shared, each is removed everywhere — including ALL of its inspections, defects, photos, and links recorded under OTHER sessions and site visits. This cannot be undone.",
                                  run: (token) => deleteAssetsBySession(token, sessionToDelete),
                                });
                              }}
                            >
                              <Trash2 size={15} />
                              Delete session assets
                            </Tbtn>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {actionMessage ? (
                      <div className="border-b border-[var(--success-border)] bg-[var(--success-bg)] px-[18px] py-2.5 text-[12.5px] font-semibold text-[var(--success-text)]">
                        {actionMessage}
                      </div>
                    ) : null}

                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left">
                        <thead>
                          <tr className={`${tableHeadClass} border-b border-[var(--line2)]`}>
                            {canDeleteAssets ? (
                              <th className="w-10 px-3.5 py-2.5">
                                <input
                                  type="checkbox"
                                  aria-label="Select all on this page"
                                  checked={allVisibleSelected}
                                  onChange={toggleSelectAllVisible}
                                  className="h-4 w-4 cursor-pointer rounded border-[var(--line-strong)] accent-[var(--brand)]"
                                />
                              </th>
                            ) : null}
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              <SortButton
                                label="Asset Code"
                                sortKey="assetCode"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                              <div className="mt-1 text-[9.5px] font-medium normal-case tracking-normal text-[var(--muted-2)]">
                                No Tiang Rondaan
                              </div>
                            </th>
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              <SortButton
                                label="Asset Type"
                                sortKey="assetType"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              <SortButton
                                label="Feeder"
                                sortKey="feeder"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                            <th className={`${tableHeadCellClass} min-w-56`}>
                              <SortButton
                                label="Location"
                                sortKey="location"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                            <th className={`${tableHeadCellClass} min-w-52`}>
                              <SortButton
                                label="Pencawang Name"
                                sortKey="pencawangName"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              <SortButton
                                label="Inspection Status"
                                sortKey="inspectionStatus"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                            <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                              <SortButton
                                label="Date"
                                sortKey="date"
                                activeSortKey={sortKey}
                                direction={sortDirection}
                                onSort={handleSort}
                              />
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedAssets.map((asset) => (
                            <tr
                              key={asset.id}
                              tabIndex={0}
                              onClick={() => openAsset(asset.id)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openAsset(asset.id);
                                }
                              }}
                              className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--panel-muted)]`}
                              aria-label={`Open asset ${asset.assetCode}`}
                            >
                              {canDeleteAssets ? (
                                <td
                                  className="px-3.5 py-3 align-middle"
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${asset.assetCode}`}
                                    checked={selectedIds.has(asset.id)}
                                    onChange={() => toggleRow(asset.id)}
                                    className="h-4 w-4 cursor-pointer rounded border-[var(--line-strong)] accent-[var(--brand)]"
                                  />
                                </td>
                              ) : null}
                              <td className={`${tableMonoCellClass} whitespace-nowrap font-semibold`}>
                                {asset.assetCode}
                              </td>
                              <td className={`${tableCellClass} whitespace-nowrap`}>
                                {formatNullable(asset.assetType)}
                              </td>
                              <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                                {formatNullable(asset.feeder)}
                              </td>
                              <td className={tableCellClass}>
                                {formatNullable(asset.location)}
                              </td>
                              <td className={tableCellClass}>
                                {formatNullable(asset.pencawangName)}
                              </td>
                              <td className={`${tableCellClass} whitespace-nowrap`}>
                                <StatusBadge status={asset.inspectionStatus} />
                              </td>
                              <td className={`${tableMonoCellClass} whitespace-nowrap`}>
                                {formatDate(asset.date)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {paginatedAssets.length === 0 ? (
                        <div className="border-t border-[var(--line2)] px-5 py-12 text-center">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                            <SlidersHorizontal size={20} />
                          </div>
                          <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                            No assets found
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <TableFooter
                      summary={`Showing ${firstItemIndex}-${lastItemIndex} of ${sortedAssets.length}`}
                      page={currentPage}
                      pageCount={totalPages}
                      onPageChange={setPage}
                    >
                      <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
                        Rows
                        <select
                          value={pageSize}
                          onChange={(event) => setPageSize(Number(event.target.value))}
                          className={`${filterSelectClass} !h-[34px]`}
                        >
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </TableFooter>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        </div>
      </main>
      {pendingDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-[var(--shadow-card)]">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--critical-bg)] text-[var(--critical)]">
                <AlertTriangle size={20} />
              </span>
              <div className="min-w-0">
                <h2
                  className="text-[17px] font-bold leading-tight text-[var(--foreground)]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {pendingDelete.title}
                </h2>
                <p className="mt-1.5 text-[12.5px] font-semibold text-[var(--critical-text)]">
                  {pendingDelete.countLabel}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">
                  {pendingDelete.description}
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Tbtn onClick={() => setPendingDelete(null)} disabled={isDeleting}>
                Cancel
              </Tbtn>
              <Tbtn variant="danger" onClick={runPendingDelete} disabled={isDeleting}>
                {isDeleting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Trash2 size={16} />
                )}
                Delete
              </Tbtn>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

export function AssetsClient() {
  return (
    <AuthGuard>
      <AssetsContent />
    </AuthGuard>
  );
}
