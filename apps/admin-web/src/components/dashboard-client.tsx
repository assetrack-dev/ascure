"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Bug,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { MetricCard } from "@/components/metric-card";
import { SimpleBarChart } from "@/components/simple-bar-chart";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchDashboardMetrics } from "@/lib/dashboard";
import type { AuthSession } from "@/types/auth";
import type { DashboardMetrics } from "@/types/dashboard";

function DashboardLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-36 animate-pulse rounded-lg border border-[var(--line)] bg-white"
        />
      ))}
    </div>
  );
}

function RecentDefects({ defects }: { defects: DashboardMetrics["recentDefects"] }) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-[var(--foreground)]">Recent Defects</h2>
        <span className="text-sm text-[var(--muted)]">{defects.length} latest</span>
      </div>

      <div className="mt-5 overflow-x-auto">
        {defects.length > 0 ? (
          <table className="min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-3 py-3 font-semibold">Asset</th>
                <th className="px-3 py-3 font-semibold">Defect</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {defects.map((defect) => (
                <tr key={defect.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">
                    {defect.assetCode}
                  </td>
                  <td className="min-w-64 px-3 py-3 text-slate-700">{defect.label}</td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                      {defect.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                    {new Intl.DateTimeFormat("en-MY", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(defect.createdAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
            No recent defects returned by the API.
          </div>
        )}
      </div>
    </section>
  );
}

function DashboardContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadDashboard = useCallback(
    async (token: string) => {
      setIsLoading(true);
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
        setIsLoading(false);
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

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-5 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#0f766e]">
                Operations Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--foreground)]">
                ASCURE Admin
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                Asset and defect visibility for utility field inspection workflows.
              </p>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadDashboard(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#0f766e] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !metrics ? (
              <DashboardLoading />
            ) : error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
                {error}
              </div>
            ) : metrics ? (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                  <MetricCard
                    title="Critical Defects"
                    value={metrics.criticalDefects}
                    detail="Ready for severity data from the API."
                    icon={ShieldAlert}
                    tone="danger"
                  />
                </div>

                <div className="grid gap-6 xl:grid-cols-2">
                  <SimpleBarChart
                    title="Defects by Severity"
                    data={metrics.defectsBySeverity}
                    emptyLabel="Severity breakdown is pending backend data."
                    tone="rose"
                  />
                  <SimpleBarChart
                    title="Assets by Type"
                    data={metrics.assetsByType}
                    emptyLabel="No asset type counts are available yet."
                    tone="teal"
                  />
                </div>

                <RecentDefects defects={metrics.recentDefects} />
              </div>
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
