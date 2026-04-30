"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
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
import { fetchAssets } from "@/lib/assets";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";
import type { AssetInspectionStatus, AssetListItem } from "@/types/assets";

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
const filterControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]";
const paginationButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function AssetsLoading() {
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
  const className =
    status === "COMPLETED"
      ? "border-green-200 bg-green-50 text-green-700"
      : "border-yellow-200 bg-yellow-50 text-yellow-800";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatInspectionStatus(status)}
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

  useEffect(() => {
    setPage(1);
  }, [search, assetTypeFilter, feederFilter, pencawangFilter, startDate, endDate, pageSize]);

  const assetTypeOptions = useMemo(() => uniqueOptions(assets, "assetType"), [assets]);
  const feederOptions = useMemo(() => uniqueOptions(assets, "feeder"), [assets]);
  const pencawangOptions = useMemo(() => uniqueOptions(assets, "pencawangName"), [assets]);

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
    setAssetTypeFilter("ALL");
    setFeederFilter("ALL");
    setPencawangFilter("ALL");
    setStartDate("");
    setEndDate("");
  }

  function openAsset(assetId: string) {
    router.push(`/assets/${encodeURIComponent(assetId)}`);
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Asset Table
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Assets
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {assets.length} total
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadAssets(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && assets.length === 0 ? (
              <AssetsLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(140px,auto))_auto]">
                    <label className="relative block">
                      <span className="sr-only">Search assets</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search assets"
                        className={searchControlClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">Asset Type</span>
                      <select
                        value={assetTypeFilter}
                        onChange={(event) => setAssetTypeFilter(event.target.value)}
                        className={filterControlClassName}
                      >
                        <option value="ALL">All asset types</option>
                        {assetTypeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Feeder</span>
                      <select
                        value={feederFilter}
                        onChange={(event) => setFeederFilter(event.target.value)}
                        className={filterControlClassName}
                      >
                        <option value="ALL">All feeders</option>
                        {feederOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">Pencawang</span>
                      <select
                        value={pencawangFilter}
                        onChange={(event) => setPencawangFilter(event.target.value)}
                        className={filterControlClassName}
                      >
                        <option value="ALL">All pencawang</option>
                        {pencawangOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
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
                          <div className="mt-1 text-[10px] font-semibold normal-case tracking-normal text-slate-400">
                            No Tiang Rondaan
                          </div>
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Asset Type"
                            sortKey="assetType"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Feeder"
                            sortKey="feeder"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="min-w-56 px-5 py-3.5">
                          <SortButton
                            label="Location"
                            sortKey="location"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="min-w-52 px-5 py-3.5">
                          <SortButton
                            label="Pencawang Name"
                            sortKey="pencawangName"
                            activeSortKey={sortKey}
                            direction={sortDirection}
                            onSort={handleSort}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3.5">
                          <SortButton
                            label="Inspection Status"
                            sortKey="inspectionStatus"
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
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
                          className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                          aria-label={`Open asset ${asset.assetCode}`}
                        >
                          <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                            {asset.assetCode}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                            {formatNullable(asset.assetType)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-700">
                            {formatNullable(asset.feeder)}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {formatNullable(asset.location)}
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            {formatNullable(asset.pencawangName)}
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <StatusBadge status={asset.inspectionStatus} />
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                            {formatDate(asset.date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {paginatedAssets.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        No assets found
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-[var(--muted)]">
                    Showing {firstItemIndex}-{lastItemIndex} of {sortedAssets.length}
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
            )}
          </div>
        </div>
      </main>
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
