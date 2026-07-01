"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  downloadCrewPerformance,
  fetchCrewPerformance,
  type CrewPerformance,
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
      setError(
        requestErrorMessage(downloadError, "Unable to download the pay sheet."),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const rows = data?.users ?? [];

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <div className="space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-[var(--brand)]">
            <BarChart3 className="h-5 w-5" />
            <h1 className="text-xl font-bold text-slate-900">Crew Performance</h1>
          </div>
          <p className="text-sm text-slate-600">
            Distinct assets inspected per crew member, for monitoring and payment.
            Scoped to your own company. Pick a month and download the pay sheet.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Month
            <input
              type="month"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={isDownloading || rows.length === 0}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-[var(--brand)] bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {isDownloading ? "Preparing..." : "Download XLSX"}
          </button>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        {data ? (
          <p className="text-xs font-semibold text-slate-500">
            {data.period} &middot; {data.totalAssetsInspected} poles inspected &middot;{" "}
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-white shadow-[var(--shadow-card)]">
          <table className="min-w-full divide-y divide-[var(--line)] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3 text-right">Assets Inspected</th>
                <th className="px-4 py-3 text-right">Inspections</th>
                <th className="px-4 py-3 text-right">Visits</th>
                <th className="px-4 py-3 text-right">Active Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    Loading&hellip;
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No inspections submitted in this period.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.userId} className="align-middle">
                    <td className="px-4 py-3 tabular-nums text-slate-500">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.role ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.teamName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                      {row.assetsInspected}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.submittedInspections}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.visits}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {row.activeDays}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
