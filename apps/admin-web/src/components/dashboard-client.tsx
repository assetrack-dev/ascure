"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bug,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Gauge as GaugeIcon,
  RefreshCw,
  ShieldAlert,
  Siren,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { SeverityDonut } from "@/components/severity-donut";
import { SimpleBarChart } from "@/components/simple-bar-chart";
import {
  Card,
  CardHead,
  Chip,
  KpiCard,
  PageHeader,
  Seg,
  Tbtn,
  type SegOption,
  type Tone,
} from "@/components/ui";
import { AreaChart, DeltaChip, DualLineChart, Gauge } from "@/components/charts";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchDashboardMetrics } from "@/lib/dashboard";
import type { AuthSession } from "@/types/auth";
import type {
  DashboardMetrics,
  DashboardPersona,
  DashboardRangeKey,
} from "@/types/dashboard";
import type { MaintenanceCategory } from "@/types/defects";

const AUTO_REFRESH_MS = 60000;

const RANGE_OPTIONS: SegOption<DashboardRangeKey>[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "ytd", label: "YTD" },
];

function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="h-56 animate-pulse rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-soft)]"
          />
        ))}
      </div>
    </div>
  );
}

function severityTone(severity: string | null | undefined): Tone {
  const normalized = severity?.toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH") return "high";
  if (normalized === "MEDIUM") return "warning";
  if (normalized === "LOW") return "success";
  return "neutral";
}

function defectStatusTone(status: string): Tone {
  const normalized = status.toUpperCase();
  if (normalized === "OPEN") return "critical";
  if (normalized === "CLOSED" || normalized === "RESOLVED") return "success";
  if (normalized === "MONITORING") return "monitor";
  if (normalized === "IN_PROGRESS") return "info";
  return "neutral";
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

function formatMaintenanceCategory(category: MaintenanceCategory): string {
  if (category === "RENTIS") return "Rentis";
  if (category === "CAT_TIANG") return "Cat Tiang";
  return "Selenggaraan";
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
      subtitle: "Defects routed to your company — your backlog by severity, status and category.",
    };
  }
  if (persona.kind === "INSPECTION") {
    return {
      eyebrow: "Field Operations",
      title: org || "Field Operations",
      subtitle: "Your crews' survey & inspection output — daily throughput, visits and defects found.",
    };
  }
  return {
    eyebrow: "Operations Dashboard",
    title: org || "ASCURE Admin",
    subtitle: "Field visit, asset, and defect visibility across all operations.",
  };
}

