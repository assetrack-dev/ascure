"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, MapPin, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import { downloadPencawangReport, fetchReportSubstations } from "@/lib/reports";
import type { AuthSession } from "@/types/auth";
import type { ReportSubstation } from "@/types/reports";

const inputClassName =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const primaryButtonClassName =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-5 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

const REPORT_SHEETS = [
  "Asset Summary",
  "Inspection Results",
  "Defects",
  "Photo URLs",
];

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ReportsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [substations, setSubstations] = useState<ReportSubstation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadData = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const [refreshedUser, nextSubstations] = await Promise.all([
          refreshStoredSessionUser(token).catch(() => null),
          fetchReportSubstations(token),
        ]);

        if (refreshedUser) {
          setSession({ token, user: refreshedUser });
        }

        setSubstations(nextSubstations);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 403) {
          setError("The REPORTING capability is required to access reports.");
          return;
        }

        setError(requestErrorMessage(loadError, "Unable to load the Pencawang list."));
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
      setIsLoading(false);
      return;
    }

    void loadData(storedSession.token);
  }, [loadData]);

  const selectedSubstation = useMemo(
    () => substations.find((substation) => substation.id === selectedId) ?? null,
    [substations, selectedId],
  );

  async function handleDownload() {
    if (!session?.token || !selectedSubstation || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setError("");
    setNotice("");

    try {
      await downloadPencawangReport(session.token, selectedSubstation);
      setNotice(
        `Excel report generated for ${selectedSubstation.code} - ${selectedSubstation.name}.`,
      );
    } catch (downloadError) {
      if (downloadError instanceof ApiError && downloadError.status === 401) {
        handleLogout();
        return;
      }

      if (downloadError instanceof ApiError && downloadError.status === 403) {
        setError("The REPORTING capability is required to download reports.");
        return;
      }

      if (downloadError instanceof ApiError && downloadError.status === 404) {
        setError("That Pencawang could not be found.");
        return;
      }

      setError(requestErrorMessage(downloadError, "Unable to generate the Excel report."));
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operational Reporting
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Reports</h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Download a per-Pencawang (substation) inspection workbook. Each export
                includes four sheets: Asset Summary, Inspection Results, Defects, and Photo
                URLs.
              </p>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadData(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)] sm:p-6">
            {error ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {notice}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Pencawang</span>
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setNotice("");
                  }}
                  disabled={isLoading || substations.length === 0}
                  className={`${inputClassName} mt-1.5`}
                >
                  <option value="">
                    {isLoading
                      ? "Loading Pencawang list…"
                      : substations.length === 0
                        ? "No Pencawang available"
                        : "Select a Pencawang"}
                  </option>
                  {substations.map((substation) => (
                    <option key={substation.id} value={substation.id}>
                      {substation.code} - {substation.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={handleDownload}
                disabled={!selectedSubstation || isDownloading}
                className={primaryButtonClassName}
              >
                <Download size={16} />
                {isDownloading ? "Generating…" : "Download Excel"}
              </button>
            </div>

            {selectedSubstation ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
                <MapPin size={15} className="text-slate-400" />
                {selectedSubstation.location?.trim()
                  ? selectedSubstation.location
                  : "No location recorded for this Pencawang."}
              </div>
            ) : null}

            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Workbook contents
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {REPORT_SHEETS.map((sheet) => (
                  <div
                    key={sheet}
                    className="flex items-center gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-[var(--shadow-soft)]"
                  >
                    <FileSpreadsheet size={16} className="text-[var(--brand)]" />
                    {sheet}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export function ReportsClient() {
  return (
    <AuthGuard>
      <ReportsContent />
    </AuthGuard>
  );
}
