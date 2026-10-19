"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileArchive, FileText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  CardHead,
  PageHeader,
  Seg,
  Tbtn,
  filterControlClass,
  filterSelectClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  downloadRepairReportsZipFile,
  fetchRepairReportsZipStatus,
  type RepairZipJobStatus,
} from "@/lib/maintenance-packages";
import { fetchReportPeriod, fetchTaskGroups, startRepairReportsByDate } from "@/lib/maintenance-tasks";
import type { AuthSession } from "@/types/auth";
import type { ReportPeriod, ReportPeriodStatus, TaskGroups } from "@/types/maintenance-tasks";

/**
 * Plan §21.2 #5 (R7) — a maintenance company's repair reports by date: pick a
 * period and WHICH status counts, and the server builds one repair PDF per
 * Pencawang (only that period's Kejanggalan, "Tempoh" in the header, DRAF while
 * any of them is not verified) plus ringkasan.xlsx, as one ZIP.
 */

const STATUS_OPTIONS: Array<{ value: ReportPeriodStatus; label: string }> = [
  { value: "VERIFIED", label: "Verified · for claims" },
  { value: "COMPLETED", label: "Completed on site · not verified" },
  { value: "BOTH", label: "Both" },
];

const STATUS_HINT: Record<ReportPeriodStatus, string> = {
  VERIFIED: "Kejanggalan TNB verified in the period. Only these are valid for a claim.",
  COMPLETED:
    "Kejanggalan the crew marked done in the period that TNB has not verified yet. The PDFs are marked DRAF: not for claims.",
  BOTH: "Verified in the period, plus marked done in the period and still waiting for TNB. A PDF is marked DRAF while any listed Kejanggalan is not verified.",
};

const CATEGORY_LABEL: Record<string, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

