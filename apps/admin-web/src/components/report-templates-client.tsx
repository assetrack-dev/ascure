"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  OPERATIONAL_SCOPES,
  deleteReportTemplate,
  listReportTemplates,
  uploadReportTemplate,
  type OperationalScope,
  type ReportTemplate,
} from "@/lib/report-templates";
import type { AuthSession } from "@/types/auth";

const card =
  "rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]";
const primaryBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";

function errMsg(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ReportTemplatesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<OperationalScope>(OPERATIONAL_SCOPES[0]);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const refreshTemplates = useCallback(
    async (token: string) => {
      try {
        setTemplates(await listReportTemplates(token));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(errMsg(loadError, "Could not load templates."));
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (stored?.token) {
      void refreshStoredSessionUser(stored.token)
        .then((user) => user && setSession({ token: stored.token, user }))
        .catch(() => undefined);
      void refreshTemplates(stored.token);
    }
  }, [refreshTemplates]);

  const isAdmin = session?.user?.role === "ADMIN";

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setError("");
    setNotice("");
  };

  const handleUpload = useCallback(async () => {
    if (!session?.token || !file) return;
    setIsUploading(true);
    setError("");
    setNotice("");
    try {
      const created = await uploadReportTemplate(
        session.token,
        file,
        scope,
        name,
      );
      setNotice(
        `Uploaded "${created.name}" for ${created.operationalScope} (v${created.version}).`,
      );
      setFile(null);
      setName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshTemplates(session.token);
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 401) {
        handleLogout();
        return;
      }
      setError(errMsg(uploadError, "Template upload failed."));
    } finally {
      setIsUploading(false);
    }
  }, [session?.token, file, scope, name, refreshTemplates, handleLogout]);

  const handleDelete = useCallback(
    async (template: ReportTemplate) => {
      if (!session?.token) return;
      if (
        !window.confirm(
          `Delete template "${template.name}" (${template.operationalScope} v${template.version})? This removes it permanently.`,
        )
      ) {
        return;
      }
      setDeletingId(template.id);
      setError("");
      setNotice("");
      try {
        await deleteReportTemplate(session.token, template.id);
        setNotice(`Deleted "${template.name}" (${template.operationalScope}).`);
        await refreshTemplates(session.token);
      } catch (deleteError) {
        if (deleteError instanceof ApiError && deleteError.status === 401) {
          handleLogout();
          return;
        }
        setError(errMsg(deleteError, "Template delete failed."));
      } finally {
        setDeletingId(null);
      }
    },
    [session?.token, refreshTemplates, handleLogout],
  );

  const activeByScope = new Map<string, ReportTemplate>();
  for (const t of templates) {
    if (t.isActive) activeByScope.set(t.operationalScope, t);
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-5xl">
          <div className="border-b border-[var(--line)] pb-6">
            <p className="text-sm font-semibold uppercase text-[var(--brand)]">
              Report Templates
            </p>
            <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
              Visual Report Templates
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              Upload a Microsoft Word (.docx) template per asset operational
              scope. Each asset&rsquo;s submitted inspection fills the template
              (photos, readings, defects); at <strong>LAPORAN SELESAI</strong> all
              asset reports are merged into one frozen PDF. Use placeholder tags
              like <code>{"{assetCode}"}</code>, <code>{"{#readings}"}</code>,
              and <code>{"{image}"}</code> — see the placeholder contract.
            </p>
          </div>

          {error ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {notice}
            </div>
          ) : null}

          {isAdmin ? (
            <section className={`mt-6 ${card}`}>
              <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <Upload size={17} className="text-[var(--brand)]" />
                Upload a template
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Template file (.docx)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={onPickFile}
                    className="mt-1.5 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--on-brand)] hover:file:bg-[var(--brand-strong)]"
                  />
                  {file ? (
                    <p className="mt-1.5 text-xs text-[var(--muted)]">
                      {file.name} · {(file.size / 1024).toFixed(0)} KB
                    </p>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Operational scope
                  </label>
                  <select
                    value={scope}
                    onChange={(event) =>
                      setScope(event.target.value as OperationalScope)
                    }
                    className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
                  >
                    {OPERATIONAL_SCOPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Display name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="defaults to the file name"
                  className="mt-1.5 h-10 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={!file || isUploading}
                  className={primaryBtn}
                >
                  {isUploading ? (
                    <RefreshCw size={15} className="animate-spin" />
                  ) : (
                    <Upload size={15} />
                  )}
                  Upload template
                </button>
                {file ? (
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="inline-flex h-10 items-center gap-1 rounded-md px-2 text-sm text-slate-500 hover:text-slate-700"
                  >
                    <X size={15} /> Clear
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              Uploading report templates requires an administrator. You can review
              the active templates below.
            </div>
          )}

          <section className={`mt-6 ${card}`}>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <FileText size={17} className="text-[var(--brand)]" />
              Active templates by scope
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OPERATIONAL_SCOPES.map((value) => {
                const active = activeByScope.get(value);
                return (
                  <div
                    key={value}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      {value}
                    </p>
                    {active ? (
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-800">
                        <CheckCircle2 size={14} className="text-emerald-600" />
                        <span className="truncate font-semibold">
                          {active.name}
                        </span>
                        <span className="text-[var(--muted)]">
                          v{active.version}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        No template yet.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {templates.length > 0 ? (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  All versions ({templates.length})
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {templates.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-slate-700">
                        <span className="font-semibold">
                          {t.operationalScope}
                        </span>{" "}
                        · {t.name} · {t.fileName}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs">
                        <span className="text-[var(--muted)]">v{t.version}</span>
                        {t.isActive ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                            active
                          </span>
                        ) : (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500">
                            superseded
                          </span>
                        )}
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(t)}
                            disabled={deletingId === t.id}
                            title="Delete template"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 font-semibold text-slate-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingId === t.id ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                            Delete
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export function ReportTemplatesClient() {
  return (
    <AuthGuard>
      <ReportTemplatesContent />
    </AuthGuard>
  );
}
