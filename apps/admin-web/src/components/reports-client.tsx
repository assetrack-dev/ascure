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
import {
  downloadPencawangMasterlist,
  downloadPencawangTemplateMasterlist,
  fetchReportSubstations,
} from "@/lib/reports";
import type { AuthSession } from "@/types/auth";
import type { ReportSubstation } from "@/types/reports";

const inputClassName =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const primaryButtonClassName =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "DALAM_RONDAAN", label: "Dalam Rondaan" },
  { value: "RONDAAN_SELESAI", label: "Rondaan Selesai" },
  { value: "PERLU_PINDAAN", label: "Perlu Pindaan" },
  { value: "LAPORAN_SELESAI", label: "Laporan Selesai" },
  { value: "ARKIB", label: "Arkib" },
];

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ReportsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [substations, setSubstations] = useState<ReportSubstation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mainhead, setMainhead] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
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

  // Distinct MAINHEAD options across the Pencawang list (for the mainhead filter).
  const mainheadOptions = useMemo(
    () =>
      Array.from(
        new Set(
          substations
            .map((substation) => substation.mainhead?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [substations],
  );

  // The Pencawang dropdown is narrowed to the selected MAINHEAD.
  const visibleSubstations = useMemo(
    () =>
      mainhead === "ALL"
        ? substations
        : substations.filter((substation) => substation.mainhead === mainhead),
    [substations, mainhead],
  );

  const selectedSubstation = useMemo(
    () => substations.find((substation) => substation.id === selectedId) ?? null,
    [substations, selectedId],
  );

  // If the chosen MAINHEAD no longer contains the selected Pencawang, clear it.
  useEffect(() => {
    if (
      selectedId &&
      !visibleSubstations.some((substation) => substation.id === selectedId)
    ) {
      setSelectedId("");
    }
  }, [visibleSubstations, selectedId]);

  async function handleDownload() {
    if (!session?.token || !selectedSubstation || isDownloading) {
      return;
    }

    setIsDownloading(true);
    setError("");
    setNotice("");

    try {
      await downloadPencawangMasterlist(session.token, selectedSubstation, status);
      setNotice(
        `Masterlist generated for ${selectedSubstation.code} - ${selectedSubstation.name}.`,
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

  async function handleDownloadTemplate() {
    if (
      !session?.token ||
      !selectedSubstation ||
      isDownloading ||
      isDownloadingTemplate
    ) {
      return;
    }

    setIsDownloadingTemplate(true);
    setError("");
    setNotice("");

    try {
      await downloadPencawangTemplateMasterlist(session.token, selectedSubstation, status);
      setNotice(
        `Checklist report generated for ${selectedSubstation.code} - ${selectedSubstation.name}.`,
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
      setIsDownloadingTemplate(false);
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
                Download a per-Pencawang report (.xlsx) — one pole per row, checklist items
                as columns. <strong>Checklist</strong> follows your live checklist template
                (columns update when you edit it); <strong>Masterlist (AppSheet)</strong> uses
                the fixed SAVR-KLB import layout. Filter by survey status as needed.
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

            <div className="grid gap-4 sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)_minmax(0,180px)_auto] sm:items-end">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Mainhead</span>
                <select
                  value={mainhead}
                  onChange={(event) => {
                    setMainhead(event.target.value);
                    setNotice("");
                  }}
                  disabled={isLoading || mainheadOptions.length === 0}
                  className={`${inputClassName} mt-1.5`}
                >
                  <option value="ALL">All mainheads</option>
                  {mainheadOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Pencawang</span>
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setNotice("");
                  }}
                  disabled={isLoading || visibleSubstations.length === 0}
                  className={`${inputClassName} mt-1.5`}
                >
                  <option value="">
                    {isLoading
                      ? "Loading Pencawang list…"
                      : substations.length === 0
                        ? "No Pencawang available"
                        : visibleSubstations.length === 0
                          ? "No Pencawang for this mainhead"
                          : "Select a Pencawang"}
                  </option>
                  {visibleSubstations.map((substation) => (
                    <option key={substation.id} value={substation.id}>
                      {substation.code} - {substation.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Status</span>
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setNotice("");
                  }}
                  className={`${inputClassName} mt-1.5`}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  disabled={!selectedSubstation || isDownloading || isDownloadingTemplate}
                  className={primaryButtonClassName}
                >
                  <Download size={16} />
                  {isDownloadingTemplate ? "Generating…" : "Download Checklist"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!selectedSubstation || isDownloading || isDownloadingTemplate}
                  className={secondaryButtonClassName}
                  title="Fixed SAVR-KLB AppSheet layout — re-importable through the F2 importer."
                >
                  <Download size={16} />
                  {isDownloading ? "Generating…" : "Masterlist (AppSheet)"}
                </button>
              </div>
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
              <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-[var(--shadow-soft)]">
                <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                <span>
                  SAVR masterlist — one row per pole, checklist items as columns
                  (matches the AppSheet import layout). Saved as{" "}
                  <span className="font-semibold">[NAMA PENCAWANG]_MASTERLIST.xlsx</span>.
                </span>
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
