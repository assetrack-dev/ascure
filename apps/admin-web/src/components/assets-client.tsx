"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  ChevronsUpDown,
  CircleCheckBig,
  Clock,
  Loader2,
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
import {
  bulkDeleteAssets,
  deleteAssetsBySession,
  deleteAssetsBySubstation,
  fetchAssets,
  type DeleteAssetsResult,
} from "@/lib/assets";
import { fetchOperationalSessions } from "@/lib/operational-sessions";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";
import type { AssetInspectionStatus, AssetListItem } from "@/types/assets";
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

function uniqueOptions(assets: AssetListItem[], key: "assetType" | "feeder" | "pencawangName") {
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

function AssetsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("ALL");
  const [feederFilter, setFeederFilter] = useState("ALL");
  const [pencawangFilter, setPencawangFilter] = useState("ALL");
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

  const loadAssets = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextAssets = await fetchAssets(token);
        setAssets(nextAssets);
        setSelectedIds(new Set());
      } catch (assetsError) {
        if (assetsError instanceof ApiError && assetsError.status === 401) {
          handleLogout();
          return;
        }

        setError(assetsError instanceof Error ? assetsError.message : "Unable to load assets.");
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
      void loadAssets(storedSession.token);
    }
  }, [loadAssets]);

  // Sessions populate the ADMIN "delete all in session" dropdown.
  useEffect(() => {
    if (!session?.token || session.user?.role !== "ADMIN") {
      return;
    }
    fetchOperationalSessions(session.token)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [session?.token, session?.user?.role]);

  useEffect(() => {
    setPage(1);
  }, [search, assetTypeFilter, feederFilter, pencawangFilter, startDate, endDate, pageSize]);

  const assetTypeOptions = useMemo(() => uniqueOptions(assets, "assetType"), [assets]);
  const feederOptions = useMemo(() => uniqueOptions(assets, "feeder"), [assets]);
  const pencawangOptions = useMemo(() => uniqueOptions(assets, "pencawangName"), [assets]);
  // Every asset in the currently-selected Pencawang (ignores the other filters).
  const pencawangAssets = useMemo(
    () =>
      pencawangFilter === "ALL"
        ? []
        : assets.filter((asset) => asset.pencawangName === pencawangFilter),
    [assets, pencawangFilter],
  );

  // KPI strip — derived from the assets already in memory, no extra request.
  const inspectedCount = useMemo(
    () => assets.filter((asset) => asset.inspectionStatus === "COMPLETED").length,
    [assets],
  );
  const pendingCount = useMemo(
    () => assets.filter((asset) => asset.inspectionStatus === "PENDING").length,
    [assets],
  );

  const filteredAssets = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);

    return assets.filter((asset) => {
      const assetDate = toDateInputValue(asset.date);
      const matchesAssetType =
        assetTypeFilter === "ALL" || asset.assetType === assetTypeFilter;
      const matchesFeeder = feederFilter === "ALL" || asset.feeder === feederFilter;
      const matchesPencawang =
        pencawangFilter === "ALL" || asset.pencawangName === pencawangFilter;
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
        matchesPencawang &&
        matchesStartDate &&
        matchesEndDate &&
        matchesSearch
      );
    });
  }, [
    assets,
    assetTypeFilter,
    endDate,
    feederFilter,
    pencawangFilter,
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
    setPencawangFilter("ALL");
    setStartDate("");
    setEndDate("");
  }

  function openAsset(assetId: string) {
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
      await loadAssets(session.token); // also clears the selection
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

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Asset Registry"
            title="Assets"
            subtitle="Every pole and structure in your scope, with the feeder it hangs off and the state of its latest inspection."
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
                <Chip tone="neutral">{assets.length} total</Chip>
              </>
            }
            actions={
              <Tbtn
                onClick={() => (session?.token ? loadAssets(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6">
            {isLoading && assets.length === 0 ? (
              <AssetsLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Assets in scope"
                    value={assets.length}
                    icon={Boxes}
                    context={`Across ${pencawangOptions.length} Pencawang`}
                  />
                  <KpiCard
                    label="Inspected"
                    value={inspectedCount}
                    icon={CircleCheckBig}
                    tone="success"
                    context={`${percentOf(inspectedCount, assets.length)}% of assets in scope`}
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

                <Card padded={false} className="mt-4">
                  <div className="border-b border-[var(--line2)] p-[18px]">
                    <FilterBar>
                      <SearchField
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search assets"
                        aria-label="Search assets"
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

                      <select
                        aria-label="Pencawang"
                        value={pencawangFilter}
                        onChange={(event) => setPencawangFilter(event.target.value)}
                        className={filterSelectClass}
                      >
                        <option value="ALL">All pencawang</option>
                        {pencawangOptions.map((option) => (
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

                  {/* Destructive actions keep their own strip *below* the filter bar:
                      "Delete all in {Pencawang}" reads the Pencawang filter, so it has to
                      sit under it. The design puts a single "Bulk delete" in the page
                      header — but there are three flows here, and parking three red
                      buttons next to Refresh invites a misclick. */}
                  {canDeleteAssets ? (
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
                          endpoints, so keep them ADMIN-only in the UI too — a Main
                          Contractor manager gets "Delete selected" (scoped) only. */}
                      {isAdmin ? (
                        <>
                      <Tbtn
                        variant="danger"
                        disabled={pencawangFilter === "ALL" || pencawangAssets.length === 0}
                        onClick={() => {
                          // Substation.name isn't unique (@@unique is [tenantId, code]),
                          // so a Pencawang name can span >1 substation. Only use the fast
                          // by-substation delete when they all share one substationId; else
                          // delete by explicit ids so we don't under-delete vs. the count.
                          const distinctSubstationIds = Array.from(
                            new Set(
                              pencawangAssets
                                .map((asset) => asset.substationId)
                                .filter((id): id is string => Boolean(id)),
                            ),
                          );
                          const singleSubstationId =
                            distinctSubstationIds.length === 1 ? distinctSubstationIds[0] : null;
                          setPendingDelete({
                            title: `Delete every asset in ${pencawangFilter}`,
                            countLabel: `${pencawangAssets.length} asset${pencawangAssets.length === 1 ? "" : "s"}`,
                            description:
                              "This permanently deletes every asset in this Pencawang and all of their inspections, defects, and photos. This cannot be undone.",
                            run: (token) =>
                              singleSubstationId
                                ? deleteAssetsBySubstation(token, singleSubstationId)
                                : bulkDeleteAssets(
                                    token,
                                    pencawangAssets.map((asset) => asset.id),
                                  ),
                          });
                        }}
                        title={
                          pencawangFilter === "ALL"
                            ? "Choose a Pencawang in the filter above first"
                            : undefined
                        }
                      >
                        <Trash2 size={15} />
                        {pencawangFilter === "ALL"
                          ? "Delete all in Pencawang"
                          : `Delete all in ${pencawangFilter}`}
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
