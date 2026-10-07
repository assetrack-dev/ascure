"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Hourglass,
  Layers,
  Undo2,
  Users2,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { CrewDailyModal } from "@/components/crew-daily-modal";
import { Card, CardHead, PageHeader, Seg, Tbtn, filterSelectClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  downloadCrewPerformance,
  downloadMaintenancePerformance,
  fetchCrewPerformance,
  fetchMaintenancePerformance,
  type CrewPerformance,
  type CrewPerformanceRow,
  type MaintenancePerformance,
} from "@/lib/reports";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AuthSession } from "@/types/auth";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

const UNTEAMED = "No team";
const UNTEAMED_COMPANY = "No company";

type Tab = "SURVEY" | "MAINTENANCE";
const TAB_OPTIONS = [
  { value: "SURVEY", label: "Survey" },
  { value: "MAINTENANCE", label: "Maintenance" },
] as const;

/** ?tab=maintenance opens the maintenance crews directly. */
function initialTab(): Tab {
  if (typeof window === "undefined") return "SURVEY";
  return new URLSearchParams(window.location.search).get("tab") === "maintenance"
    ? "MAINTENANCE"
    : "SURVEY";
}

/** Hours → "5 h" / "2.5 d". */
function formatDuration(hours: number | null) {
  if (hours === null) return "—";
  return hours < 24 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1)} d`;
}

/** Roll per-person rows up to per-team inspection totals, biggest first. */
function inspectionsByTeam(rows: CrewPerformanceRow[]): Array<{ team: string; value: number }> {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const team = row.teamName?.trim() || UNTEAMED;
    totals.set(team, (totals.get(team) ?? 0) + row.submittedInspections);
  }

  return Array.from(totals.entries())
    .map(([team, value]) => ({ team, value }))
    .sort((left, right) => right.value - left.value);
}

/** Horizontal bar list — team throughput. Token-styled, no chart lib. */
function TeamBars({
  data,
  empty = "No inspections in this period.",
}: {
  data: Array<{ team: string; value: number }>;
  empty?: string;
}) {
  const max = Math.max(...data.map((item) => item.value), 0);

  if (data.length === 0) {
    return (
      <div className="rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
        {empty}
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {data.map((item) => {
        const width = max > 0 ? Math.max((item.value / max) * 100, 3) : 0;
        return (
          <div key={item.team}>
            <div className="mb-1.5 flex items-center justify-between gap-4 text-[12.5px]">
              <span className="truncate font-medium text-[var(--foreground-soft)]">{item.team}</span>
              <span className="shrink-0 font-mono tabular-nums text-[var(--foreground)]">
                {item.value.toLocaleString()}
              </span>
            </div>
            <div className="h-[7px] overflow-hidden rounded-full bg-[var(--panel-muted)]">
              <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One line of the Fleet totals card. */
function FleetStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] py-2.5 last:border-b-0">
      <span className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
        <Icon size={15} className="text-[var(--muted-2)]" />
        {label}
      </span>
      <span
        className="font-mono text-[15px] font-bold tabular-nums text-[var(--foreground)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function CrewPerformanceContent() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [month, setMonth] = useState<string>(currentMonthValue());
  const [data, setData] = useState<CrewPerformance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  // The leaderboard row opened in the daily drill-down modal.
  const [dailyUser, setDailyUser] = useState<CrewPerformanceRow | null>(null);
  // Plan §15: maintenance crews, credited by team.
  const [tab, setTab] = useState<Tab>("SURVEY");
  const [maintenance, setMaintenance] = useState<MaintenancePerformance | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  // Contractor filter — only meaningful for a MAIN_CONTRACTOR manager (or an
  // ADMIN), whose oversight scope returns more than one company's crews.
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    window.location.href = "/login";
  }, []);

  const load = useCallback(
    async (token: string, selectedMonth: string) => {
      setIsLoading(true);
      setError("");
      const { from, to } = monthRange(selectedMonth);
      try {
        setData(await fetchCrewPerformance(token, from, to));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("Only a manager or administrator can view crew performance.");
          setData(null);
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load crew performance."));
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  const loadMaintenance = useCallback(
    async (token: string, selectedMonth: string) => {
      setMaintenanceLoading(true);
      setError("");
      const { from, to } = monthRange(selectedMonth);
      try {
        setMaintenance(await fetchMaintenancePerformance(token, from, to));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load maintenance performance."));
        setMaintenance(null);
      } finally {
        setMaintenanceLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (!stored?.token) {
      setIsLoading(false);
      return;
    }
    const startTab = initialTab();
    setTab(startTab);
    void load(stored.token, currentMonthValue());
    if (startTab === "MAINTENANCE") {
      void loadMaintenance(stored.token, currentMonthValue());
    }
  }, [load, loadMaintenance]);

  const onMonthChange = (value: string) => {
    setMonth(value);
    const token = session?.token;
    if (token && value) {
      void load(token, value);
      if (tab === "MAINTENANCE") void loadMaintenance(token, value);
    }
  };

  const onTabChange = (value: Tab) => {
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "MAINTENANCE") url.searchParams.set("tab", "maintenance");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
    if (value === "MAINTENANCE" && session?.token && !maintenance) {
      void loadMaintenance(session.token, month);
    }
  };

  const handleDownload = async () => {
    const token = session?.token;
    if (!token) {
      return;
    }
    setIsDownloading(true);
    setError("");
    const { from, to } = monthRange(month);
    try {
      if (tab === "MAINTENANCE") await downloadMaintenancePerformance(token, from, to);
      else await downloadCrewPerformance(token, from, to);
    } catch (downloadError) {
      if (downloadError instanceof ApiError && downloadError.status === 401) {
        handleLogout();
        return;
      }
      setError(requestErrorMessage(downloadError, "Unable to download the pay sheet."));
    } finally {
      setIsDownloading(false);
    }
  };

  const allRows = useMemo(() => data?.users ?? [], [data]);
  const allTeams = useMemo(() => maintenance?.teams ?? [], [maintenance]);
  // Distinct companies in the payload; >1 means the caller has oversight over
  // subcontractors (main contractor / admin) and the filter + column appear.
  const companies = useMemo(() => {
    const names = new Set<string>();
    for (const row of tab === "MAINTENANCE" ? allTeams : allRows) {
      names.add(row.companyName ?? UNTEAMED_COMPANY);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [allRows, allTeams, tab]);
  const multiCompany = companies.length > 1;
  // A month change can drop the filtered company from the payload — fall back
  // to ALL instead of showing a silently empty table.
  useEffect(() => {
    if (companyFilter !== "ALL" && !companies.includes(companyFilter)) {
      setCompanyFilter("ALL");
    }
  }, [companies, companyFilter]);
  const rows = useMemo(
    () =>
      companyFilter === "ALL"
        ? allRows
        : allRows.filter(
            (row) => (row.companyName ?? UNTEAMED_COMPANY) === companyFilter,
          ),
    [allRows, companyFilter],
  );
  const teamData = useMemo(() => inspectionsByTeam(rows), [rows]);
  const teamRows = useMemo(
    () =>
      companyFilter === "ALL"
        ? allTeams
        : allTeams.filter((row) => (row.companyName ?? UNTEAMED_COMPANY) === companyFilter),
    [allTeams, companyFilter],
  );
  const repairBars = useMemo(
    () =>
      teamRows
        .filter((row) => row.repaired > 0)
        .map((row) => ({ team: row.teamName, value: row.repaired }))
        .sort((left, right) => right.value - left.value),
    [teamRows],
  );
  const repairTotals = useMemo(
    () => ({
      repaired: teamRows.reduce((sum, row) => sum + row.repaired, 0),
      closed: teamRows.reduce((sum, row) => sum + row.closed, 0),
      sentBack: teamRows.reduce((sum, row) => sum + row.sentBack, 0),
      onHand: teamRows.reduce((sum, row) => sum + row.onHand, 0),
    }),
    [teamRows],
  );
  const isMaintenance = tab === "MAINTENANCE";
  // Fleet totals from real payload fields only — no defect or SLA figure exists.
  const totalInspections = useMemo(
    () => rows.reduce((sum, row) => sum + row.submittedInspections, 0),
    [rows],
  );
  // Distinct-assets total follows the contractor filter (the payload total is
  // scope-wide); two contractors sharing a pole double-count here, same as the
  // per-row column they sum from.
  const totalAssets = useMemo(
    () =>
      companyFilter === "ALL"
        ? (data?.totalAssetsInspected ?? 0)
        : rows.reduce((sum, row) => sum + row.assetsInspected, 0),
    [companyFilter, data, rows],
  );

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Crew Analytics"
            title="Crew Performance"
            subtitle={
              isMaintenance
                ? "Repairs per maintenance team — marked done, verified, sent back — for monitoring and payment. Scoped to your company — a main contractor also sees each subcontractor's teams."
                : "Distinct assets inspected per crew member, for monitoring and payment. Scoped to your company — a main contractor also sees each subcontractor's crews. Pick a month and download the pay sheet."
            }
            actions={
              <>
                <Seg aria-label="Crew type" options={TAB_OPTIONS} value={tab} onChange={onTabChange} />
                {multiCompany ? (
                  <>
                    <label className="sr-only" htmlFor="crew-company">
                      Contractor
                    </label>
                    <select
                      id="crew-company"
                      value={companyFilter}
                      onChange={(event) => setCompanyFilter(event.target.value)}
                      className={filterSelectClass}
                    >
                      <option value="ALL">All contractors</option>
                      {companies.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <label className="sr-only" htmlFor="crew-month">
                  Month
                </label>
                <input
                  id="crew-month"
                  type="month"
                  value={month}
                  onChange={(event) => onMonthChange(event.target.value)}
                  className={filterSelectClass}
                />
                <Tbtn
                  variant="primary"
                  onClick={() => void handleDownload()}
                  disabled={isDownloading || (isMaintenance ? teamRows.length === 0 : rows.length === 0)}
                >
                  <Download size={16} />
                  {isDownloading ? "Preparing…" : "Download XLSX"}
                </Tbtn>
              </>
            }
          />

          {error ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-4 py-3 text-[13px] font-semibold text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {isMaintenance ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              {/* Per TEAM (owner: maintenance crews work as a team). */}
              <Card padded={false}>
                <div className="flex items-center justify-between gap-3 border-b border-[var(--line2)] p-[18px]">
                  <CardHead title="Maintenance teams" hint="Ranked by Kejanggalan repaired" />
                  {maintenance ? (
                    <span className="shrink-0 text-[12px] text-[var(--muted)]">
                      {maintenance.period} · {teamRows.length} {teamRows.length === 1 ? "team" : "teams"}
                    </span>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="bg-[var(--panel-muted)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                        <th className="px-3.5 py-2.5 text-left font-semibold">#</th>
                        <th className="px-3.5 py-2.5 text-left font-semibold">Team</th>
                        {multiCompany ? (
                          <th className="px-3.5 py-2.5 text-left font-semibold">Company</th>
                        ) : null}
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Marked done this period">Repaired</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Verified (closed) this period">Closed</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Rejected at verification this period">Sent back</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Closed ÷ (closed + sent back)">Pass</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Reported 'cannot repair'">Can't</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Average assigned → marked done">Avg time</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Days with repair photos or a 'done'">Days</th>
                        <th className="px-3.5 py-2.5 text-right font-semibold" title="Assigned / in progress right now">On hand</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maintenanceLoading ? (
                        <tr>
                          <td colSpan={multiCompany ? 11 : 10} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                            Loading…
                          </td>
                        </tr>
                      ) : teamRows.length === 0 ? (
                        <tr>
                          <td colSpan={multiCompany ? 11 : 10} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                            No maintenance work in this period.
                          </td>
                        </tr>
                      ) : (
                        teamRows.map((row, index) => (
                          <tr
                            key={row.teamId}
                            className="border-b border-[var(--line2)] transition last:border-b-0 hover:bg-[var(--panel-muted)]"
                          >
                            <td className="px-3.5 py-3">
                              <span
                                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums ${
                                  index === 0 && row.repaired > 0
                                    ? "bg-[var(--foreground)] text-[var(--panel)]"
                                    : "bg-[var(--panel-muted)] text-[var(--muted)]"
                                }`}
                              >
                                {index + 1}
                              </span>
                            </td>
                            <td className="px-3.5 py-3 text-[13px] font-semibold text-[var(--foreground)]">
                              {row.teamName}
                            </td>
                            {multiCompany ? (
                              <td className="px-3.5 py-3 text-[13px] text-[var(--foreground-soft)]">
                                {row.companyName ?? "—"}
                              </td>
                            ) : null}
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] font-bold tabular-nums text-[var(--foreground)]">
                              {row.repaired}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.closed}
                            </td>
                            <td
                              className={`px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums ${
                                row.sentBack > 0 ? "font-semibold text-[var(--high-text)]" : "text-[var(--muted)]"
                              }`}
                            >
                              {row.sentBack}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.passRate === null ? "—" : `${row.passRate}%`}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.cannotRepair}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {formatDuration(row.avgHoursToDone)}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.activeDays}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.onHand}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHead title="Repairs by team" hint="Marked done this period" />
                  <div className="mt-4">
                    <TeamBars data={repairBars} empty="No repairs in this period." />
                  </div>
                </Card>

                <Card>
                  <CardHead title="Totals" />
                  <div className="mt-3">
                    <FleetStat icon={Wrench} label="Repaired" value={repairTotals.repaired} />
                    <FleetStat icon={CheckCircle2} label="Closed (verified)" value={repairTotals.closed} />
                    <FleetStat icon={Undo2} label="Sent back" value={repairTotals.sentBack} />
                    <FleetStat icon={Hourglass} label="On hand now" value={repairTotals.onHand} />
                    <FleetStat icon={Users2} label="Teams" value={teamRows.length} />
                  </div>
                </Card>
              </div>
            </div>
          ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            {/* Leaderboard — per PERSON (this is a pay sheet; a team rollup can't
                pay individuals). Rank is cosmetic: rows arrive sorted desc. */}
            <Card padded={false}>
              <div className="flex items-center justify-between gap-3 border-b border-[var(--line2)] p-[18px]">
                <CardHead title="Leaderboard" hint="Ranked by distinct assets inspected" />
                {data ? (
                  <span className="shrink-0 text-[12px] text-[var(--muted)]">
                    {data.period} · {rows.length} {rows.length === 1 ? "person" : "people"}
                  </span>
                ) : null}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead>
                    <tr className="bg-[var(--panel-muted)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                      <th className="px-3.5 py-2.5 text-left font-semibold">#</th>
                      <th className="px-3.5 py-2.5 text-left font-semibold">Name</th>
                      <th className="px-3.5 py-2.5 text-left font-semibold">Role</th>
                      {multiCompany ? (
                        <th className="px-3.5 py-2.5 text-left font-semibold">Company</th>
                      ) : null}
                      <th className="px-3.5 py-2.5 text-left font-semibold">Team</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">Assets</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">Insp.</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">Visits</th>
                      <th className="px-3.5 py-2.5 text-right font-semibold">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={multiCompany ? 9 : 8} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                          Loading…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={multiCompany ? 9 : 8} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                          No inspections submitted in this period.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, index) => {
                        const rank = index + 1;
                        return (
                          <tr
                            key={row.userId}
                            className="border-b border-[var(--line2)] transition last:border-b-0 hover:bg-[var(--panel-muted)]"
                          >
                            <td className="px-3.5 py-3">
                              <span
                                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums ${
                                  rank === 1
                                    ? "bg-[var(--foreground)] text-[var(--panel)]"
                                    : "bg-[var(--panel-muted)] text-[var(--muted)]"
                                }`}
                              >
                                {rank}
                              </span>
                            </td>
                            <td className="px-3.5 py-3 text-[13px] font-semibold text-[var(--foreground)]">
                              <button
                                type="button"
                                onClick={() => setDailyUser(row)}
                                title="Daily numbers + attendance"
                                className="rounded-sm text-left underline decoration-[var(--line)] decoration-dotted underline-offset-4 outline-none transition hover:text-[var(--brand)] hover:decoration-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                              >
                                {row.name}
                              </button>
                            </td>
                            <td className="px-3.5 py-3 text-[13px] text-[var(--muted)]">
                              {row.role ?? "—"}
                            </td>
                            {multiCompany ? (
                              <td className="px-3.5 py-3 text-[13px] text-[var(--foreground-soft)]">
                                {row.companyName ?? "—"}
                              </td>
                            ) : null}
                            <td className="px-3.5 py-3 text-[13px] text-[var(--foreground-soft)]">
                              {row.teamName ?? "—"}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] font-bold tabular-nums text-[var(--foreground)]">
                              {row.assetsInspected}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.submittedInspections}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.visits}
                            </td>
                            <td className="px-3.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-[var(--muted)]">
                              {row.activeDays}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHead title="Inspections by team" hint="Submitted this period" />
                <div className="mt-4">
                  <TeamBars data={teamData} />
                </div>
              </Card>

              <Card>
                <CardHead title="Fleet totals" />
                <div className="mt-3">
                  <FleetStat icon={ClipboardCheck} label="Inspections submitted" value={totalInspections} />
                  <FleetStat
                    icon={Layers}
                    label="Assets inspected"
                    value={totalAssets}
                  />
                  <FleetStat icon={Users2} label="People" value={rows.length} />
                </div>
              </Card>
            </div>
          </div>
          )}
        </div>

        {/* Daily drill-down — click a name for the per-day bar chart +
            attendance gaps; month steps independently of the page month. */}
        {dailyUser && session?.token ? (
          <CrewDailyModal
            token={session.token}
            userId={dailyUser.userId}
            userName={dailyUser.name}
            initialMonth={month}
            onClose={() => setDailyUser(null)}
            onUnauthorized={handleLogout}
          />
        ) : null}
      </main>
    </AppShell>
  );
}

export function CrewPerformanceClient() {
  return (
    <AuthGuard>
      <CrewPerformanceContent />
    </AuthGuard>
  );
}
