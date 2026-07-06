"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bug,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { DailyTrendChart } from "@/components/daily-trend-chart";
import { MetricCard } from "@/components/metric-card";
import { SeverityDonut } from "@/components/severity-donut";
import { SimpleBarChart } from "@/components/simple-bar-chart";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchDashboardMetrics } from "@/lib/dashboard";
import type { AuthSession } from "@/types/auth";
import type { DashboardMetrics, DashboardPersona } from "@/types/dashboard";
import type { MaintenanceCategory } from "@/types/defects";

const AUTO_REFRESH_MS = 60000;

function DashboardLoading() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow-soft)]"
        />
      ))}
    </div>
  );
}

function recentDefectStatusClassName(status: string) {
  const normalizedStatus = status.toUpperCase();

  if (normalizedStatus === "OPEN") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (normalizedStatus === "CLOSED") {
    return "border-green-200 bg-green-50 text-green-700";
  }

  if (normalizedStatus === "RESOLVED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (normalizedStatus === "MONITORING") {
    return "border-violet-200 bg-violet-50 text-violet-700";
  }

  if (normalizedStatus === "IN_PROGRESS") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function recentDefectSeverityClassName(severity: string | null | undefined) {
  const normalizedSeverity = severity?.toUpperCase();

  if (normalizedSeverity === "CRITICAL") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (normalizedSeverity === "HIGH") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }

  if (normalizedSeverity === "MEDIUM") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (normalizedSeverity === "LOW") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
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

function formatSlaState(state: string | null | undefined) {
  if (!state) {
    return "Unknown";
  }

  return state
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMaintenanceCategory(category: MaintenanceCategory): string {
  if (category === "RENTIS") {
    return "Rentis";
  }
  if (category === "CAT_TIANG") {
    return "Cat Tiang";
  }
  return "Selenggaraan";
}

function MaintenanceCategoryChip({
  category,
}: {
  category?: MaintenanceCategory | null;
}) {
  if (!category) {
    return null;
  }
  return (
    <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
      {formatMaintenanceCategory(category)}
    </span>
  );
}

/** Persona-aware page heading — leads with the right frame per company type. */
function personaHeadline(persona: DashboardPersona): {
  eyebrow: string;
  title: string;
  subtitle: string;
} {
  const org = persona.organizationName?.trim();
  if (persona.kind === "MAINTENANCE") {
    return {
      eyebrow: "Maintenance Dashboard",
      title: org || "Maintenance Overview",
      subtitle:
        "Defects routed to your company — your backlog by severity, status and category.",
    };
  }
  if (persona.kind === "INSPECTION") {
    return {
      eyebrow: "Field Operations",
      title: org || "Field Operations",
      subtitle:
        "Your crews' survey & inspection output — daily throughput, visits and defects found.",
    };
  }
  return {
    eyebrow: "Operations Dashboard",
    title: "ASCURE Admin",
    subtitle: "Field visit, asset, and defect visibility across all operations.",
  };
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
      {hint ? <span className="text-sm text-[var(--muted)]">{hint}</span> : null}
    </div>
  );
}

function RecentDefects({ defects }: { defects: DashboardMetrics["recentDefects"] }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Recent Defects</h2>
        <span className="text-sm text-[var(--muted)]">{defects.length} latest</span>
      </div>

      <div className="mt-5 overflow-x-auto">
        {defects.length > 0 ? (
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Defect</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">SLA</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {defects.map((defect) => {
                const displayStatus = defect.status.replace(/_/g, " ");

                return (
                  <tr key={defect.id} className="transition hover:bg-teal-50/40">
                    <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                      {defect.assetCode}
                    </td>
                    <td className="min-w-64 px-4 py-4 text-slate-700">{defect.label}</td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${recentDefectSeverityClassName(defect.severity)}`}
                      >
                        {defect.severity ?? "UNSPECIFIED"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <MaintenanceCategoryChip category={defect.maintenanceCategory} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${recentDefectStatusClassName(defect.status)}`}
                      >
                        {displayStatus}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${
                          defect.isOverdue
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-slate-200 bg-slate-50 text-slate-600"
                        }`}
                      >
                        {formatSlaState(defect.slaState)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                      {formatDate(defect.dueDate)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                    {formatDate(defect.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
            No recent defects returned by the API.
          </div>
        )}
      </div>
    </section>
  );
}

function CriticalOverdueAlerts({
  defects,
}: {
  defects: DashboardMetrics["criticalOverdueAlerts"];
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-red-900">Critical Overdue Alerts</h2>
        <span className="text-sm font-semibold text-red-700">{defects.length} active</span>
      </div>

      <div className="mt-5 overflow-x-auto">
        {defects.length > 0 ? (
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-y border-red-200 bg-white/70 text-xs font-semibold uppercase text-red-800">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Defect</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-red-100">
              {defects.map((defect) => (
                <tr key={defect.id}>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-red-950">
                    {defect.assetCode}
                  </td>
                  <td className="min-w-64 px-4 py-4 text-red-900">{defect.label}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-red-800">
                    {defect.assignedTo || "Unassigned"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-red-800">
                    {formatDate(defect.dueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rounded-lg border border-dashed border-red-200 bg-white/70 px-4 py-8 text-center text-sm text-red-700">
            No critical defects are overdue.
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The persona-aware body of the dashboard. Every persona shares the same
 * building blocks (KPIs, charts, tables); `persona.kind` decides which lead and
 * in what order:
 *  - MAINTENANCE → defect backlog first (routed pool), no field-production block.
 *  - INSPECTION  → daily throughput + visits first, then assets/defects found.
 *  - OVERVIEW    → the full tenant picture (ADMIN / ASCURE).
 */
function DashboardSections({ metrics }: { metrics: DashboardMetrics }) {
  const { persona } = metrics;
  const overdueThreshold = metrics.operationalOverdueThresholdHours || 24;

  const dailyTrend = (
    <DailyTrendChart
      title="Daily inspection throughput"
      data={metrics.dailyInspectionTrend}
      emptyLabel="No submitted inspections in the last 7 days."
      unitLabel="assets inspected"
    />
  );

  const visitKpis = (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      <MetricCard
        title="Active Visits"
        value={metrics.activeVisits}
        detail={`Open field operations. Overdue threshold ${overdueThreshold}h.`}
        icon={Activity}
        tone={metrics.overdueVisits > 0 ? "warning" : "neutral"}
      />
      <MetricCard
        title="Completed Visits"
        value={metrics.completedVisits}
        detail="Visits completed by field teams."
        icon={CheckCircle2}
        tone="success"
      />
      <MetricCard
        title="Completion Rate"
        value={metrics.completionRate}
        suffix="%"
        detail="Completed visits across non-cancelled operations."
        icon={ShieldAlert}
        tone="success"
      />
    </div>
  );

  const visitCharts = (
    <div className="grid gap-6 xl:grid-cols-2">
      <SimpleBarChart
        title="Visits by Status"
        data={metrics.visitsByStatus}
        emptyLabel="No site visit status counts are available yet."
        tone="teal"
      />
      <SimpleBarChart
        title="Active Visits by Team"
        data={metrics.activeVisitsByTeam}
        emptyLabel="No active team counts are available yet."
        tone="amber"
      />
    </div>
  );

  const severityDonut = (
    <SeverityDonut
      title="Defects by Severity"
      data={metrics.defectsBySeverity}
      centerCaption="defects"
      emptyLabel="No defects recorded yet."
    />
  );
  const statusBar = (
    <SimpleBarChart
      title="Defects by Status"
      data={metrics.defectsByStatus}
      emptyLabel="No defect status counts yet."
      tone="rose"
    />
  );
  const categoryBar = (
    <SimpleBarChart
      title="Defects by Category"
      data={metrics.defectsByCategory}
      emptyLabel="No maintenance-category counts yet."
      tone="teal"
    />
  );
  const assigneeBar = (
    <SimpleBarChart
      title="Defects by Assignee"
      data={metrics.defectsByAssignee}
      emptyLabel="No assignments yet."
      tone="amber"
    />
  );
  const mainheadBar = (
    <SimpleBarChart
      title="Total Assets by Mainhead"
      data={metrics.assetsByMainhead}
      emptyLabel="No assets are attributed to a mainhead yet."
      tone="teal"
    />
  );
  const tables = (
    <>
      <CriticalOverdueAlerts defects={metrics.criticalOverdueAlerts} />
      <RecentDefects defects={metrics.recentDefects} />
    </>
  );

  // MAINTENANCE — lead with the routed-defect backlog; no field-production block.
  if (persona.kind === "MAINTENANCE") {
    return (
      <div className="space-y-6">
        <SectionHeading title="Defect backlog" hint="Routed to your company" />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title="Routed Defects"
            value={metrics.totalDefects}
            detail="Defects released to your maintenance company."
            icon={Wrench}
            tone="neutral"
          />
          <MetricCard
            title="Open Defects"
            value={metrics.openDefects}
            detail="Awaiting maintenance action or closure."
            icon={AlertTriangle}
            tone="danger"
          />
          <MetricCard
            title="Overdue"
            value={metrics.overdueDefects}
            detail="Past their due date and still open."
            icon={ShieldAlert}
            tone={metrics.overdueDefects > 0 ? "danger" : "success"}
          />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          {severityDonut}
          {statusBar}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          {categoryBar}
          {assigneeBar}
        </div>
        {tables}
      </div>
    );
  }

  // INSPECTION — field-production emphasis: throughput, visits, then output.
  if (persona.kind === "INSPECTION") {
    return (
      <div className="space-y-6">
        <SectionHeading title="Today" hint="Rolling 7-day throughput" />
        {dailyTrend}
        <SectionHeading title="Field visits" hint={`Overdue threshold ${overdueThreshold}h`} />
        {visitKpis}
        {visitCharts}
        <SectionHeading title="Assets & defects found" />
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title="Total Assets"
            value={metrics.totalAssets}
            detail="Assets your crews can see."
            icon={Archive}
            tone="neutral"
          />
          <MetricCard
            title="Inspections"
            value={metrics.totalInspections}
            detail="Inspections recorded by your teams."
            icon={ClipboardList}
            tone="neutral"
          />
          <MetricCard
            title="Open Defects"
            value={metrics.openDefects}
            detail="Defects your crews raised, still open."
            icon={AlertTriangle}
            tone="warning"
          />
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          {severityDonut}
          {mainheadBar}
        </div>
        {tables}
      </div>
    );
  }

  // OVERVIEW — the full tenant picture (ADMIN / ASCURE).
  return (
    <div className="space-y-6">
      <SectionHeading title="Today" hint="Rolling 7-day throughput" />
      {dailyTrend}
      <SectionHeading title="Field visits" hint={`Overdue threshold ${overdueThreshold}h`} />
      {visitKpis}
      {visitCharts}
      <SectionHeading title="Assets & defects" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="Total Assets"
          value={metrics.totalAssets}
          detail="Assets visible to the signed-in tenant."
          icon={Archive}
          tone="neutral"
        />
        <MetricCard
          title="Total Defects"
          value={metrics.totalDefects}
          detail="Open, in-progress, and closed defects."
          icon={Bug}
          tone="warning"
        />
        <MetricCard
          title="Open Defects"
          value={metrics.openDefects}
          detail="Defects awaiting action or closure."
          icon={AlertTriangle}
          tone="danger"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {mainheadBar}
        {severityDonut}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {categoryBar}
        {statusBar}
      </div>
      {tables}
    </div>
  );
}

function DashboardContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadDashboard = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");

      try {
        const nextMetrics = await fetchDashboardMetrics(token);
        setMetrics(nextMetrics);
      } catch (dashboardError) {
        if (dashboardError instanceof ApiError && dashboardError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          dashboardError instanceof Error ? dashboardError.message : "Unable to load dashboard.",
        );
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
      void loadDashboard(storedSession.token);
    }
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadDashboard(session.token, false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadDashboard, session?.token]);

  const persona = metrics?.persona ?? null;
  const headline = persona
    ? personaHeadline(persona)
    : {
        eyebrow: "Operations Dashboard",
        title: "ASCURE Admin",
        subtitle: "Field visit, asset, and defect visibility for utility operations.",
      };

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                {headline.eyebrow}
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {headline.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                {headline.subtitle}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  Auto-refresh 60s
                </label>
                {metrics?.latestVisitActivityAt ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                    Last activity {formatDate(metrics.latestVisitActivityAt)}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadDashboard(session.token, false) : undefined)}
              disabled={(isLoading && !metrics) || isRefreshing || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !metrics ? (
              <DashboardLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : metrics ? (
              <DashboardSections metrics={metrics} />
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function DashboardClient() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}
