"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
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
import { fetchDefectOperationsBoard } from "@/lib/defects";
import { fetchEnterpriseRows } from "@/lib/enterprise";
import type { AuthSession } from "@/types/auth";
import type {
  DefectLifecycleStatus,
  DefectOperationsBoardFilters,
  DefectOperationsBoardItem,
  DefectOperationsBoardQueue,
  DefectOperationsBoardQueueKey,
  DefectOperationsBoardResponse,
  DefectResolutionOutcome,
  DefectSeverity,
} from "@/types/defects";
import type { EnterpriseListRow } from "@/types/enterprise";

type FilterState = {
  mainhead: string;
  projectId: string;
  workPackageId: string;
  siteVisitId: string;
  severity: "" | DefectSeverity;
  status: "" | Exclude<DefectLifecycleStatus, "UNKNOWN">;
  resolutionOutcome: "" | Exclude<DefectResolutionOutcome, "UNKNOWN">;
  assignedToUserId: string;
  overdueOnly: boolean;
  q: string;
};

const DEFAULT_FILTERS: FilterState = {
  mainhead: "",
  projectId: "",
  workPackageId: "",
  siteVisitId: "",
  severity: "",
  status: "",
  resolutionOutcome: "",
  assignedToUserId: "",
  overdueOnly: false,
  q: "",
};

const SUMMARY_QUEUE_KEYS: DefectOperationsBoardQueueKey[] = [
  "awaitingQaQc",
  "maintenanceReady",
  "inMaintenance",
  "awaitingClosureVerification",
  "exceptions",
];
const EXCEPTION_GROUP_ITEMS = [
  "REJECTED",
  "EXTERNAL_CONSTRAINT",
  "DEFERRED",
  "TEMPORARY_FIX",
  "MONITORING_REQUIRED",
  "FALSE_POSITIVE",
  "DUPLICATE",
] as const;

const filterControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function toApiFilters(filters: FilterState): DefectOperationsBoardFilters {
  return {
    mainhead: filters.mainhead || undefined,
    projectId: filters.projectId || undefined,
    workPackageId: filters.workPackageId || undefined,
    siteVisitId: filters.siteVisitId || undefined,
    severity: filters.severity || undefined,
    status: filters.status || undefined,
    resolutionOutcome: filters.resolutionOutcome || undefined,
    assignedToUserId: filters.assignedToUserId || undefined,
    overdueOnly: filters.overdueOnly || undefined,
    q: filters.q || undefined,
  };
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

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "Not set";
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

function actorLabel(actor: DefectOperationsBoardItem["assignedToUser"]) {
  return actor?.name?.trim() || actor?.email?.trim() || null;
}

function teamLabel(team: DefectOperationsBoardItem["assignedToTeam"]) {
  return team?.name?.trim() || team?.code?.trim() || null;
}

function assignmentLabel(item: DefectOperationsBoardItem) {
  return item.assignedTo?.trim() || actorLabel(item.assignedToUser) || teamLabel(item.assignedToTeam) || "Unassigned";
}

function ownershipTrail(item: DefectOperationsBoardItem) {
  return [
    item.verifiedByUser ? `QA: ${actorLabel(item.verifiedByUser) ?? "Recorded"}` : null,
    item.maintainedByUser ? `Maint: ${actorLabel(item.maintainedByUser) ?? "Recorded"}` : null,
    item.closureVerifiedByUser
      ? `Close: ${actorLabel(item.closureVerifiedByUser) ?? "Recorded"}`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

function contextLabel(item: DefectOperationsBoardItem) {
  return [
    item.project?.code || item.project?.name,
    item.workPackage?.code || item.workPackage?.name,
    item.siteVisit?.substation?.code || item.siteVisit?.substation?.name,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

function severityClassName(severity: DefectSeverity | null) {
  if (severity === "CRITICAL") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (severity === "HIGH") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  if (severity === "MEDIUM") {
    return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }

  if (severity === "LOW") {
    return "border-green-200 bg-green-50 text-green-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function lifecycleClassName(status: DefectLifecycleStatus) {
  if (status === "REJECTED") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (status === "VERIFIED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "ASSIGNED" || status === "IN_PROGRESS") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  if (status === "COMPLETED" || status === "VERIFICATION_PENDING") {
    return "border-teal-200 bg-teal-50 text-teal-700";
  }

  if (status === "CLOSED") {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (status === "UNDER_REVIEW") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function outcomeClassName(outcome: DefectResolutionOutcome | null) {
  if (!outcome || outcome === "UNKNOWN") {
    return "border-slate-200 bg-slate-50 text-slate-500";
  }

  if (outcome === "RESOLVED" || outcome === "REPAIRED") {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (outcome === "EXTERNAL_CONSTRAINT" || outcome === "ESCALATED") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  if (
    outcome === "TEMPORARY_FIX" ||
    outcome === "MONITORING_REQUIRED" ||
    outcome === "PARTIAL" ||
    outcome === "DEFERRED" ||
    outcome === "MONITOR_ONLY"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {children}
    </span>
  );
}

function SlaBadge({ item }: { item: DefectOperationsBoardItem }) {
  const className = item.isOverdue
    ? "border-red-200 bg-red-50 text-red-700"
    : item.slaState === "ON_TRACK"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : item.slaState === "STOPPED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {item.isOverdue ? <AlertTriangle size={13} /> : null}
      {formatEnumLabel(item.slaState)}
    </span>
  );
}

function BoardLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]" />
    </div>
  );
}

function SummaryCard({ queue }: { queue: DefectOperationsBoardQueue }) {
  const isException = queue.key === "exceptions";
  const iconClassName = isException ? "text-red-600" : "text-[var(--brand)]";
  const Icon = isException
    ? AlertTriangle
    : queue.key === "awaitingClosureVerification"
      ? CheckCircle2
      : Clock3;

  return (
    <div className={`rounded-lg border bg-white p-4 shadow-[var(--shadow-soft)] ${isException ? "border-red-200" : "border-[var(--line)]"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-slate-500">{queue.title}</p>
        <Icon size={18} className={iconClassName} />
      </div>
      <p className="mt-3 text-3xl font-bold text-slate-950">{queue.count}</p>
      <p className="mt-2 line-clamp-2 text-xs text-[var(--muted)]">{queue.description}</p>
    </div>
  );
}

function MainheadRollup({
  board,
  onSelectMainhead,
}: {
  board: DefectOperationsBoardResponse;
  onSelectMainhead: (mainhead: string) => void;
}) {
  if (board.mainheads.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">MAINHEAD Rollup</h2>
          <p className="text-sm text-[var(--muted)]">{board.mainheads.length} active governance groupings</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
              <th className="px-5 py-3">MAINHEAD</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">QA/QC</th>
              <th className="px-5 py-3">Maint. Ready</th>
              <th className="px-5 py-3">In Maint.</th>
              <th className="px-5 py-3">Closure</th>
              <th className="px-5 py-3">Exceptions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {board.mainheads.map((group) => {
              const counts = new Map(group.queues.map((queue) => [queue.key, queue.count]));
              const mainheadFilter = group.mainhead.id ?? group.mainhead.code ?? group.mainhead.label;

              return (
                <tr
                  key={mainheadFilter}
                  className="cursor-pointer transition hover:bg-teal-50/40"
                  onClick={() => onSelectMainhead(mainheadFilter)}
                >
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-slate-950">
                    {group.mainhead.label}
                  </td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{group.count}</td>
                  <td className="px-5 py-3 text-slate-600">{counts.get("awaitingQaQc") ?? 0}</td>
                  <td className="px-5 py-3 text-slate-600">{counts.get("maintenanceReady") ?? 0}</td>
                  <td className="px-5 py-3 text-slate-600">{counts.get("inMaintenance") ?? 0}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {counts.get("awaitingClosureVerification") ?? 0}
                  </td>
                  <td className="px-5 py-3 font-semibold text-red-700">{counts.get("exceptions") ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QueueSection({
  queue,
  onOpenDefect,
}: {
  queue: DefectOperationsBoardQueue;
  onOpenDefect: (defectId: string) => void;
}) {
  const defaultOpen = queue.key !== "closedResolved" || queue.count > 0;

  return (
    <details open={defaultOpen} className="rounded-lg border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{queue.title}</h2>
          <p className="text-sm text-[var(--muted)]">{queue.description}</p>
          {queue.key === "exceptions" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {EXCEPTION_GROUP_ITEMS.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                >
                  {formatEnumLabel(item)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-semibold text-slate-700">
          {queue.count}
        </span>
      </summary>

      <div className="border-t border-slate-200">
        {queue.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                  <th className="min-w-72 px-5 py-3">Defect</th>
                  <th className="px-5 py-3">Lifecycle</th>
                  <th className="px-5 py-3">Outcome</th>
                  <th className="px-5 py-3">Ownership</th>
                  <th className="px-5 py-3">Context</th>
                  <th className="px-5 py-3">Due / SLA</th>
                  <th className="px-5 py-3">Detected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queue.items.map((item) => {
                  const highlightClassName = item.isOverdue
                    ? "bg-red-50/45 hover:bg-red-50"
                    : item.severity === "CRITICAL"
                      ? "bg-orange-50/35 hover:bg-orange-50"
                      : "hover:bg-teal-50/40";

                  return (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      onClick={() => onOpenDefect(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenDefect(item.id);
                        }
                      }}
                      className={`cursor-pointer outline-none transition focus-visible:bg-teal-50/60 ${highlightClassName}`}
                      aria-label={`Open defect ${item.title} for ${item.assetCode}`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-950">{item.assetCode}</span>
                          <Badge className={severityClassName(item.severity)}>
                            {item.severity ?? "UNSPECIFIED"}
                          </Badge>
                        </div>
                        <div className="mt-1 font-medium text-slate-800">{item.title}</div>
                        {item.summary ? (
                          <div className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">
                            {item.summary}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <Badge className={lifecycleClassName(item.status)}>
                          {formatEnumLabel(item.status)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        {item.resolutionOutcome ? (
                          <Badge className={outcomeClassName(item.resolutionOutcome)}>
                            {formatEnumLabel(item.resolutionOutcome)}
                          </Badge>
                        ) : (
                          <span className="text-sm text-[var(--muted)]">Not recorded</span>
                        )}
                      </td>
                      <td className="min-w-56 px-5 py-4">
                        <div className="font-medium text-slate-800">{assignmentLabel(item)}</div>
                        {ownershipTrail(item) ? (
                          <div className="mt-1 text-xs text-[var(--muted)]">{ownershipTrail(item)}</div>
                        ) : null}
                      </td>
                      <td className="min-w-64 px-5 py-4">
                        <div className="font-medium text-slate-800">{item.mainheadLabel}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {contextLabel(item) || "Context not recorded"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <div className="flex flex-col items-start gap-2">
                          <span className="text-sm text-slate-700">{formatDate(item.dueDate)}</span>
                          <SlaBadge item={item} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                        {formatDate(item.detectedAt ?? item.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">
            No defects in this queue.
          </div>
        )}
      </div>
    </details>
  );
}

function OperationsBoardContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [board, setBoard] = useState<DefectOperationsBoardResponse | null>(null);
  const [mainheads, setMainheads] = useState<EnterpriseListRow[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadBoard = useCallback(
    async (token: string, nextFilters: FilterState) => {
      setIsLoading(true);
      setError("");

      try {
        setBoard(await fetchDefectOperationsBoard(token, toApiFilters(nextFilters)));
      } catch (boardError) {
        if (boardError instanceof ApiError && boardError.status === 401) {
          handleLogout();
          return;
        }

        setError(boardError instanceof Error ? boardError.message : "Unable to load operations board.");
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
      return;
    }

    void fetchEnterpriseRows(storedSession.token, "mainheads")
      .then(setMainheads)
      .catch(() => setMainheads([]));
  }, []);

  useEffect(() => {
    if (!session?.token) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadBoard(session.token, filters);
    }, filters.q ? 300 : 0);

    return () => window.clearTimeout(timeoutId);
  }, [filters, loadBoard, session?.token]);

  const assignedUserOptions = useMemo(() => {
    const options = new Map<string, string>();

    board?.queues.forEach((queue) => {
      queue.items.forEach((item) => {
        if (!item.assignedToUserId) {
          return;
        }

        options.set(item.assignedToUserId, actorLabel(item.assignedToUser) ?? item.assignedTo ?? "Assigned user");
      });
    });

    return Array.from(options.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], "en", { sensitivity: "base" }),
    );
  }, [board]);

  const summaryQueues = useMemo(
    () => board?.queues.filter((queue) => SUMMARY_QUEUE_KEYS.includes(queue.key)) ?? [],
    [board],
  );

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
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
                MAINHEAD Operational Board
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Operations Board
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {session?.user?.role === "ADMIN" ? "Full access" : "Read-only"}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {board?.totalCount ?? 0} matching defects
                </span>
                {board?.generatedAt ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                    Updated {formatDate(board.generatedAt)}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadBoard(session.token, filters) : undefined)}
              disabled={isLoading || !session?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <section className="mt-6 rounded-lg border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-soft)]">
            <div className="grid gap-3 lg:grid-cols-12">
              <label className="block lg:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">MAINHEAD</span>
                <select
                  value={filters.mainhead}
                  onChange={(event) => updateFilter("mainhead", event.target.value)}
                  className={filterControlClassName}
                >
                  <option value="">All MAINHEADs</option>
                  {mainheads.map((mainhead) => (
                    <option key={mainhead.id} value={mainhead.id}>
                      {mainhead.code ? `${mainhead.code} - ${mainhead.name}` : mainhead.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="relative block lg:col-span-4">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Search</span>
                <Search
                  size={17}
                  className="pointer-events-none absolute left-3 top-[34px] text-slate-400"
                />
                <input
                  type="search"
                  value={filters.q}
                  onChange={(event) => updateFilter("q", event.target.value)}
                  placeholder="Asset, defect, site, assignee"
                  className={searchControlClassName}
                />
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Severity</span>
                <select
                  value={filters.severity}
                  onChange={(event) => updateFilter("severity", event.target.value as FilterState["severity"])}
                  className={filterControlClassName}
                >
                  <option value="">All severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Lifecycle</span>
                <select
                  value={filters.status}
                  onChange={(event) => updateFilter("status", event.target.value as FilterState["status"])}
                  className={filterControlClassName}
                >
                  <option value="">All statuses</option>
                  <option value="DETECTED">Detected</option>
                  <option value="UNDER_REVIEW">Under Review</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="ASSIGNED">Assigned</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="VERIFICATION_PENDING">Verification Pending</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </label>

              <label className="inline-flex h-10 items-center gap-2 self-end rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] lg:col-span-1">
                <input
                  type="checkbox"
                  checked={filters.overdueOnly}
                  onChange={(event) => updateFilter("overdueOnly", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                />
                SLA
              </label>

              <label className="block lg:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Outcome</span>
                <select
                  value={filters.resolutionOutcome}
                  onChange={(event) =>
                    updateFilter("resolutionOutcome", event.target.value as FilterState["resolutionOutcome"])
                  }
                  className={filterControlClassName}
                >
                  <option value="">All outcomes</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="TEMPORARY_FIX">Temporary Fix</option>
                  <option value="MONITORING_REQUIRED">Monitoring Required</option>
                  <option value="EXTERNAL_CONSTRAINT">External Constraint</option>
                  <option value="DUPLICATE">Duplicate</option>
                  <option value="FALSE_POSITIVE">False Positive</option>
                  <option value="DEFERRED">Deferred</option>
                </select>
              </label>

              <label className="block lg:col-span-3">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Assigned User</span>
                <select
                  value={filters.assignedToUserId}
                  onChange={(event) => updateFilter("assignedToUserId", event.target.value)}
                  className={filterControlClassName}
                >
                  <option value="">All users</option>
                  {assignedUserOptions.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Project ID</span>
                <input
                  value={filters.projectId}
                  onChange={(event) => updateFilter("projectId", event.target.value)}
                  className={filterControlClassName}
                />
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Work Package ID</span>
                <input
                  value={filters.workPackageId}
                  onChange={(event) => updateFilter("workPackageId", event.target.value)}
                  className={filterControlClassName}
                />
              </label>

              <label className="block lg:col-span-1">
                <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Visit ID</span>
                <input
                  value={filters.siteVisitId}
                  onChange={(event) => updateFilter("siteVisitId", event.target.value)}
                  className={filterControlClassName}
                />
              </label>

              <button
                type="button"
                onClick={resetFilters}
                className={`${secondaryButtonClassName} self-end lg:col-span-1`}
              >
                <X size={16} />
                Reset
              </button>
            </div>
          </section>

          <div className="mt-6">
            {isLoading && !board ? (
              <BoardLoading />
            ) : error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : board ? (
              <div className="space-y-5">
                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {summaryQueues.map((queue) => (
                    <SummaryCard key={queue.key} queue={queue} />
                  ))}
                </section>

                <MainheadRollup
                  board={board}
                  onSelectMainhead={(mainhead) => updateFilter("mainhead", mainhead)}
                />

                <div className="space-y-4">
                  {board.queues.map((queue) => (
                    <QueueSection key={queue.key} queue={queue} onOpenDefect={openDefect} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500">
                  <SlidersHorizontal size={20} />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-900">No board data returned</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function OperationsBoardClient() {
  return (
    <AuthGuard>
      <OperationsBoardContent />
    </AuthGuard>
  );
}