/** A titled chart/table surface — Card + CardHead in one. */
function Panel({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHead title={title} hint={hint} actions={actions} />
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function EmergencyAlertBar({ metrics }: { metrics: DashboardMetrics }) {
  const unassigned = metrics.emergencyUnassigned;
  if (unassigned <= 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-gradient-to-r from-[var(--danger-tint)] to-[var(--panel)] p-[18px] shadow-[var(--shadow-card)]">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--critical-border)] bg-[var(--panel)] text-[var(--critical)] shadow-[var(--shadow-soft)]">
        <Siren size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-[var(--critical-text)]" style={{ fontFamily: "var(--font-display)" }}>
          {unassigned} emergency defect{unassigned === 1 ? "" : "s"} unassigned
        </p>
        <p className="mt-0.5 text-[12px] text-[var(--muted)]">
          {metrics.emergencyOpen} open emergenc{metrics.emergencyOpen === 1 ? "y" : "ies"} in total — assign a team now.
        </p>
      </div>
      <a href="/maintenance-workspace">
        <Tbtn variant="danger">
          <Wrench size={15} />
          Dispatch
        </Tbtn>
      </a>
    </div>
  );
}

function NeedsAttention({ defects }: { defects: DashboardMetrics["criticalOverdueAlerts"] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line2)] p-[18px]">
        <CardHead title="Needs attention now" hint="Critical & overdue, oldest first" />
        <Chip tone={defects.length > 0 ? "critical" : "success"}>{defects.length} active</Chip>
      </div>
      {defects.length > 0 ? (
        <div className="max-h-[14rem] overflow-y-auto">
          {defects.map((defect) => (
            <div
              key={defect.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line2)] px-[18px] py-2.5 last:border-b-0"
            >
              <div className="min-w-0 text-[13px]">
                <span className="font-mono font-semibold text-[var(--foreground)]">{defect.assetCode}</span>
                <span className="text-[var(--foreground-soft)]"> · {defect.label}</span>
                <span className="text-[var(--muted)]"> · {defect.assignedTo || "Unassigned"}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Chip tone={severityTone(defect.severity)}>{defect.severity ?? "—"}</Chip>
                <span className="font-mono text-[12px] text-[var(--critical-text)]">Due {formatDate(defect.dueDate)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-[18px] py-10 text-center text-[13px] text-[var(--muted)]">
          No critical defects are overdue.
        </div>
      )}
    </Card>
  );
}

function RecentDefects({ defects }: { defects: DashboardMetrics["recentDefects"] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line2)] p-[18px]">
        <CardHead title="Recent defects" hint="Latest raised" />
        <span className="text-[12px] text-[var(--muted)]">{defects.length} latest</span>
      </div>
      {defects.length > 0 ? (
        <div className="max-h-[16rem] overflow-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="sticky top-0 z-10 bg-[var(--panel-muted)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                <th className="px-3.5 py-2.5 text-left font-semibold">Asset</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Defect</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Severity</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Category</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3.5 py-2.5 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect) => (
                <tr key={defect.id} className="border-b border-[var(--line2)] transition last:border-b-0 hover:bg-[var(--panel-muted)]">
                  <td className="px-3.5 py-3 font-mono text-[12.5px] font-semibold text-[var(--foreground)]">
                    {defect.assetCode}
                  </td>
                  <td className="min-w-56 px-3.5 py-3 text-[13px] text-[var(--foreground-soft)]">{defect.label}</td>
                  <td className="px-3.5 py-3">
                    <Chip tone={severityTone(defect.severity)}>{defect.severity ?? "—"}</Chip>
                  </td>
                  <td className="px-3.5 py-3">
                    {defect.maintenanceCategory ? (
                      <Chip tone="info">{formatMaintenanceCategory(defect.maintenanceCategory)}</Chip>
                    ) : (
                      <span className="text-[var(--muted-2)]">—</span>
                    )}
                  </td>
                  <td className="px-3.5 py-3">
                    <Chip tone={defectStatusTone(defect.status)}>{defect.status.replace(/_/g, " ")}</Chip>
                  </td>
                  <td className="px-3.5 py-3 font-mono text-[12px] text-[var(--muted)]">{formatDate(defect.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-[18px] py-10 text-center text-[13px] text-[var(--muted)]">No recent defects returned by the API.</div>
      )}
    </Card>
  );
}

/** The design's flagship 1a layout — the OVERVIEW persona. */
function OverviewSections({ metrics }: { metrics: DashboardMetrics }) {
  const throughputTotal = metrics.dailyInspectionTrend.reduce((sum, point) => sum + point.value, 0);
  const flow = metrics.defectFlow.map((point) => ({ date: point.date, a: point.opened, b: point.closed }));
  const periodLabel = metrics.range?.label ?? "this period";

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          label="Assets in scope"
          value={metrics.assetsInScope}
          icon={Archive}
          context={
            <span className="inline-flex items-center gap-1.5">
              <DeltaChip current={metrics.assetsInScope} previous={metrics.assetsInScopePrev} />
              vs. prev.
            </span>
          }
        />
        <KpiCard
          label={`Inspected · ${periodLabel}`}
          value={metrics.inspectedThisPeriod}
          icon={ClipboardCheck}
          tone="info"
          context={
            <span className="inline-flex items-center gap-1.5">
              <DeltaChip current={metrics.inspectedThisPeriod} previous={metrics.inspectedPrevPeriod} />
              vs. prev. period
            </span>
          }
        />
        <KpiCard
          label="Open defects"
          value={metrics.openDefects}
          icon={Bug}
          context={
            <span className="inline-flex items-center gap-1.5">
              <DeltaChip current={metrics.openDefects} previous={metrics.openDefectsPrev} invert />
              net backlog {metrics.netBacklogChange >= 0 ? "+" : ""}
              {metrics.netBacklogChange}
            </span>
          }
        />
        <KpiCard
          label="SLA on-time"
          value={metrics.slaOnTimePct === null ? "—" : `${metrics.slaOnTimePct}%`}
          icon={GaugeIcon}
          tone="success"
          context={
            metrics.slaOnTimePct === null || metrics.slaOnTimePctPrev === null ? (
              "No due-dated defects"
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <DeltaChip current={metrics.slaOnTimePct} previous={metrics.slaOnTimePctPrev} suffix="pp" />
                vs. prev.
              </span>
            )
          }
        />
        <KpiCard
          label="Emergency + overdue"
          value={metrics.emergencyOverdue}
          icon={Siren}
          alarm
          context={`${metrics.emergencyUnassigned} unassigned · ${metrics.emergencyOpen} open`}
        />
      </div>

      {/* Trend row */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Inspection throughput"
          hint={`${throughputTotal.toLocaleString()} assets over ${periodLabel}`}
        >
          <AreaChart
            data={metrics.dailyInspectionTrend}
            unitLabel="assets inspected"
            emptyLabel="No submitted inspections in this range."
          />
        </Panel>
        <Panel title="Defect intake vs. closure" hint="Opened vs. closed per day">
          <DualLineChart data={flow} emptyLabel="No defect activity in this range." />
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--line2)] pt-3 text-[12px] text-[var(--muted)]">
            <span>
              Net backlog{" "}
              <span className={`font-semibold ${metrics.netBacklogChange > 0 ? "text-[var(--critical-text)]" : "text-[var(--success-text)]"}`}>
                {metrics.netBacklogChange >= 0 ? "+" : ""}
                {metrics.netBacklogChange}
              </span>
            </span>
            <span>
              Avg. close{" "}
              <span className="font-semibold text-[var(--foreground)]">
                {metrics.avgCloseHours > 0 ? `${Math.round(metrics.avgCloseHours)}h` : "—"}
              </span>
            </span>
          </div>
        </Panel>
      </div>

      {/* Analytics row */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SeverityDonut
          title="Defects by severity"
          data={metrics.defectsBySeverity}
          centerCaption="defects"
          emptyLabel="No defects recorded yet."
        />
        <Panel title="SLA compliance" hint="On-time share of due-dated defects">
          <div className="flex items-center justify-center py-2">
            <Gauge value={metrics.slaOnTimePct ?? 0} caption={metrics.slaOnTimePct === null ? "No due dates" : "on-time"} />
          </div>
        </Panel>
        <SimpleBarChart
          title="Assets by substation"
          data={metrics.assetsBySubstation}
          emptyLabel="No assets attributed to a substation yet."
          tone="teal"
          maxRows={5}
        />
      </div>

      <EmergencyAlertBar metrics={metrics} />

      <div className="grid gap-4 xl:grid-cols-2">
        <NeedsAttention defects={metrics.criticalOverdueAlerts} />
        <RecentDefects defects={metrics.recentDefects} />
      </div>
    </div>
  );
}

function MaintenanceSections({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Routed defects" value={metrics.totalDefects} icon={Wrench} context="Released to your company" />
        <KpiCard label="Open defects" value={metrics.openDefects} icon={AlertTriangle} tone="high" context="Awaiting action or closure" />
        <KpiCard label="Overdue" value={metrics.overdueDefects} icon={ShieldAlert} tone={metrics.overdueDefects > 0 ? "critical" : "success"} context="Past due, still open" />
        <KpiCard label="Emergency + overdue" value={metrics.emergencyOverdue} icon={Siren} alarm context={`${metrics.emergencyUnassigned} unassigned`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SeverityDonut title="Defects by severity" data={metrics.defectsBySeverity} centerCaption="defects" emptyLabel="No defects recorded yet." />
        <SimpleBarChart title="Defects by status" data={metrics.defectsByStatus} emptyLabel="No defect status counts yet." tone="rose" />
        <SimpleBarChart title="Defects by category" data={metrics.defectsByCategory} emptyLabel="No category counts yet." tone="teal" />
      </div>
      <EmergencyAlertBar metrics={metrics} />
      <div className="grid gap-4 xl:grid-cols-2">
        <NeedsAttention defects={metrics.criticalOverdueAlerts} />
        <RecentDefects defects={metrics.recentDefects} />
      </div>
    </div>
  );
}

function InspectionSections({ metrics }: { metrics: DashboardMetrics }) {
  const overdueThreshold = metrics.operationalOverdueThresholdHours || 24;
  const throughputTotal = metrics.dailyInspectionTrend.reduce((sum, point) => sum + point.value, 0);
  const periodLabel = metrics.range?.label ?? "this period";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Inspected · ${periodLabel}`} value={metrics.inspectedThisPeriod} icon={ClipboardCheck} tone="info" context={<span className="inline-flex items-center gap-1.5"><DeltaChip current={metrics.inspectedThisPeriod} previous={metrics.inspectedPrevPeriod} />vs. prev.</span>} />
        <KpiCard label="Active visits" value={metrics.activeVisits} icon={Activity} tone={metrics.overdueVisits > 0 ? "warning" : "neutral"} context={`Overdue threshold ${overdueThreshold}h`} />
        <KpiCard label="Completed visits" value={metrics.completedVisits} icon={CheckCircle2} tone="success" context={`${metrics.completionRate}% completion`} />
        <KpiCard label="Open defects" value={metrics.openDefects} icon={AlertTriangle} tone="high" context="Raised by your crews" />
      </div>
      <Panel title="Inspection throughput" hint={`${throughputTotal.toLocaleString()} assets over ${periodLabel}`}>
        <AreaChart data={metrics.dailyInspectionTrend} unitLabel="assets inspected" emptyLabel="No submitted inspections in this range." />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <SimpleBarChart title="Visits by status" data={metrics.visitsByStatus} emptyLabel="No site-visit status counts yet." tone="teal" />
        <SimpleBarChart title="Active visits by team" data={metrics.activeVisitsByTeam} emptyLabel="No active team counts yet." tone="amber" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SeverityDonut title="Defects by severity" data={metrics.defectsBySeverity} centerCaption="defects" emptyLabel="No defects recorded yet." />
        <SimpleBarChart title="Assets by substation" data={metrics.assetsBySubstation} emptyLabel="No assets attributed yet." tone="teal" maxRows={5} />
        <SimpleBarChart title="Total assets by mainhead" data={metrics.assetsByMainhead} emptyLabel="No mainhead counts yet." tone="teal" maxRows={5} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <NeedsAttention defects={metrics.criticalOverdueAlerts} />
        <RecentDefects defects={metrics.recentDefects} />
      </div>
    </div>
  );
}

function DashboardSections({ metrics }: { metrics: DashboardMetrics }) {
  if (metrics.persona.kind === "MAINTENANCE") {
    return <MaintenanceSections metrics={metrics} />;
  }
  if (metrics.persona.kind === "INSPECTION") {
    return <InspectionSections metrics={metrics} />;
  }
  return <OverviewSections metrics={metrics} />;
}

function DashboardContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [range, setRange] = useState<DashboardRangeKey>("30d");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadDashboard = useCallback(
    async (token: string, selectedRange: DashboardRangeKey, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError("");

      try {
        const nextMetrics = await fetchDashboardMetrics(token, selectedRange);
        setMetrics(nextMetrics);
      } catch (dashboardError) {
        if (dashboardError instanceof ApiError && dashboardError.status === 401) {
          handleLogout();
          return;
        }
        setError(dashboardError instanceof Error ? dashboardError.message : "Unable to load dashboard.");
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
      void loadDashboard(storedSession.token, range);
    }
    // Only on mount — range changes are handled by onRangeChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void loadDashboard(session.token, range, false);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadDashboard, session?.token, range]);

  function onRangeChange(next: DashboardRangeKey) {
    setRange(next);
    if (session?.token) {
      void loadDashboard(session.token, next, false);
    }
  }

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
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow={headline.eyebrow}
            title={headline.title}
            subtitle={headline.subtitle}
            chips={
              <>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-[12px] font-semibold text-[var(--foreground-soft)] shadow-[var(--shadow-soft)]">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                  />
                  Auto-refresh 60s
                </label>
                {metrics?.latestVisitActivityAt ? (
                  <Chip tone="neutral">Last activity {formatDate(metrics.latestVisitActivityAt)}</Chip>
                ) : null}
              </>
            }
            actions={
              <>
                <Seg options={RANGE_OPTIONS} value={range} onChange={onRangeChange} aria-label="Time range" />
                <Tbtn
                  onClick={() => (session?.token ? loadDashboard(session.token, range, false) : undefined)}
                  disabled={(isLoading && !metrics) || isRefreshing || !session?.token}
                >
                  <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
              </>
            }
          />

          <div className="mt-6">
            {isLoading && !metrics ? (
              <DashboardLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
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
