"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Layers, Users2, ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Card, CardHead, PageHeader, Tbtn, filterSelectClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  downloadCrewPerformance,
  fetchCrewPerformance,
  type CrewPerformance,
  type CrewPerformanceRow,
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
function TeamBars({ data }: { data: Array<{ team: string; value: number }> }) {
  const max = Math.max(...data.map((item) => item.value), 0);

  if (data.length === 0) {
    return (
      <div className="rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 py-8 text-center text-[13px] text-[var(--muted)]">
        No inspections in this period.
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

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (!stored?.token) {
      setIsLoading(false);
      return;
    }
    void load(stored.token, currentMonthValue());
  }, [load]);

  const onMonthChange = (value: string) => {
    setMonth(value);
    const token = session?.token;
    if (token && value) {
      void load(token, value);
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
      await downloadCrewPerformance(token, from, to);
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

  const rows = data?.users ?? [];
  const teamData = useMemo(() => inspectionsByTeam(rows), [rows]);
  // Fleet totals from real payload fields only — no defect or SLA figure exists.
  const totalInspections = useMemo(
    () => rows.reduce((sum, row) => sum + row.submittedInspections, 0),
    [rows],
  );

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Crew Analytics"
            title="Crew Performance"
            subtitle="Distinct assets inspected per crew member, for monitoring and payment. Scoped to your own company — pick a month and download the pay sheet."
            actions={
              <>
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
                  disabled={isDownloading || rows.length === 0}
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
                        <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                          Loading…
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
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
                              {row.name}
                            </td>
                            <td className="px-3.5 py-3 text-[13px] text-[var(--muted)]">
                              {row.role ?? "—"}
                            </td>
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
                    value={data?.totalAssetsInspected ?? 0}
                  />
                  <FleetStat icon={Users2} label="People" value={rows.length} />
                </div>
              </Card>
            </div>
          </div>
        </div>
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
