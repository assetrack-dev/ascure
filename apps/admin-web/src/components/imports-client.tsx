"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  commitImport,
  validateImport,
  type ImportCommitResult,
  type ImportSummary,
  type ImportValidateResult,
} from "@/lib/imports";
import type { AuthSession } from "@/types/auth";

const card =
  "rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]";
const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const subtleBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50";

function errMsg(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function StatusChip({ status }: { status: string }) {
  const ok = status === "RESOLVED";
  const className = ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "UNRESOLVED"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "warn" }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs font-semibold uppercase">{label}</p>
    </div>
  );
}

function SummaryGrid({ summary }: { summary: ImportSummary }) {
  const pair = (p: { create: number; update: number }) => `${p.create} new · ${p.update} upd`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Tile label="Pencawang" value={pair(summary.pencawang)} />
      <Tile label="Site Visits" value={pair(summary.siteVisits)} />
      <Tile label="Poles" value={pair(summary.assets)} />
      <Tile label="Inspections" value={pair(summary.inspections)} />
      <Tile label="Item results" value={summary.itemResults.create} />
      <Tile label="Data values" value={summary.inspectionResults.create} />
      <Tile label="Defect obs." value={summary.defects.create} />
      <Tile label="Warnings" value={summary.warnings} tone={summary.warnings > 0 ? "warn" : undefined} />
      <Tile label="Rows skipped" value={summary.rowsSkipped} tone={summary.rowsSkipped > 0 ? "warn" : undefined} />
    </div>
  );
}

function ImportsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batchId, setBatchId] = useState("");
  const [validation, setValidation] = useState<ImportValidateResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) {
      void refreshStoredSessionUser(stored.token)
        .then((user) => user && setSession({ token: stored.token, user }))
        .catch(() => undefined);
    }
  }, []);

  const canImport =
    session?.user?.canImport === true || session?.user?.role === "ADMIN";

  const resetResults = () => {
    setValidation(null);
    setCommitResult(null);
    setError("");
  };

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    resetResults();
  };

  const handleValidate = useCallback(async () => {
    if (!session?.token || !file) return;
    setIsValidating(true);
    setError("");
    setCommitResult(null);
    try {
      setValidation(await validateImport(session.token, file, batchId || undefined));
    } catch (validateError) {
      if (validateError instanceof ApiError && validateError.status === 401) {
        handleLogout();
        return;
      }
      setValidation(null);
      setError(errMsg(validateError, "Validation failed."));
    } finally {
      setIsValidating(false);
    }
  }, [session?.token, file, batchId, handleLogout]);

  const handleCommit = useCallback(async () => {
    if (!session?.token || !file || !validation?.ok) return;
    if (
      !window.confirm(
        `Commit this import (batch "${validation.batchId}")? It writes the foundation data into ASCURE. Idempotent — re-running the same batch updates in place.`,
      )
    ) {
      return;
    }
    setIsCommitting(true);
    setError("");
    try {
      setCommitResult(await commitImport(session.token, file, validation.batchId));
    } catch (commitError) {
      if (commitError instanceof ApiError && commitError.status === 401) {
        handleLogout();
        return;
      }
      setError(errMsg(commitError, "Commit failed."));
    } finally {
      setIsCommitting(false);
    }
  }, [session?.token, file, validation, handleLogout]);

  const rowsWithIssues = validation?.rows.filter((r) => r.errors.length || r.warnings.length) ?? [];

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-5xl">
          <div className="border-b border-[var(--line)] pb-6">
            <p className="text-sm font-semibold uppercase text-[var(--brand)]">Imports</p>
            <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
              AppSheet Masterlist Import
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Upload a SAVR KLB AppSheet export (.xlsx). It lands as <strong>foundation
              data</strong> — a finished historical survey (archived), with poles on the
              network graph and prior-year defects kept as history, ready to be re-inspected.
              Validate first (a dry-run that writes nothing), then commit.
            </p>
          </div>

          {error ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {!canImport ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              You don&rsquo;t have the IMPORT capability. Ask an admin to grant it (or sign in
              as an admin) to run imports.
            </div>
          ) : (
            <>
              <section className={`mt-6 ${card}`}>
                <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                  <FileSpreadsheet size={17} className="text-[var(--brand)]" />
                  Upload
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500">
                      Masterlist file (.xlsx)
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={onPickFile}
                      className="mt-1.5 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-[var(--brand-strong)]"
                    />
                    {file ? (
                      <p className="mt-1.5 text-xs text-[var(--muted)]">
                        {file.name} · {(file.size / 1024).toFixed(0)} KB
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase text-slate-500">
                      Batch ID (optional)
                    </label>
                    <input
                      type="text"
                      value={batchId}
                      onChange={(event) => setBatchId(event.target.value)}
                      placeholder="auto from filename"
                      className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleValidate}
                    disabled={!file || isValidating || isCommitting}
                    className={subtleBtn}
                  >
                    {isValidating ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={15} />
                    )}
                    Validate (dry-run)
                  </button>
                  <button
                    type="button"
                    onClick={handleCommit}
                    disabled={!validation?.ok || isCommitting || isValidating || !!commitResult}
                    className={primaryBtn}
                  >
                    {isCommitting ? (
                      <RefreshCw size={15} className="animate-spin" />
                    ) : (
                      <FileSpreadsheet size={15} />
                    )}
                    Commit import
                  </button>
                  {file ? (
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        resetResults();
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm text-slate-500 hover:text-slate-700"
                    >
                      <X size={15} /> Clear
                    </button>
                  ) : null}
                </div>
              </section>

              {commitResult ? (
                <section className={`mt-6 ${card} border-emerald-200`}>
                  <div className="flex items-center gap-2 text-base font-semibold text-emerald-800">
                    <CheckCircle2 size={17} />
                    {commitResult.ok ? "Import committed" : "Import committed with issues"}
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">Batch {commitResult.batchId}</p>
                  {commitResult.applied ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Tile label="Pencawang" value={commitResult.applied.pencawang} />
                      <Tile label="Poles" value={commitResult.applied.assets} />
                      <Tile label="Inspections" value={commitResult.applied.inspections} />
                      <Tile label="Defect obs." value={commitResult.applied.defects} />
                    </div>
                  ) : null}
                  <ul className="mt-4 space-y-1 text-sm">
                    {commitResult.pencawang.map((p) => (
                      <li key={p.code} className="flex items-center gap-2">
                        {p.status === "committed" ? (
                          <CheckCircle2 size={14} className="text-emerald-600" />
                        ) : (
                          <AlertTriangle size={14} className="text-red-600" />
                        )}
                        <span className="font-semibold text-slate-800">{p.code}</span>
                        <span className="text-[var(--muted)]">
                          {p.status === "committed"
                            ? `${p.assets ?? 0} poles · ${p.inspections ?? 0} inspections`
                            : p.error ?? p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {validation ? (
                <section className={`mt-6 ${card}`}>
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    {validation.ok ? (
                      <CheckCircle2 size={17} className="text-emerald-600" />
                    ) : (
                      <AlertTriangle size={17} className="text-red-600" />
                    )}
                    Dry-run plan {validation.ok ? "(ready to commit)" : "(blocked)"}
                  </div>

                  {validation.blocking.length > 0 ? (
                    <ul className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {validation.blocking.map((b, index) => (
                        <li key={index}>• {b.message ?? b.code ?? "Blocking error"}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
                    {validation.template ? (
                      <span>
                        Template: <strong>{validation.template.name}</strong> v
                        {validation.template.version} ({validation.template.itemCount} items)
                        {validation.template.missingKeys && validation.template.missingKeys.length
                          ? ` · ${validation.template.missingKeys.length} missing keys`
                          : ""}
                      </span>
                    ) : null}
                    {validation.file ? (
                      <span>
                        <strong>{validation.file.dataRows ?? 0}</strong> data rows ·{" "}
                        {validation.file.matchedColumns ?? 0} matched cols
                        {validation.file.unmappedHeaders && validation.file.unmappedHeaders.length
                          ? ` · ${validation.file.unmappedHeaders.length} unmapped`
                          : ""}
                      </span>
                    ) : null}
                  </div>

                  {validation.summary ? (
                    <div className="mt-4">
                      <SummaryGrid summary={validation.summary} />
                    </div>
                  ) : null}

                  {validation.resolution ? (
                    <div className="mt-5 grid gap-4 sm:grid-cols-3">
                      {(
                        [
                          ["Inspectors", validation.resolution.users.map((u) => ({ label: u.email, status: u.status }))],
                          ["Teams", validation.resolution.teams.map((t) => ({ label: t.name, status: t.status }))],
                          ["Mainheads", validation.resolution.mainheads.map((m) => ({ label: m.name, status: m.status }))],
                        ] as const
                      ).map(([title, items]) => (
                        <div key={title}>
                          <p className="mb-1.5 text-xs font-semibold uppercase text-slate-500">
                            {title}
                          </p>
                          {items.length === 0 ? (
                            <p className="text-sm text-[var(--muted)]">None.</p>
                          ) : (
                            <ul className="space-y-1">
                              {items.map((item, index) => (
                                <li key={index} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="truncate text-slate-700">{item.label}</span>
                                  <StatusChip status={item.status} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {rowsWithIssues.length > 0 ? (
                    <div className="mt-5 border-t border-slate-100 pt-4">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Rows with errors / warnings ({rowsWithIssues.length})
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {rowsWithIssues.slice(0, 50).map((r) => (
                          <li key={r.row} className="flex items-start gap-2">
                            <AlertTriangle
                              size={14}
                              className={r.errors.length ? "mt-0.5 text-red-500" : "mt-0.5 text-amber-500"}
                            />
                            <span>
                              <strong>Row {r.row}</strong>
                              {r.assetCode ? ` · ${r.assetCode}` : ""} —{" "}
                              {[...r.errors, ...r.warnings]
                                .map((n) => n.message ?? n.code ?? "issue")
                                .join("; ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {rowsWithIssues.length > 50 ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          …and {rowsWithIssues.length - 50} more.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export function ImportsClient() {
  return (
    <AuthGuard>
      <ImportsContent />
    </AuthGuard>
  );
}
