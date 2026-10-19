"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  PageHeader,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { downloadTnbPerformance, fetchTnbPerformance } from "@/lib/maintenance-tasks";
import type { AuthSession } from "@/types/auth";
import type { PerformanceLane, TnbPerformance } from "@/types/maintenance-tasks";

/**
 * Plan §21.2 #2 — TNB Performance: how each contractor company did over a
 * period, per work type. Counts are events in the period (given, completed on
 * site, verified, sent back); "Open now" and "Overdue Pencawang" are today's
 * state. Excel download for meetings.
 */

const CATEGORY_LABEL: Record<string, string> = {
  ALL: "All work types",
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

function myDay(offsetDays = 0) {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function presets() {
  const today = myDay();
  const [year, month] = today.split("-").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastMonthYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  return [
    { label: "This month", from: `${year}-${pad(month)}-01`, to: today },
    {
      label: "Last month",
      from: `${lastMonthYear}-${pad(lastMonth)}-01`,
      to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
    },
    { label: "Last 30 days", from: myDay(-29), to: today },
  ];
}

const days = (value: number | null) => (value === null ? "—" : `${value.toLocaleString()} d`);
const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

function LaneCells({ lane }: { lane: PerformanceLane }) {
  const alarm = "font-semibold text-[var(--critical-text)]";
  return (
    <>
      <td className={`${tableCellClass} tabular-nums`}>{lane.assigned}</td>
      <td className={`${tableCellClass} tabular-nums`}>{lane.completed}</td>
      <td className={`${tableCellClass} tabular-nums`}>{lane.verified}</td>
      <td className={`${tableCellClass} whitespace-nowrap tabular-nums`}>
        <span className={lane.sentBack > 0 ? alarm : undefined}>{lane.sentBack}</span>
        <span className="text-[var(--muted)]"> · {pct(lane.sentBackRate)}</span>
      </td>
      <td className={`${tableCellClass} tabular-nums`}>{lane.cannotRepair}</td>
      <td className={`${tableCellClass} whitespace-nowrap tabular-nums`}>{days(lane.daysToDone)}</td>
      <td className={`${tableCellClass} whitespace-nowrap tabular-nums`}>{days(lane.daysToVerify)}</td>
      <td className={`${tableCellClass} tabular-nums`}>{lane.open}</td>
      <td className={`${tableCellClass} tabular-nums ${lane.overduePencawang > 0 ? alarm : ""}`}>
        {lane.overduePencawang}
      </td>
    </>
  );
}

function TnbPerformanceContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [from, setFrom] = useState(() => presets()[0].from);
  const [to, setTo] = useState(myDay);
  const [category, setCategory] = useState("");
  const [data, setData] = useState<TnbPerformance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const fail = useCallback(
    (failure: unknown, fallback: string) => {
      if (failure instanceof ApiError && failure.status === 401) {
        handleLogout();
        return;
      }
      setError(failure instanceof Error ? failure.message : fallback);
    },
    [handleLogout],
  );

  const badRange = Boolean(from && to && from > to);
  const options = { from, to, category: category || undefined };
  const optionsKey = JSON.stringify(options);

  const load = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setData(await fetchTnbPerformance(token, JSON.parse(optionsKey)));
      } catch (failure) {
        fail(failure, "Unable to load performance.");
      } finally {
        setIsLoading(false);
      }
    },
    [fail, optionsKey],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token && !badRange) void load(storedSession.token);
  }, [badRange, load]);

  const download = async () => {
    if (!session?.token) return;
    try {
      await downloadTnbPerformance(session.token, options);
    } catch (failure) {
      fail(failure, "Unable to download the Excel file.");
    }
  };

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Company performance"
            subtitle="How each contractor company did in the period, per work type. Given, completed, verified and sent back count what happened in the period; Open now and Overdue are today."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Tbtn onClick={() => (session?.token ? load(session.token) : undefined)} disabled={isLoading || badRange}>
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
                <Tbtn variant="secondary" onClick={() => void download()} disabled={badRange || !data}>
                  <FileSpreadsheet size={16} />
                  Excel
                </Tbtn>
              </div>
            }
          />

          <div className="mt-6 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[12.5px] font-semibold text-[var(--foreground-soft)]">From</span>
              <input
                id="performance-from"
                type="date"
                value={from}
                max={myDay()}
                onChange={(event) => setFrom(event.target.value)}
                className={`${filterControlClass} mt-1.5 block`}
              />
            </label>
            <label className="block">
              <span className="text-[12.5px] font-semibold text-[var(--foreground-soft)]">To</span>
              <input
                id="performance-to"
                type="date"
                value={to}
                max={myDay()}
                onChange={(event) => setTo(event.target.value)}
                className={`${filterControlClass} mt-1.5 block`}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {presets().map((preset) => (
                <Tbtn
                  key={preset.label}
                  variant={from === preset.from && to === preset.to ? "primary" : "secondary"}
                  onClick={() => {
                    setFrom(preset.from);
                    setTo(preset.to);
                  }}
                >
                  {preset.label}
                </Tbtn>
              ))}
            </div>
            <select
              aria-label="Work type"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={filterSelectClass}
            >
              <option value="">All work types</option>
              {["RENTIS", "CAT_TIANG", "SELENGGARAAN"].map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABEL[value]} only
                </option>
              ))}
            </select>
          </div>
          {badRange ? (
            <p className="mt-2 text-[12.5px] font-semibold text-[var(--critical-text)]">The From date is after the To date.</p>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {data ? (
            <Card padded={false} className="mt-5">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse">
                  <thead className={tableHeadClass}>
                    <tr>
                      <th className={tableHeadCellClass}>Company · work type</th>
                      <th className={tableHeadCellClass} title="Kejanggalan given to the company in the period">
                        Given
                      </th>
                      <th className={tableHeadCellClass}>Completed on site</th>
                      <th className={tableHeadCellClass}>Verified</th>
                      <th className={tableHeadCellClass} title="Sent back · share of the repairs decided in the period">
                        Sent back
                      </th>
                      <th className={tableHeadCellClass}>Cannot repair</th>
                      <th className={tableHeadCellClass} title="Average days from given to marked done">
                        Days to repair
                      </th>
                      <th className={tableHeadCellClass} title="Average days from marked done to verified">
                        Days to verify
                      </th>
                      <th className={tableHeadCellClass}>Open now</th>
                      <th className={tableHeadCellClass}>Overdue Pencawang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.companies.map((entry) => (
                      <Fragment key={entry.company.id}>
                        <tr className="border-b border-[var(--line2)] bg-[var(--panel-muted)]">
                          <td className={`${tableCellClass} font-semibold text-[var(--foreground)]`}>
                            {entry.company.name}
                          </td>
                          <LaneCells lane={entry.total} />
                        </tr>
                        {entry.lanes.map((lane) => (
                          <tr key={lane.category} className="border-b border-[var(--line2)]">
                            <td className={`${tableCellClass} pl-8 text-[var(--muted)]`}>
                              {CATEGORY_LABEL[lane.category] ?? lane.category}
                            </td>
                            <LaneCells lane={lane} />
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {data.companies.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">
                          No maintenance work on your Mainheads in this period.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : isLoading ? (
            <Card className="mt-5 px-5 py-12 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

export function TnbPerformanceClient() {
  return (
    <AuthGuard>
      <TnbPerformanceContent />
    </AuthGuard>
  );
}
