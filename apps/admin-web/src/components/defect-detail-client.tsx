"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { API_ORIGIN, ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  addDefectComment,
  fetchDefectDetail,
  updateDefectStatus,
} from "@/lib/defects";
import type { AuthSession } from "@/types/auth";
import {
  DEFECT_WORKFLOW_STATUSES,
  type DefectDetail,
  type DefectEvidenceImage,
  type DefectSeverity,
  type DefectStatus,
  type DefectTimelineEntry,
  type DefectWorkflowStatus,
} from "@/types/defects";

const statusOptions: Array<{ label: string; value: DefectWorkflowStatus }> = [
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Monitoring", value: "MONITORING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const fieldClassName =
  "rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]";
const controlClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

function formatStatus(status: DefectStatus | null) {
  if (!status || status === "UNKNOWN") {
    return "Unknown";
  }

  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSeverity(severity: DefectSeverity | null) {
  if (!severity) {
    return "Unspecified";
  }

  return severity.charAt(0) + severity.slice(1).toLowerCase();
}

function formatDateTime(date: string | null | undefined) {
  if (!date) {
    return "Not recorded";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatNullable(value: string | null | undefined) {
  return value?.trim() || "Not recorded";
}

function isWorkflowStatus(status: DefectStatus): status is DefectWorkflowStatus {
  return DEFECT_WORKFLOW_STATUSES.includes(status as DefectWorkflowStatus);
}

function SeverityBadge({ severity }: { severity: DefectSeverity | null }) {
  const className =
    severity === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-700"
      : severity === "HIGH"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : severity === "MEDIUM"
          ? "border-yellow-200 bg-yellow-50 text-yellow-800"
          : severity === "LOW"
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${className}`}>
      {severity ?? "UNSPECIFIED"}
    </span>
  );
}

function StatusBadge({ status }: { status: DefectStatus }) {
  const className =
    status === "OPEN"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "IN_PROGRESS"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : status === "MONITORING"
          ? "border-violet-200 bg-violet-50 text-violet-700"
          : status === "RESOLVED"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : status === "CLOSED"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatStatus(status)}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className={fieldClassName}>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function getImageSourceUrl(image: DefectEvidenceImage) {
  const source = image.url || image.path;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  if (source.startsWith("/")) {
    return `${API_ORIGIN}${source}`;
  }

  if (source.startsWith("uploads/")) {
    return `${API_ORIGIN}/${source}`;
  }

  if (source.startsWith("inspections/")) {
    return `${API_ORIGIN}/uploads/${source}`;
  }

  return source;
}

function TimelineIcon({ entry }: { entry: DefectTimelineEntry }) {
  if (entry.type === "STATUS_CHANGED") {
    return <CheckCircle2 size={16} />;
  }

  if (entry.type === "COMMENT") {
    return <MessageSquare size={16} />;
  }

  return <Clock3 size={16} />;
}

function timelineTitle(entry: DefectTimelineEntry) {
  if (entry.type === "STATUS_CHANGED") {
    return "Status changed";
  }

  if (entry.type === "COMMENT") {
    return "Comment";
  }

  return "Created";
}

function timelineDetail(entry: DefectTimelineEntry) {
  if (entry.type === "STATUS_CHANGED") {
    return `${formatStatus(entry.fromStatus)} to ${formatStatus(entry.toStatus)}`;
  }

  if (entry.type === "CREATED" && entry.toStatus) {
    return `Initial status ${formatStatus(entry.toStatus)}`;
  }

  return null;
}

function DefectDetailContent({ defectId }: { defectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [defect, setDefect] = useState<DefectDetail | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<DefectWorkflowStatus>("OPEN");
  const [actionRemark, setActionRemark] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const applyDefect = useCallback((nextDefect: DefectDetail) => {
    setDefect(nextDefect);
    setActionRemark(nextDefect.actionRemark ?? "");
    setSelectedStatus(isWorkflowStatus(nextDefect.status) ? nextDefect.status : "OPEN");
  }, []);

  const loadDefect = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      }

      setError("");

      try {
        const nextDefect = await fetchDefectDetail(token, defectId);
        applyDefect(nextDefect);
      } catch (defectError) {
        if (defectError instanceof ApiError && defectError.status === 401) {
          handleLogout();
          return;
        }

        setError(defectError instanceof Error ? defectError.message : "Unable to load defect.");
        setDefect(null);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [applyDefect, defectId, handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadDefect(storedSession.token);
    }
  }, [loadDefect]);

  const isReadOnly = session?.user?.role !== "ADMIN";
  const canSaveStatus = Boolean(session?.token && defect && !isReadOnly && !isSavingStatus);
  const canAddComment = Boolean(
    session?.token &&
      defect &&
      !isReadOnly &&
      !isAddingComment &&
      comment.trim().length > 0,
  );

  const evidenceImages = useMemo(
    () =>
      defect?.images
        .map((image) => ({
          image,
          sourceUrl: getImageSourceUrl(image),
        }))
        .filter((entry) => Boolean(entry.sourceUrl)) ?? [],
    [defect],
  );

  async function handleStatusUpdate() {
    if (!session?.token || !defect || isReadOnly) {
      return;
    }

    setIsSavingStatus(true);
    setError("");
    setNotice("");

    try {
      const nextDefect = await updateDefectStatus(
        session.token,
        defect.id,
        selectedStatus,
        actionRemark.trim() || null,
      );
      applyDefect(nextDefect);
      setNotice("Status updated.");
    } catch (statusError) {
      if (statusError instanceof ApiError && statusError.status === 401) {
        handleLogout();
        return;
      }

      setError(statusError instanceof Error ? statusError.message : "Unable to update status.");
    } finally {
      setIsSavingStatus(false);
    }
  }

  async function handleAddComment() {
    if (!session?.token || !defect || isReadOnly || !comment.trim()) {
      return;
    }

    setIsAddingComment(true);
    setError("");
    setNotice("");

    try {
      const nextDefect = await addDefectComment(session.token, defect.id, comment.trim());
      applyDefect(nextDefect);
      setComment("");
      setNotice("Comment added.");
    } catch (commentError) {
      if (commentError instanceof ApiError && commentError.status === 401) {
        handleLogout();
        return;
      }

      setError(commentError instanceof Error ? commentError.message : "Unable to add comment.");
    } finally {
      setIsAddingComment(false);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/defects")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                Defects
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Defect Workflow
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {defect?.assetCode ?? "Defect"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                {defect ? <SeverityBadge severity={defect.severity} /> : null}
                {defect ? <StatusBadge status={defect.status} /> : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadDefect(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !defect ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-64 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error && !defect ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : defect ? (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}
                {notice ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                    {notice}
                  </div>
                ) : null}

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-[var(--foreground)]">
                        {defect.defectType}
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                        {formatNullable(defect.checklistRemark ?? defect.remark)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SeverityBadge severity={defect.severity} />
                      <StatusBadge status={defect.status} />
                    </div>
                  </div>

                  <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label="Asset Code" value={defect.assetCode} />
                    <DetailField label="Asset Type" value={formatNullable(defect.assetType)} />
                    <DetailField
                      label="Substation"
                      value={formatNullable(defect.substation?.name ?? defect.substation?.code)}
                    />
                    <DetailField label="Location" value={formatNullable(defect.location)} />
                    <DetailField label="Inspection Date" value={formatDateTime(defect.submittedAt)} />
                    <DetailField label="Result Value" value={formatNullable(defect.result ?? "FAIL")} />
                    <DetailField
                      label="Technician"
                      value={formatNullable(defect.submittedBy?.name ?? defect.submittedBy?.email)}
                    />
                    <DetailField label="Latest Update" value={formatDateTime(defect.updatedAt)} />
                  </dl>
                </section>

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-6">
                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                          <CalendarDays size={17} className="text-[var(--brand)]" />
                          Inspection
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                          Cycle {defect.cycleNumber ?? "N/A"}
                        </span>
                      </div>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2">
                        <DetailField
                          label="Inspection ID"
                          value={formatNullable(defect.inspectionId)}
                        />
                        <DetailField
                          label="Template"
                          value={formatNullable(defect.inspection?.template?.name)}
                        />
                        <DetailField
                          label="Visit Team"
                          value={formatNullable(defect.inspection?.siteVisit?.team?.name)}
                        />
                        <DetailField
                          label="Submitted"
                          value={formatDateTime(defect.inspection?.submittedAt ?? defect.submittedAt)}
                        />
                      </dl>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                          <Camera size={17} className="text-[var(--brand)]" />
                          Evidence
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {evidenceImages.length} photos
                        </span>
                      </div>

                      {evidenceImages.length > 0 ? (
                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                          {evidenceImages.map(({ image, sourceUrl }) => (
                            <a
                              key={image.id}
                              href={sourceUrl ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <img
                                src={sourceUrl ?? undefined}
                                alt={image.filename ?? "Defect evidence"}
                                className="aspect-video w-full object-cover transition group-hover:scale-[1.02]"
                              />
                              <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
                                {formatDateTime(image.timestamp ?? image.createdAt)}
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
                          No evidence photos linked.
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                        <Clock3 size={17} className="text-[var(--brand)]" />
                        Timeline
                      </div>
                      <div className="mt-5 space-y-4">
                        {defect.timeline.length > 0 ? (
                          defect.timeline.map((entry) => (
                            <div key={entry.id} className="flex gap-3">
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[var(--brand)]">
                                <TimelineIcon entry={entry} />
                              </div>
                              <div className="min-w-0 flex-1 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="text-sm font-semibold text-slate-900">
                                    {timelineTitle(entry)}
                                  </p>
                                  <time className="text-xs font-medium text-[var(--muted)]">
                                    {formatDateTime(entry.createdAt)}
                                  </time>
                                </div>
                                {timelineDetail(entry) ? (
                                  <p className="mt-1 text-sm text-slate-600">
                                    {timelineDetail(entry)}
                                  </p>
                                ) : null}
                                {entry.comment ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-700">
                                    {entry.comment}
                                  </p>
                                ) : null}
                                {entry.createdBy ? (
                                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
                                    <UserRound size={13} />
                                    {formatNullable(entry.createdBy.name ?? entry.createdBy.email)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
                            No timeline entries yet.
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

                  <aside className="space-y-6">
                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        Status Update
                      </h2>
                      <div className="mt-4 space-y-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Status
                          </span>
                          <select
                            value={selectedStatus}
                            onChange={(event) =>
                              setSelectedStatus(event.target.value as DefectWorkflowStatus)
                            }
                            disabled={isReadOnly || isSavingStatus}
                            className={`mt-2 ${controlClassName}`}
                          >
                            {statusOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Action Remark
                          </span>
                          <textarea
                            value={actionRemark}
                            onChange={(event) => setActionRemark(event.target.value)}
                            disabled={isReadOnly || isSavingStatus}
                            rows={4}
                            className={`mt-2 resize-none ${controlClassName}`}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={handleStatusUpdate}
                          disabled={!canSaveStatus}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isSavingStatus ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}
                          Update Status
                        </button>
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        Comment
                      </h2>
                      <div className="mt-4 space-y-4">
                        <textarea
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          disabled={isReadOnly || isAddingComment}
                          rows={5}
                          className={`resize-none ${controlClassName}`}
                        />
                        <button
                          type="button"
                          onClick={handleAddComment}
                          disabled={!canAddComment}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {isAddingComment ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <MessageSquare size={16} />
                          )}
                          Add Comment
                        </button>
                      </div>
                    </section>
                  </aside>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                Defect not found.
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function DefectDetailClient({ defectId }: { defectId: string }) {
  return (
    <AuthGuard>
      <DefectDetailContent defectId={defectId} />
    </AuthGuard>
  );
}
