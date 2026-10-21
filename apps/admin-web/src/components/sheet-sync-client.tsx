"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FlaskConical, Plus, RefreshCw, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ErrorBanner } from "@/components/maintenance-packages-shared";
import {
  Card,
  Chip,
  PageHeader,
  Tbtn,
  filterControlClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  createSheetSyncTarget,
  downloadSheetSyncCheckList,
  fetchSheetSyncRun,
  fetchSheetSyncRuns,
  fetchSheetSyncTargets,
  startSheetSyncRun,
  updateSheetSyncTarget,
  type SheetSyncIssue,
  type SheetSyncRun,
  type SheetSyncSummary,
  type SheetSyncTarget,
} from "@/lib/sheet-sync";
import type { AuthSession } from "@/types/auth";

const ISSUE_LABELS: Record<string, string> = {
  PE_NOT_FOUND: "Pencawang not in ASCURE",
  POLE_NOT_FOUND: "No Tiang not in ASCURE",
  GPS_MISMATCH: "GPS too far",
  NO_GPS: "No GPS to confirm",
  DUPLICATE_ROW: "Pole on 2 rows",
  CLASH: "Different date already there",
  NO_COLUMN: "Item has no column",
  UNKNOWN_GROUP: "Unknown date column",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const notMatched = (summary: SheetSyncSummary) =>
  summary.pencawangNotFound + summary.poleNotFound + summary.gpsMismatch + summary.noGps;

function RunStatus({ run }: { run: SheetSyncRun }) {
  if (run.status === "RUNNING") return <Chip tone="info" dot>Running…</Chip>;
  if (run.status === "FAILED") return <Chip tone="critical" dot>Failed</Chip>;
  return <Chip tone={run.dryRun ? "neutral" : "success"} dot>{run.dryRun ? "Dry run" : "Written"}</Chip>;
}

function SummaryGrid({ summary }: { summary: SheetSyncSummary }) {
  const tiles: Array<[string, number, string?]> = [
    ["Rows in the sheet", summary.rows],
    ["Matched to an ASCURE pole", summary.matched],
    ["Not matched", notMatched(summary), "Pencawang / No Tiang not found, GPS too far or missing"],
    ["Verified repairs found", summary.verifiedRepairs],
    [summary.issuesTruncated ? "Dates to write" : "Dates written / to write", summary.written + summary.updated],
    ["Already correct", summary.alreadyCorrect],
    ["Clashes (left alone)", summary.clashes, "The cell already has a different date — someone typed it"],
    ["Taken back (sent back)", summary.cleared],
    ["Repairs with no column", summary.noColumn],
    ["Duplicate rows", summary.duplicateRows],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map(([label, value, hint]) => (
        <div key={label} title={hint} className="rounded-[10px] border border-[var(--line)] px-3 py-2">
          <p className="text-[11px] text-[var(--muted)]">{label}</p>
          <p className="font-mono text-[16px] font-semibold text-[var(--foreground)]">{value.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * ADMIN (docs/PLAN-google-sheet-repair-sync.md): the TNB Google Sheets that
 * ASCURE fills every night at 22:00 with the repair date of each verified
 * repair. Writing stays off until the owner has reviewed a dry run.
 */
function SheetSyncContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [targets, setTargets] = useState<SheetSyncTarget[] | null>(null);
  const [runs, setRuns] = useState<Record<string, SheetSyncRun[]>>({});
  const [detail, setDetail] = useState<(SheetSyncRun & { issues: SheetSyncIssue[]; issueCount: number }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ name: "", spreadsheet: "", sheetTitle: "QR03" });

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

  const load = useCallback(
    async (token: string, quiet = false) => {
      if (!quiet) setIsLoading(true);
      try {
        const result = await fetchSheetSyncTargets(token);
        setEmail(result.serviceAccountEmail);
        setTargets(result.targets);
        const entries = await Promise.all(
          result.targets.map(async (target) => [target.id, await fetchSheetSyncRuns(token, target.id)] as const),
        );
        setRuns(Object.fromEntries(entries));
      } catch (failure) {
        fail(failure, "Unable to load the sheets.");
      } finally {
        setIsLoading(false);
      }
    },
    [fail],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) void load(stored.token);
  }, [load]);

  const token = session?.token ?? null;
  const running = Object.values(runs).some((list) => list.some((run) => run.status === "RUNNING"));

  // A run takes ~10–30 s — keep the page current while one is going.
  useEffect(() => {
    if (!token || !running) return;
    const timer = window.setInterval(() => void load(token, true), 4000);
    return () => window.clearInterval(timer);
  }, [token, running, load]);

  const act = async (key: string, action: () => Promise<unknown>, fallback: string) => {
    if (!token) return;
    setBusy(key);
    setError("");
    try {
      await action();
      await load(token, true);
    } catch (failure) {
      fail(failure, fallback);
    } finally {
      setBusy(null);
    }
  };

  const openRun = async (runId: string) => {
    if (!token) return;
    setBusy(`run:${runId}`);
    try {
      setDetail(await fetchSheetSyncRun(token, runId));
    } catch (failure) {
      fail(failure, "Unable to open the run.");
    } finally {
      setBusy(null);
    }
  };

  const toggleWriting = (target: SheetSyncTarget) => {
    if (
      !target.writeEnabled &&
      !window.confirm(
        `Switch writing ON for "${target.name}"?\n\nFrom tonight (and on Sync now) ASCURE writes the repair dates into this Google Sheet. It never overwrites a date someone typed.`,
      )
    ) {
      return;
    }
    void act(target.id, () => updateSheetSyncTarget(token!, target.id, { writeEnabled: !target.writeEnabled }), "Could not save.");
  };

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-5xl">
          <PageHeader
            eyebrow="Setup"
            title="Google Sheet sync"
            subtitle="Every night at 10pm (Malaysia), ASCURE writes the repair date of each repair TNB has verified into the matching “Tarikh Pembaikan” cell. A row is matched by Pencawang + No Tiang and confirmed by GPS. A date someone typed is never overwritten."
            actions={
              <Tbtn onClick={() => (token ? load(token) : undefined)} disabled={isLoading}>
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
            }
          />

          <div className="mt-6 space-y-4">
            <ErrorBanner error={error} />

            <Card>
              {email ? (
                <p className="text-[13px] text-[var(--foreground-soft)]">
                  Share each Google Sheet with <span className="select-all font-mono font-semibold text-[var(--foreground)]">{email}</span> as{" "}
                  <b>Editor</b> (untick “Notify people”).
                </p>
              ) : (
                <p className="text-[13px] text-[var(--muted)]">
                  Not set up on this server yet: the Google key file (SHEET_SYNC_KEY_FILE) is missing.
                </p>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Name, e.g. Kuantan Tier 1"
                  maxLength={80}
                  className={`${filterControlClass} sm:w-48`}
                />
                <input
                  value={draft.spreadsheet}
                  onChange={(event) => setDraft((current) => ({ ...current, spreadsheet: event.target.value }))}
                  placeholder="Google Sheet link"
                  className={`${filterControlClass} flex-1`}
                />
                <input
                  value={draft.sheetTitle}
                  onChange={(event) => setDraft((current) => ({ ...current, sheetTitle: event.target.value }))}
                  aria-label="Tab"
                  placeholder="Tab"
                  maxLength={100}
                  className={`${filterControlClass} sm:w-24`}
                />
                <Tbtn
                  variant="primary"
                  disabled={!email || draft.name.trim().length < 2 || draft.spreadsheet.trim().length < 20 || busy === "new"}
                  onClick={() =>
                    void act(
                      "new",
                      async () => {
                        await createSheetSyncTarget(token!, draft);
                        setDraft({ name: "", spreadsheet: "", sheetTitle: "QR03" });
                      },
                      "Could not add the sheet.",
                    )
                  }
                >
                  <Plus size={16} /> Add sheet
                </Tbtn>
              </div>
            </Card>

            {(targets ?? []).length === 0 && !isLoading ? (
              <Card>
                <p className="text-[13px] text-[var(--muted)]">No sheet yet. Add the Tier 1 sheet above.</p>
              </Card>
            ) : null}

            {(targets ?? []).map((target) => {
              const list = runs[target.id] ?? [];
              const isRunning = list.some((run) => run.status === "RUNNING");
              return (
                <Card key={target.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[15px] font-semibold text-[var(--foreground)]">{target.name}</p>
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${target.spreadsheetId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[12.5px] text-[var(--brand)] hover:underline"
                    >
                      Open sheet <ExternalLink size={12} />
                    </a>
                    <span className="text-[12px] text-[var(--muted)]">tab {target.sheetTitle}</span>
                    {target.writeEnabled ? (
                      <Chip tone="success" dot>Writing ON — nightly 10pm</Chip>
                    ) : (
                      <Chip tone="warning" dot>Writing OFF — dry run nightly</Chip>
                    )}
                    <span className="text-[12px] text-[var(--muted)]">{target.cellsWritten.toLocaleString()} cells written by ASCURE</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Tbtn
                      onClick={() => void act(target.id, () => startSheetSyncRun(token!, target.id, true), "Could not start.")}
                      disabled={!email || isRunning || busy !== null}
                    >
                      <FlaskConical size={15} /> Dry run
                    </Tbtn>
                    <Tbtn
                      variant="primary"
                      onClick={() => void act(target.id, () => startSheetSyncRun(token!, target.id, false), "Could not start.")}
                      disabled={!email || !target.writeEnabled || isRunning || busy !== null}
                      title={target.writeEnabled ? undefined : "Switch writing on first"}
                    >
                      <Send size={15} /> Sync now
                    </Tbtn>
                    <Tbtn
                      variant={target.writeEnabled ? "ghost" : "secondary"}
                      onClick={() => toggleWriting(target)}
                      disabled={busy !== null}
                    >
                      {target.writeEnabled ? "Switch writing off" : "Switch writing on"}
                    </Tbtn>
                  </div>

                  {list.length ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full min-w-[640px]">
                        <thead className={tableHeadClass}>
                          <tr>
                            <th className={tableHeadCellClass}>When</th>
                            <th className={tableHeadCellClass}>Run</th>
                            <th className={tableHeadCellClass}>Result</th>
                            <th className={tableHeadCellClass}>Dates</th>
                            <th className={tableHeadCellClass}>Clashes</th>
                            <th className={tableHeadCellClass}>Not matched</th>
                            <th className={tableHeadCellClass} />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--line)]">
                          {list.slice(0, 10).map((run) => (
                            <tr key={run.id} className={detail?.id === run.id ? "bg-[var(--brand-tint)]" : undefined}>
                              <td className={tableCellClass}>{when(run.startedAt)}</td>
                              <td className={tableCellClass}>
                                {run.trigger === "NIGHTLY" ? "Nightly" : run.triggeredByEmail ?? "Manual"}
                              </td>
                              <td className={tableCellClass}>
                                <RunStatus run={run} />
                              </td>
                              <td className={tableCellClass}>
                                {run.summary ? (run.summary.written + run.summary.updated).toLocaleString() : "—"}
                              </td>
                              <td className={tableCellClass}>{run.summary ? run.summary.clashes.toLocaleString() : "—"}</td>
                              <td className={tableCellClass}>{run.summary ? notMatched(run.summary).toLocaleString() : "—"}</td>
                              <td className={`${tableCellClass} text-right`}>
                                {run.status !== "RUNNING" ? (
                                  <Tbtn onClick={() => void openRun(run.id)} disabled={busy !== null}>
                                    Details
                                  </Tbtn>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-3 text-[12.5px] text-[var(--muted)]">No run yet — start with a dry run.</p>
                  )}

                  {detail && detail.targetId === target.id ? (
                    <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-[var(--foreground)]">
                          {when(detail.startedAt)} · {detail.dryRun ? "Dry run (nothing written)" : "Written to the sheet"}
                        </p>
                        <Tbtn
                          onClick={() => void act(`dl:${detail.id}`, () => downloadSheetSyncCheckList(token!, detail.id), "Download failed.")}
                          disabled={busy !== null || detail.issueCount === 0}
                        >
                          <Download size={15} /> Check list ({detail.issueCount.toLocaleString()})
                        </Tbtn>
                        <Tbtn variant="ghost" onClick={() => setDetail(null)}>
                          Close
                        </Tbtn>
                      </div>
                      {detail.error ? <ErrorBanner error={detail.error} /> : null}
                      {detail.summary ? <SummaryGrid summary={detail.summary} /> : null}
                      {detail.issues.length ? (
                        <div className="max-h-[420px] overflow-auto rounded-[10px] border border-[var(--line)]">
                          <table className="w-full min-w-[720px]">
                            <thead className={`${tableHeadClass} sticky top-0`}>
                              <tr>
                                <th className={tableHeadCellClass}>Issue</th>
                                <th className={tableHeadCellClass}>Row</th>
                                <th className={tableHeadCellClass}>Pencawang</th>
                                <th className={tableHeadCellClass}>No Tiang</th>
                                <th className={tableHeadCellClass}>Detail</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--line)]">
                              {detail.issues.map((issue, index) => (
                                <tr key={index}>
                                  <td className={tableCellClass}>{ISSUE_LABELS[issue.type] ?? issue.type}</td>
                                  <td className={tableCellClass}>{issue.row ?? ""}</td>
                                  <td className={tableCellClass}>{issue.pencawang ?? ""}</td>
                                  <td className={tableCellClass}>{issue.pole ?? ""}</td>
                                  <td className={tableCellClass}>
                                    {issue.type === "CLASH"
                                      ? `${issue.group}: sheet ${issue.sheetValue}, ASCURE ${issue.ascureValue}`
                                      : [issue.detail, issue.count ? `${issue.count}×` : ""].filter(Boolean).join(" · ")}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {detail.issueCount > detail.issues.length ? (
                            <p className="px-3.5 py-2 text-[12px] text-[var(--muted)]">
                              First {detail.issues.length} of {detail.issueCount.toLocaleString()} — download the check list for all.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function SheetSyncClient() {
  return (
    <AuthGuard>
      <SheetSyncContent />
    </AuthGuard>
  );
}
