"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  FolderKanban,
  Network,
  PackageCheck,
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
import { fetchEnterpriseRows } from "@/lib/enterprise";
import type { AuthSession } from "@/types/auth";
import type {
  EnterpriseEntityKind,
  EnterpriseListRow,
  EnterpriseTone,
} from "@/types/enterprise";

type FilterValue = "ALL" | string;

const PAGE_CONFIG: Record<
  EnterpriseEntityKind,
  {
    eyebrow: string;
    title: string;
    basePath: string;
    searchPlaceholder: string;
    primaryFilterLabel: string;
    groupFilterLabel: string;
    extraFilterLabel?: string;
    emptyLabel: string;
    icon: typeof Building2;
  }
> = {
  organizations: {
    eyebrow: "Enterprise Visibility",
    title: "Organizations",
    basePath: "/organizations",
    searchPlaceholder: "Search organizations",
    primaryFilterLabel: "All types",
    groupFilterLabel: "All states",
    extraFilterLabel: "All capabilities",
    emptyLabel: "No organizations found",
    icon: Building2,
  },
  mainheads: {
    eyebrow: "Enterprise Visibility",
    title: "MAINHEAD",
    basePath: "/mainheads",
    searchPlaceholder: "Search MAINHEAD",
    primaryFilterLabel: "All states",
    groupFilterLabel: "All branches",
    emptyLabel: "No MAINHEAD records found",
    icon: Network,
  },
  projects: {
    eyebrow: "Enterprise Visibility",
    title: "Projects",
    basePath: "/projects",
    searchPlaceholder: "Search projects",
    primaryFilterLabel: "All statuses",
    groupFilterLabel: "All branches",
    extraFilterLabel: "All domains",
    emptyLabel: "No projects found",
    icon: FolderKanban,
  },
  "work-packages": {
    eyebrow: "Enterprise Visibility",
    title: "Work Packages",
    basePath: "/work-packages",
    searchPlaceholder: "Search work packages",
    primaryFilterLabel: "All statuses",
    groupFilterLabel: "All MAINHEAD",
    extraFilterLabel: "All domains",
    emptyLabel: "No work packages found",
    icon: PackageCheck,
  },
};

const inputClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function toneClassName(tone: EnterpriseTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (tone === "info") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function Chip({ label, tone }: { label: string | null; tone: EnterpriseTone }) {
  if (!label) {
    return null;
  }

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClassName(tone)}`}>
      {label}
    </span>
  );
}

function formatDate(date: string | null) {
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
    year: "numeric",
  }).format(parsedDate);
}

function uniqueOptions(
  rows: EnterpriseListRow[],
  selector: (row: EnterpriseListRow) => string | string[] | null,
) {
  return Array.from(
    new Set(
      rows
        .flatMap((row) => {
          const value = selector(row);

          return Array.isArray(value) ? value : [value];
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
}

function EnterpriseLoading() {
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

function EnterpriseListContent({ kind }: { kind: EnterpriseEntityKind }) {
  const router = useRouter();
  const config = PAGE_CONFIG[kind];
  const Icon = config.icon;
  const [session, setSession] = useState<AuthSession | null>(null);
  const [rows, setRows] = useState<EnterpriseListRow[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [primaryFilter, setPrimaryFilter] = useState<FilterValue>("ALL");
  const [groupFilter, setGroupFilter] = useState<FilterValue>("ALL");
  const [extraFilter, setExtraFilter] = useState<FilterValue>("ALL");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadRows = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextRows = await fetchEnterpriseRows(token, kind);
        setRows(nextRows);
      } catch (listError) {
        if (listError instanceof ApiError && listError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          listError instanceof Error ? listError.message : "Unable to load enterprise data.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout, kind],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadRows(storedSession.token);
    } else {
      setIsLoading(false);
    }
  }, [loadRows]);

  const primaryOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.primaryChip),
    [rows],
  );
  const groupOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.filterGroup),
    [rows],
  );
  const extraOptions = useMemo(
    () => uniqueOptions(rows, (row) => row.extraFilterGroups),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !normalizedSearch || row.searchText.includes(normalizedSearch);
      const matchesPrimary =
        primaryFilter === "ALL" || row.primaryChip === primaryFilter;
      const matchesGroup =
        groupFilter === "ALL" || row.filterGroup === groupFilter;
      const matchesExtra =
        extraFilter === "ALL" || row.extraFilterGroups.includes(extraFilter);

      return matchesSearch && matchesPrimary && matchesGroup && matchesExtra;
    });
  }, [extraFilter, groupFilter, primaryFilter, rows, search]);

  function resetFilters() {
    setSearch("");
    setPrimaryFilter("ALL");
    setGroupFilter("ALL");
    setExtraFilter("ALL");
  }

  function openDetail(rowId: string) {
    router.push(`${config.basePath}/${encodeURIComponent(rowId)}`);
  }

  const filterGridClassName = config.extraFilterLabel
    ? "grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(3,minmax(150px,auto))_auto]"
    : "grid gap-3 md:grid-cols-[minmax(220px,1fr)_repeat(2,minmax(150px,auto))_auto]";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                {config.eyebrow}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {config.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  Read-only
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {rows.length} total
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadRows(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && rows.length === 0 ? (
              <EnterpriseLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <div className="border-b border-slate-200 p-5">
                  <div className={filterGridClassName}>
                    <label className="relative block">
                      <span className="sr-only">{config.searchPlaceholder}</span>
                      <Search
                        size={17}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={config.searchPlaceholder}
                        className={searchClassName}
                      />
                    </label>

                    <label className="block">
                      <span className="sr-only">{config.primaryFilterLabel}</span>
                      <select
                        value={primaryFilter}
                        onChange={(event) => setPrimaryFilter(event.target.value)}
                        className={inputClassName}
                      >
                        <option value="ALL">{config.primaryFilterLabel}</option>
                        {primaryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="sr-only">{config.groupFilterLabel}</span>
                      <select
                        value={groupFilter}
                        onChange={(event) => setGroupFilter(event.target.value)}
                        className={inputClassName}
                      >
                        <option value="ALL">{config.groupFilterLabel}</option>
                        {groupOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    {config.extraFilterLabel ? (
                      <label className="block">
                        <span className="sr-only">{config.extraFilterLabel}</span>
                        <select
                          value={extraFilter}
                          onChange={(event) => setExtraFilter(event.target.value)}
                          className={inputClassName}
                        >
                          <option value="ALL">{config.extraFilterLabel}</option>
                          {extraOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <button type="button" onClick={resetFilters} className={secondaryButtonClassName}>
                      <X size={16} />
                      Reset
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                        <th className="w-[34%] px-5 py-3.5 font-semibold">Name</th>
                        <th className="w-[18%] px-5 py-3.5 font-semibold">Status</th>
                        <th className="w-[24%] px-5 py-3.5 font-semibold">Scope</th>
                        <th className="w-[16%] px-5 py-3.5 font-semibold">Counts</th>
                        <th className="w-[8%] px-5 py-3.5 text-right font-semibold">Open</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          onClick={() => openDetail(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openDetail(row.id);
                            }
                          }}
                          className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                        >
                          <td className="px-5 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
                                <Icon size={17} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">
                                  {row.name}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-[var(--muted)]">
                                  {row.code ?? "Code not recorded"}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <Chip label={row.primaryChip} tone={row.primaryTone} />
                              <Chip label={row.secondaryChip} tone={row.secondaryTone} />
                            </div>
                          </td>
                          <td className="px-5 py-4 text-slate-700">
                            <div className="line-clamp-2">{row.relationLabel}</div>
                            <div className="mt-1 text-xs text-[var(--muted)]">
                              Updated {formatDate(row.updatedAt)}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              {row.metrics.map((metric) => (
                                <span
                                  key={metric.label}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700"
                                >
                                  {metric.value} {metric.label}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-right text-slate-500">
                            <ChevronRight size={17} className="ml-auto" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {filteredRows.length === 0 ? (
                    <div className="border-t border-slate-100 px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-slate-900">
                        {config.emptyLabel}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-200 px-5 py-4 text-sm text-[var(--muted)]">
                  Showing {filteredRows.length} of {rows.length}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function EnterpriseListClient({ kind }: { kind: EnterpriseEntityKind }) {
  return (
    <AuthGuard>
      <EnterpriseListContent kind={kind} />
    </AuthGuard>
  );
}