/** yyyy-mm-dd in Malaysia (UTC+8). */
function myDay(offsetDays = 0) {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

function presets() {
  const today = myDay();
  const [year, month] = today.split("-").map(Number);
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastMonthYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthEnd = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
  return [
    { label: "This month", from: `${year}-${pad(month)}-01`, to: today },
    { label: "Last month", from: `${lastMonthYear}-${pad(lastMonth)}-01`, to: lastMonthEnd },
    { label: "Last 7 days", from: myDay(-6), to: today },
  ];
}

function MaintenanceReportsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [from, setFrom] = useState(() => presets()[0].from);
  const [to, setTo] = useState(myDay);
  const [status, setStatus] = useState<ReportPeriodStatus>("VERIFIED");
  const [category, setCategory] = useState("");
  const [teamId, setTeamId] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [options, setOptions] = useState<TaskGroups | null>(null);
  const [preview, setPreview] = useState<ReportPeriod | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ id: string; status: RepairZipJobStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

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

  // Company / team choices: everything in the caller's reach.
  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (!storedSession?.token) return;
    fetchTaskGroups(storedSession.token, {}, 0)
      .then(setOptions)
      .catch((failure) => fail(failure, "Unable to load your teams."));
  }, [fail]);

  useEffect(
    () => () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    },
    [],
  );

  const periodOptions = {
    from,
    to,
    status,
    category: category || undefined,
    teamId: teamId || undefined,
    organizationId: organizationId || undefined,
  };
  const periodKey = JSON.stringify(periodOptions);

  // What the ZIP would hold — refreshed a moment after the choices settle.
  useEffect(() => {
    const token = session?.token;
    if (!token || !from || !to || from > to) {
      setPreview(null);
      return;
    }
    setJob(null);
    setIsPreviewing(true);
    const timer = window.setTimeout(() => {
      fetchReportPeriod(token, JSON.parse(periodKey))
        .then((result) => {
          setPreview(result);
          setError("");
        })
        .catch((failure) => fail(failure, "Unable to check the period."))
        .finally(() => setIsPreviewing(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [fail, from, periodKey, session?.token, to]);

  const poll = (token: string, jobId: string) => {
    pollRef.current = window.setTimeout(async () => {
      try {
        const next = await fetchRepairReportsZipStatus(token, jobId);
        setJob({ id: jobId, status: next });
        if (next.status === "RUNNING") poll(token, jobId);
        else setBusy(false);
      } catch (failure) {
        setBusy(false);
        fail(failure, "Lost track of the ZIP job.");
      }
    }, 1500);
  };

  const startZip = async () => {
    const token = session?.token;
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const started = await startRepairReportsByDate(token, periodOptions);
      setJob({
        id: started.jobId,
        status: { status: "RUNNING", processed: 0, total: started.total, currentLabel: null, error: null },
      });
      poll(token, started.jobId);
    } catch (failure) {
      setBusy(false);
      fail(failure, "Unable to start the ZIP.");
    }
  };

  const downloadZip = async () => {
    if (!job || !session?.token) return;
    try {
      await downloadRepairReportsZipFile(session.token, job.id);
    } catch (failure) {
      fail(failure, "Unable to download the ZIP.");
    }
  };

  const showCompany = (options?.companies.length ?? 0) > 1;
  const teams = (options?.teams ?? []).filter((team) => !organizationId || team.organizationId === organizationId);
  const badRange = Boolean(from && to && from > to);
  const running = job?.status.status === "RUNNING";
  const done = job?.status.status === "COMPLETED";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Reports"
            subtitle="Repair reports for a period: one PDF per Pencawang with only that period's Kejanggalan, plus a ringkasan.xlsx with one row per Kejanggalan, in one ZIP."
          />

          <div className="mt-6 space-y-5">
            <Card>
              <CardHead title="Repair reports by date" />
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-[12.5px] font-semibold text-[var(--foreground-soft)]">From</span>
                    <input
                      id="report-from"
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
                      id="report-to"
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
                </div>
                {badRange ? (
                  <p className="text-[12.5px] font-semibold text-[var(--critical-text)]">
                    The From date is after the To date.
                  </p>
                ) : null}

                <div>
                  <p className="mb-1.5 text-[12.5px] font-semibold text-[var(--foreground-soft)]">Which Kejanggalan</p>
                  <div className="overflow-x-auto">
                    <Seg aria-label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
                  </div>
                  <p
                    className={`mt-2 text-[12.5px] ${
                      status === "VERIFIED" ? "text-[var(--muted)]" : "text-[var(--warning-text)]"
                    }`}
                  >
                    {STATUS_HINT[status]}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  {showCompany ? (
                    <select
                      aria-label="Company"
                      value={organizationId}
                      onChange={(event) => {
                        setOrganizationId(event.target.value);
                        setTeamId("");
                      }}
                      className={filterSelectClass}
                    >
                      <option value="">All companies</option>
                      {options?.companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <select
                    aria-label="Work type"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="">All work types</option>
                    {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label} only
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Team"
                    value={teamId}
                    onChange={(event) => setTeamId(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="">All teams</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
                  {isPreviewing && !preview ? (
                    <p className="text-[13px] text-[var(--muted)]">Checking the period…</p>
                  ) : preview ? (
                    preview.targets.length > 0 ? (
                      <>
                        <p className="text-[13px] text-[var(--foreground)]">
                          <b>{preview.pencawang.toLocaleString()}</b> Pencawang ·{" "}
                          <b>{preview.kejanggalan.toLocaleString()}</b> Kejanggalan
                          {isPreviewing ? <span className="text-[var(--muted)]"> · updating…</span> : null}
                        </p>
                        <ul className="mt-2 max-h-[220px] space-y-1 overflow-y-auto text-[12.5px] text-[var(--foreground-soft)]">
                          {preview.targets.map((target) => (
                            <li
                              key={`${target.siteVisitId}|${target.company.id}`}
                              className="flex justify-between gap-3"
                            >
                              <span className="min-w-0 truncate">
                                {target.pencawangName ?? "Unnamed Pencawang"}
                                {showCompany ? (
                                  <span className="text-[var(--muted)]"> · {target.company.name}</span>
                                ) : null}
                              </span>
                              <span className="shrink-0 tabular-nums text-[var(--muted)]">{target.count}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-[13px] text-[var(--muted)]">
                        No Kejanggalan in this period with this status. Try another period or status.
                      </p>
                    )
                  ) : (
                    <p className="text-[13px] text-[var(--muted)]">Pick a period.</p>
                  )}
                </div>

                {error ? (
                  <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
                    {error}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  {done ? (
                    <Tbtn variant="primary" onClick={() => void downloadZip()}>
                      <Download size={16} />
                      Download ZIP
                    </Tbtn>
                  ) : (
                    <Tbtn
                      variant="primary"
                      onClick={() => void startZip()}
                      disabled={busy || badRange || !preview || preview.targets.length === 0}
                    >
                      <FileArchive size={16} />
                      {running
                        ? "Building…"
                        : `Build ZIP${preview && preview.pencawang > 0 ? ` (${preview.pencawang} Pencawang)` : ""}`}
                    </Tbtn>
                  )}
                  {job ? (
                    <span className="text-[12.5px] text-[var(--muted)]">
                      {running
                        ? `${job.status.processed} of ${job.status.total}${
                            job.status.currentLabel ? ` · ${job.status.currentLabel}` : ""
                          }`
                        : done
                          ? `Ready: ${job.status.total} Pencawang + ringkasan.xlsx`
                          : job.status.error ?? "The ZIP failed."}
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>

            <Card>
              <CardHead title="One Pencawang" />
              <p className="mt-2 flex items-start gap-2 text-[13px] text-[var(--muted)]">
                <FileText size={16} className="mt-0.5 shrink-0" />
                <span>
                  For one Pencawang&apos;s full repair report (every Kejanggalan, any date), open{" "}
                  <a href="/maintenance-packages" className="font-semibold text-[var(--brand-strong)] hover:underline">
                    Pencawang
                  </a>{" "}
                  and use Report on its row.
                </span>
              </p>
            </Card>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function MaintenanceReportsClient() {
  return (
    <AuthGuard>
      <MaintenanceReportsContent />
    </AuthGuard>
  );
}
