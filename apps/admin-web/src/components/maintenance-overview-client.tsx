"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Hammer, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { MultiLineChart, type LineSeries } from "@/components/charts";
import {
  Card,
  CardHead,
  KpiCard,
  PageHeader,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchMaintenanceOverview } from "@/lib/maintenance-tasks";
import type { AuthSession } from "@/types/auth";
import type { MaintenanceOverview, TaskStatus } from "@/types/maintenance-tasks";

/**
 * Plan §21.2 #3 — a maintenance company's home: what happened on a day (default
 * today) in the three repair states TNB tracks (R6) — In progress (first repair
 * photo), Completed on site (Mark done), Verified — the last 30 days of them,
 * where each work type stands, and every team.
 */

const DAY_SERIES: LineSeries[] = [
  { key: "started", label: "In progress (started)", color: "var(--info)" },
  { key: "completed", label: "Completed on site", color: "var(--brand)" },
  { key: "verified", label: "Verified", color: "var(--success)" },
];

const CATEGORY_LABEL: Record<string, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

/** Work-type bar, left to right: finished first. */
const BAR_PARTS: Array<{ status: TaskStatus; label: string; color: string }> = [
  { status: "VERIFIED", label: "Verified", color: "var(--success)" },
  { status: "COMPLETED", label: "Completed on site", color: "var(--brand)" },
  { status: "CANNOT_REPAIR", label: "Cannot repair", color: "var(--high)" },
  { status: "IN_PROGRESS", label: "In progress", color: "var(--info)" },
  { status: "SENT_BACK", label: "Sent back", color: "var(--critical)" },
  { status: "TODO", label: "To do", color: "var(--line-strong)" },
];

/** Today in Malaysia, yyyy-mm-dd (the API's default day). */
function todayMy() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatDay(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(
    parsed,
  );
}

function tasksLink(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return `/maintenance-tasks${text ? `?${text}` : ""}`;
}

function StatusBar({ counts, total }: { counts: Record<TaskStatus, number>; total: number }) {
  const title = BAR_PARTS.map((part) => `${part.label}: ${counts[part.status]}`).join(" · ");
  return (
    <div title={title} className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--line2)]">
      {total > 0
        ? BAR_PARTS.map((part) =>
            counts[part.status] > 0 ? (
              <span
                key={part.status}
                style={{ width: `${(counts[part.status] / total) * 100}%`, background: part.color }}
              />
            ) : null,
          )
        : null}
    </div>
  );
}

function MaintenanceOverviewContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [date, setDate] = useState(todayMy);
  const [organizationId, setOrganizationId] = useState("");
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const load = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        setOverview(await fetchMaintenanceOverview(token, { date, organizationId }));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load the overview.");
      } finally {
        setIsLoading(false);
      }
    },
    [date, handleLogout, organizationId],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) void load(storedSession.token);
  }, [load]);

  const isToday = date === todayMy();
  const dayLabel = isToday ? "Today" : formatDay(date);
  const totals = overview?.totals;
  const open = totals ? totals.TODO + totals.IN_PROGRESS + totals.SENT_BACK : 0;
  const showCompany = (overview?.companies.length ?? 0) > 1;
  const companyName =
    overview?.companies.find((company) => company.id === organizationId)?.name ??
    (overview?.companies.length === 1 ? overview.companies[0].name : null);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title={companyName ? `Overview · ${companyName}` : "Overview"}
            subtitle="What your crews did on a day, the last 30 days, and where every work type and team stands. Only Verified counts as finished."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {showCompany ? (
                  <select
                    aria-label="Company"
                    value={organizationId}
                    onChange={(event) => setOrganizationId(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="">All companies</option>
                    {overview?.companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  type="date"
                  aria-label="Day"
                  value={date}
                  max={todayMy()}
                  onChange={(event) => setDate(event.target.value || todayMy())}
                  className={filterControlClass}
                />
                <Tbtn
                  onClick={() => (session?.token ? load(session.token) : undefined)}
                  disabled={isLoading || !session?.token}
                >
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
              </div>
            }
          />

          {error ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          {overview && totals ? (
            <div className="mt-6 space-y-5">
              {/* The day — the three states TNB tracks. */}
              <section aria-label={dayLabel} className="space-y-2">
                <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {dayLabel}
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <KpiCard
                    label="In progress (started)"
                    icon={Hammer}
                    tone="info"
                    value={overview.today.started.toLocaleString()}
                    context={`First repair photo taken · ${overview.week.started.toLocaleString()} in 7 days`}
                  />
                  <KpiCard
                    label="Completed on site"
                    icon={ClipboardCheck}
                    tone="brand"
                    value={overview.today.completed.toLocaleString()}
                    context={`Marked done by the crew · ${overview.week.completed.toLocaleString()} in 7 days`}
                  />
                  <KpiCard
                    label="Verified"
                    icon={CheckCircle2}
                    tone="success"
                    value={overview.today.verified.toLocaleString()}
                    context={`Signed off by TNB · ${overview.week.verified.toLocaleString()} in 7 days`}
                  />
                </div>
              </section>

              {/* Where all the work stands now — each opens My tasks filtered. */}
              <Card>
                <CardHead title="All work given to the company" />
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 2xl:grid-cols-8">
                  {[
                    { label: "Kejanggalan", value: totals.total, href: tasksLink({}) },
                    { label: "Open", value: open, href: tasksLink({}) },
                    {
                      label: "Sent back",
                      value: totals.SENT_BACK,
                      href: tasksLink({ status: "SENT_BACK" }),
                      alarm: totals.SENT_BACK > 0,
                    },
                    { label: "Waiting for TNB", value: totals.COMPLETED, href: tasksLink({ status: "COMPLETED" }) },
                    { label: "Verified", value: totals.VERIFIED, href: tasksLink({ status: "VERIFIED" }) },
                    { label: "Cannot repair", value: totals.CANNOT_REPAIR, href: tasksLink({ status: "CANNOT_REPAIR" }) },
                    { label: "Overdue", value: totals.overdue, href: tasksLink({}), alarm: totals.overdue > 0 },
                    { label: "No team yet", value: totals.noTeam, href: tasksLink({ teamId: "NONE" }), alarm: totals.noTeam > 0 },
                  ].map((tile) => (
                    <a
                      key={tile.label}
                      href={tile.href}
                      className="group min-w-0 rounded-[8px] px-1 py-0.5 hover:bg-[var(--panel-muted)]"
                    >
                      <span className="block truncate text-[12px] text-[var(--muted)] group-hover:text-[var(--foreground-soft)]">
                        {tile.label}
                      </span>
                      <span
                        className={`block text-[20px] font-bold tabular-nums ${
                          tile.alarm ? "text-[var(--critical)]" : "text-[var(--foreground)]"
                        }`}
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {tile.value.toLocaleString()}
                      </span>
                    </a>
                  ))}
                </div>
                <div className="mt-4">
                  <StatusBar counts={totals} total={totals.total} />
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                    {BAR_PARTS.map((part) => (
                      <span key={part.status} className="inline-flex items-center gap-1.5">
                        <i className="h-2 w-2 rounded-full" style={{ background: part.color }} />
                        {part.label}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>

              <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
                <Card>
                  <CardHead title={`Last ${overview.days} days`} />
                  <div className="mt-3">
                    <MultiLineChart
                      data={overview.series}
                      series={DAY_SERIES}
                      emptyLabel="No repair activity in these 30 days."
                    />
                  </div>
                </Card>
                <Card>
                  <CardHead title="By work type" />
                  {overview.byWorkType.length > 0 ? (
                    <ul className="mt-3 space-y-4">
                      {overview.byWorkType.map((row) => {
                        const pct = row.total === 0 ? 0 : Math.round((row.counts.VERIFIED / row.total) * 100);
                        return (
                          <li key={row.category}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                              <span className="font-semibold text-[var(--foreground)]">
                                {CATEGORY_LABEL[row.category] ?? row.category}
                              </span>
                              <span className="tabular-nums text-[var(--muted)]">
                                <b className="text-[var(--foreground)]">{pct}%</b> verified · {row.counts.VERIFIED}/
                                {row.total}
                              </span>
                            </div>
                            <StatusBar counts={row.counts} total={row.total} />
                            <p className="mt-1 text-[11.5px] text-[var(--muted)]">
                              {row.counts.COMPLETED} waiting for TNB · {row.counts.IN_PROGRESS + row.counts.SENT_BACK}{" "}
                              in progress · {row.counts.TODO} to do
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-[var(--muted)]">No work given to the company yet.</p>
                  )}
                </Card>
              </div>

              <Card padded={false}>
                <div className="px-[18px] pt-[18px]">
                  <CardHead title="Teams" />
                  <p className="mt-1 text-[12.5px] text-[var(--muted)]">
                    Open the team to see each of its Kejanggalan in My tasks.
                  </p>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead className={tableHeadClass}>
                      <tr>
                        <th className={tableHeadCellClass}>Team</th>
                        {showCompany ? <th className={tableHeadCellClass}>Company</th> : null}
                        <th className={tableHeadCellClass}>Pencawang open</th>
                        <th className={tableHeadCellClass}>To do</th>
                        <th className={tableHeadCellClass}>In progress</th>
                        <th className={tableHeadCellClass}>Sent back</th>
                        <th className={tableHeadCellClass}>Waiting for TNB</th>
                        <th className={tableHeadCellClass}>Verified</th>
                        <th className={tableHeadCellClass}>Overdue</th>
                        <th className={tableHeadCellClass}>{isToday ? "Today" : "That day"}</th>
                        <th className={tableHeadCellClass}>7 days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.teams.map((row) => (
                        <tr key={`${row.company.id}|${row.team?.id ?? "NONE"}`} className={tableRowClass}>
                          <td className={tableCellClass}>
                            <a
                              href={tasksLink({
                                teamId: row.team?.id ?? "NONE",
                                organizationId: showCompany ? row.company.id : undefined,
                              })}
                              className="font-semibold text-[var(--brand-strong)] hover:underline"
                            >
                              {row.team?.name ?? "No team yet"}
                            </a>
                          </td>
                          {showCompany ? <td className={tableCellClass}>{row.company.name}</td> : null}
                          <td className={`${tableCellClass} tabular-nums`}>{row.openPencawang}</td>
                          <td className={`${tableCellClass} tabular-nums`}>{row.counts.TODO}</td>
                          <td className={`${tableCellClass} tabular-nums`}>{row.counts.IN_PROGRESS}</td>
                          <td
                            className={`${tableCellClass} tabular-nums ${
                              row.counts.SENT_BACK > 0 ? "font-semibold text-[var(--critical-text)]" : ""
                            }`}
                          >
                            {row.counts.SENT_BACK}
                          </td>
                          <td className={`${tableCellClass} tabular-nums`}>{row.counts.COMPLETED}</td>
                          <td className={`${tableCellClass} tabular-nums`}>{row.counts.VERIFIED}</td>
                          <td
                            className={`${tableCellClass} tabular-nums ${
                              row.overdue > 0 ? "font-semibold text-[var(--critical-text)]" : ""
                            }`}
                          >
                            {row.overdue}
                          </td>
                          <td className={`${tableCellClass} whitespace-nowrap tabular-nums text-[12.5px]`}>
                            {row.today.started} / {row.today.completed} / {row.today.verified}
                          </td>
                          <td className={`${tableCellClass} whitespace-nowrap tabular-nums text-[12.5px]`}>
                            {row.week.started} / {row.week.completed} / {row.week.verified}
                          </td>
                        </tr>
                      ))}
                      {overview.teams.length === 0 ? (
                        <tr>
                          <td colSpan={showCompany ? 11 : 10} className="px-4 py-8 text-center text-[13px] text-[var(--muted)]">
                            No work given to the company yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <p className="px-[18px] py-3 text-[11.5px] text-[var(--muted)]">
                  Day columns: started / completed on site / verified.
                </p>
              </Card>
            </div>
          ) : isLoading ? (
            <Card className="mt-6 px-5 py-12 text-center text-[13px] text-[var(--muted)]">Loading…</Card>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

export function MaintenanceOverviewClient() {
  return (
    <AuthGuard>
      <MaintenanceOverviewContent />
    </AuthGuard>
  );
}
