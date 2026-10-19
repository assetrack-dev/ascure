"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardCheck, Hammer, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { MultiLineChart, type LineSeries } from "@/components/charts";
import { Card, CardHead, KpiCard, PageHeader, Tbtn, filterControlClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchTnbToday } from "@/lib/maintenance-tasks";
import type { AuthSession } from "@/types/auth";
import type { DayCounts, TnbToday } from "@/types/maintenance-tasks";

/**
 * Plan §21.2 #1 — TNB Today: what every contractor company did on a day
 * (default today) per work type, in the three states TNB tracks (R6): In
 * progress (first repair photo), Completed on site (Mark done), Verified — with
 * each work type's running % verified and 30 days across all companies.
 * Phone-first (TNB opens the console on phones, plan §19 N49).
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

/** "3 · 5 · 2": started · completed on site · verified, each coloured. */
function DayTriple({ day, size = "sm" }: { day: DayCounts; size?: "sm" | "lg" }) {
  const cell = size === "lg" ? "text-[18px]" : "text-[14px]";
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: "Started", value: day.started, color: "var(--info)" },
        { label: "Completed", value: day.completed, color: "var(--brand)" },
        { label: "Verified", value: day.verified, color: "var(--success)" },
      ].map((entry) => (
        <div key={entry.label} className="min-w-0">
          <p className="truncate text-[11px] text-[var(--muted)]">{entry.label}</p>
          <p
            className={`${cell} font-bold tabular-nums`}
            style={{ color: entry.value > 0 ? entry.color : "var(--muted-2)", fontFamily: "var(--font-display)" }}
          >
            {entry.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function VerifiedBar({ verified, total }: { verified: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((verified / total) * 100);
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--line2)]">
        <span style={{ width: `${pct}%`, background: "var(--success)" }} />
      </div>
      <p className="mt-1 text-[11.5px] tabular-nums text-[var(--muted)]">
        <b className="text-[var(--foreground)]">{pct}%</b> verified · {verified}/{total}
      </p>
    </div>
  );
}

function TnbTodayContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [date, setDate] = useState(todayMy);
  const [data, setData] = useState<TnbToday | null>(null);
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
        setData(await fetchTnbToday(token, date));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load today's work.");
      } finally {
        setIsLoading(false);
      }
    },
    [date, handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) void load(storedSession.token);
  }, [load]);

  const isToday = date === todayMy();

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            eyebrow="Maintenance"
            title={isToday ? "Today" : formatDay(date)}
            subtitle="What each company did on the day, by work type: repairs started, completed on site, and verified. The bars show how much of each work type is verified so far."
            actions={
              <div className="flex flex-wrap items-center gap-2">
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

          {data ? (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard
                  label="Started"
                  icon={Hammer}
                  tone="info"
                  value={data.today.started.toLocaleString()}
                  context="First repair photo taken"
                />
                <KpiCard
                  label="Completed on site"
                  icon={ClipboardCheck}
                  tone="brand"
                  value={data.today.completed.toLocaleString()}
                  context="Marked done by the crew"
                />
                <KpiCard
                  label="Verified"
                  icon={CheckCircle2}
                  tone="success"
                  value={data.today.verified.toLocaleString()}
                  context="Signed off by TNB"
                />
              </div>

              <section aria-label="Companies" className="space-y-3">
                {data.companies.length > 0 ? (
                  data.companies.map((row) => (
                    <Card key={row.company.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2
                            className="text-[15px] font-semibold text-[var(--foreground)]"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {row.company.name}
                          </h2>
                          <p className="text-[12px] text-[var(--muted)]">
                            {row.total.toLocaleString()} Kejanggalan given · {row.verified.toLocaleString()} verified
                          </p>
                        </div>
                        <div className="w-full max-w-[280px]">
                          <DayTriple day={row.today} size="lg" />
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        {row.lanes.map((lane) => (
                          <div
                            key={lane.category}
                            className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3"
                          >
                            <p className="mb-2 text-[13px] font-semibold text-[var(--foreground)]">
                              {CATEGORY_LABEL[lane.category] ?? lane.category}
                            </p>
                            <DayTriple day={lane.today} />
                            <div className="mt-3">
                              <VerifiedBar verified={lane.counts.VERIFIED} total={lane.total} />
                            </div>
                            <p className="mt-1 text-[11.5px] text-[var(--muted)]">
                              {lane.counts.COMPLETED} waiting for your verification
                            </p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="px-5 py-10 text-center text-[13px] text-[var(--muted)]">
                    No maintenance work on your Mainheads yet.
                  </Card>
                )}
              </section>

              <Card>
                <CardHead title={`Last ${data.days} days · all companies`} />
                <div className="mt-3">
                  <MultiLineChart
                    data={data.series}
                    series={DAY_SERIES}
                    emptyLabel="No repair activity in these 30 days."
                  />
                </div>
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

export function TnbTodayClient() {
  return (
    <AuthGuard>
      <TnbTodayContent />
    </AuthGuard>
  );
}
