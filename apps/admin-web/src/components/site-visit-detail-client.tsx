"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MapPin,
  Radio,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  archiveSurvey,
  fetchCycleDelta,
  fetchSiteVisitDetail,
  generateSurveyReport,
  markRondaanSelesai,
  openNextCycle,
  reassignSiteVisit,
  requestSurveyAmendment,
} from "@/lib/site-visits";
import { fetchTeams, type TeamOption } from "@/lib/teams";
import type { AuthSession } from "@/types/auth";
import type {
  CycleDelta,
  CycleDeltaPole,
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitDetail,
  SiteVisitStatus,
  SiteVisitValidationStatus,
  SurveyDueStatus,
  SurveyLifecycleStatus,
} from "@/types/site-visits";

type LifecycleAction =
  | "rondaan-selesai"
  | "request-amendment"
  | "generate-report"
  | "archive"
  | "open-next-cycle";

const LIFECYCLE_MAIN_STEPS: {
  key: SurveyLifecycleStatus;
  label: string;
  caption: string;
}[] = [
  { key: "DALAM_RONDAAN", label: "Dalam Rondaan", caption: "Inspecting" },
  { key: "RONDAAN_SELESAI", label: "Rondaan Selesai", caption: "Inspector done" },
  { key: "LAPORAN_SELESAI", label: "Laporan Selesai", caption: "Report generated" },
  { key: "ARKIB", label: "Arkib", caption: "Archived" },
];

const LIFECYCLE_STEP_INDEX: Record<SurveyLifecycleStatus, number> = {
  DALAM_RONDAAN: 0,
  RONDAAN_SELESAI: 1,
  PERLU_PINDAAN: 1,
  LAPORAN_SELESAI: 2,
  ARKIB: 3,
};

function lifecycleLabel(status: SurveyLifecycleStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const AUTO_REFRESH_MS = 60000;
const fieldClassName =
  "rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]";

function formatEnum(value: string | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function formatMonthsAgo(months: number | null | undefined) {
  if (months === null || months === undefined) {
    return "";
  }
  if (months < 1) {
    return "less than a month ago";
  }
  const rounded = Math.round(months);
  return `${rounded} month${rounded === 1 ? "" : "s"} ago`;
}

function DueBadge({ status }: { status: SurveyDueStatus }) {
  if (status === "UNKNOWN") {
    return null;
  }
  const { className, label } =
    status === "OVERDUE"
      ? { className: "border-red-200 bg-red-50 text-red-700", label: "Overdue" }
      : status === "DUE_SOON"
        ? { className: "border-amber-200 bg-amber-50 text-amber-800", label: "Due soon" }
        : { className: "border-emerald-200 bg-emerald-50 text-emerald-700", label: "On time" };
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${className}`}
    >
      {label}
    </span>
  );
}

function displayPencawang(visit: SiteVisitDetail) {
  return (
    [visit.pencawangCode, visit.pencawangName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" - ") || "Site Visit"
  );
}

function displayTeam(visit: SiteVisitDetail) {
  return visit.team?.name?.trim() || visit.team?.code?.trim() || "Unassigned";
}

function displayMainhead(visit: SiteVisitDetail) {
  return (
    visit.mainheadRecord?.name?.trim() ||
    visit.mainheadRecord?.code?.trim() ||
    visit.mainhead ||
    "Not recorded"
  );
}

function HealthBadge({ status }: { status: OperationalHealthStatus }) {
  const className =
    status === "CRITICAL"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold uppercase ${className}`}>
      {status}
    </span>
  );
}

function StatusBadge({ status }: { status: SiteVisitStatus }) {
  const className =
    status === "COMPLETED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "CANCELLED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function ValidationBadge({ status }: { status: SiteVisitValidationStatus }) {
  const className =
    status === "FAILED"
      ? "border-red-200 bg-red-50 text-red-700"
      : status === "WARNING"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : status === "VALIDATED"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnum(status)}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className={fieldClassName}>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function MainheadDetailField({ visit }: { visit: SiteVisitDetail }) {
  const isLegacy = !visit.mainheadRecord && Boolean(visit.mainhead?.trim());

  return (
    <div className={fieldClassName}>
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">MAINHEAD</dt>
      <dd className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
        <span>{displayMainhead(visit)}</span>
        {isLegacy ? (
          <span
            className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800"
            title="Free-text MAINHEAD captured before Governance G1. Not linked to a MAINHEAD record."
          >
            Legacy MAINHEAD
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClassName =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClassName}`}>
          <Icon size={17} />
        </div>
      </div>
    </div>
  );
}

function ProgressPanel({ visit }: { visit: SiteVisitDetail }) {
  const boundedPercentage = Math.min(Math.max(visit.completionPercentage, 0), 100);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Inspection Progress</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {visit.inspectedAssets} of {visit.totalAssets} linked assets submitted
          </p>
        </div>
        <div className="text-3xl font-bold text-slate-950">{boundedPercentage}%</div>
      </div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${boundedPercentage}%` }}
        />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <MetricTile label="Pending" value={visit.pendingAssets} icon={Clock3} />
        <MetricTile
          label="Defects"
          value={visit.defectsFound}
          icon={AlertTriangle}
          tone={visit.defectsFound > 0 ? "warning" : "neutral"}
        />
        <MetricTile label="Images" value={visit.images.length} icon={Radio} />
      </div>
    </section>
  );
}

function GisPanel({ visit }: { visit: SiteVisitDetail }) {
  const hasCoordinates =
    typeof visit.checkInLatitude === "number" && typeof visit.checkInLongitude === "number";

  return (
    <aside className="space-y-6">
      <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <MapPin size={17} className="text-[var(--brand)]" />
            GIS Operations
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {hasCoordinates ? "Coordinate" : "Standby"}
          </span>
        </div>

        <div className="mt-5 h-56 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                "linear-gradient(rgba(20,184,166,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(20,184,166,0.2) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          >
            <div className="flex h-full items-center justify-center px-5 text-center">
              <div>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-teal-300/40 bg-teal-300/10 text-teal-100">
                  <MapPin size={20} />
                </div>
                <p className="mt-3 text-sm font-semibold text-teal-50">
                  {hasCoordinates
                    ? `${visit.checkInLatitude?.toFixed(5)}, ${visit.checkInLongitude?.toFixed(5)}`
                    : "No check-in coordinate"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Accuracy</dt>
            <dd className="font-semibold text-slate-900">
              {visit.checkInAccuracyMeters === null
                ? "Not recorded"
                : `${visit.checkInAccuracyMeters} m`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Captured</dt>
            <dd className="font-semibold text-slate-900">
              {formatDateTime(visit.checkInCapturedAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Feeder</dt>
            <dd className="font-semibold text-slate-900">{formatNullable(visit.feederId)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Route</dt>
            <dd className="font-semibold text-slate-900">{formatNullable(visit.feederRouteId)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 text-sm">
            <dt className="font-medium text-[var(--muted)]">Geometry</dt>
            <dd className="font-semibold text-slate-900">
              {formatNullable(visit.gisGeometryVersion)}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

interface SurveyLifecyclePanelProps {
  visit: SiteVisitDetail;
  canInspect: boolean;
  canGovern: boolean;
  canReport: boolean;
  pendingAction: LifecycleAction | null;
  error: string;
  onRondaanSelesai: () => void;
  onRequestAmendment: (remark: string) => void;
  onGenerateReport: () => void;
  onArchive: () => void;
  onOpenNextCycle: () => void;
}

function SurveyLifecyclePanel({
  visit,
  canInspect,
  canGovern,
  canReport,
  pendingAction,
  error,
  onRondaanSelesai,
  onRequestAmendment,
  onGenerateReport,
  onArchive,
  onOpenNextCycle,
}: SurveyLifecyclePanelProps) {
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentRemark, setAmendmentRemark] = useState("");

  const status: SurveyLifecycleStatus = visit.lifecycle?.status ?? "DALAM_RONDAAN";
  const currentIndex = LIFECYCLE_STEP_INDEX[status];
  const isPerluPindaan = status === "PERLU_PINDAAN";
  const isCancelled = visit.status === "CANCELLED";
  const isBusy = pendingAction !== null;

  const primaryBtn =
    "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
  const amberBtn =
    "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50";
  const subtleBtn =
    "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
        <Activity size={17} className="text-[var(--brand)]" />
        Survey Lifecycle
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        The annual cycle survey for this Pencawang — inspect, review, report, archive.
      </p>

      <ol className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        {LIFECYCLE_MAIN_STEPS.map((step, index) => {
          const completed = index < currentIndex;
          const active = index === currentIndex;
          const attention = active && isPerluPindaan;
          const circle = completed
            ? "border-emerald-500 bg-emerald-500 text-white"
            : attention
              ? "border-amber-400 bg-amber-100 text-amber-700"
              : active
                ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                : "border-slate-300 bg-white text-slate-400";
          return (
            <li key={step.key} className="flex flex-1 items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${circle}`}
              >
                {completed ? <CheckCircle2 size={16} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${active ? "text-slate-900" : "text-slate-500"}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-[var(--muted)]">{step.caption}</p>
              </div>
              {index < LIFECYCLE_MAIN_STEPS.length - 1 ? (
                <span className="hidden h-px flex-1 bg-slate-200 sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {isPerluPindaan ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
            <AlertTriangle size={15} /> Sent back for amendments (Perlu Pindaan)
          </p>
          {visit.lifecycle?.amendmentRemark ? (
            <p className="mt-1 text-sm text-amber-900">
              &ldquo;{visit.lifecycle.amendmentRemark}&rdquo;
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {isCancelled ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          This visit is cancelled — the survey lifecycle is closed.
        </p>
      ) : status === "ARKIB" ? (
        <div className="mt-4 flex flex-col gap-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 size={15} /> Cycle archived
            {visit.lifecycle?.archivedAt
              ? ` · ${formatDateTime(visit.lifecycle.archivedAt)}`
              : ""}
            .
          </p>
          {canInspect ? (
            <button
              type="button"
              onClick={onOpenNextCycle}
              disabled={isBusy}
              className={subtleBtn}
            >
              {pendingAction === "open-next-cycle" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CalendarDays size={15} />
              )}
              Open next cycle (re-survey)
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {(status === "DALAM_RONDAAN" || status === "PERLU_PINDAAN") && canInspect ? (
            <button
              type="button"
              onClick={onRondaanSelesai}
              disabled={isBusy}
              className={primaryBtn}
            >
              {pendingAction === "rondaan-selesai" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {status === "PERLU_PINDAAN"
                ? "Re-submit (Rondaan Selesai)"
                : "Mark Rondaan Selesai"}
            </button>
          ) : null}

          {status === "RONDAAN_SELESAI" && canReport ? (
            <button
              type="button"
              onClick={onGenerateReport}
              disabled={isBusy}
              className={primaryBtn}
            >
              {pendingAction === "generate-report" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              Generate report (Laporan Selesai)
            </button>
          ) : null}

          {status === "RONDAAN_SELESAI" && canGovern ? (
            <button
              type="button"
              onClick={() => setAmendmentOpen((open) => !open)}
              disabled={isBusy}
              className={amberBtn}
            >
              <AlertTriangle size={15} /> Request amendment
            </button>
          ) : null}

          {status === "LAPORAN_SELESAI" && canGovern ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={isBusy}
              className={primaryBtn}
            >
              {pendingAction === "archive" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Archive (Arkib)
            </button>
          ) : null}
        </div>
      )}

      {amendmentOpen && status === "RONDAAN_SELESAI" && canGovern ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="block text-xs font-semibold uppercase text-amber-800">
            Amendment remark (required)
          </label>
          <textarea
            value={amendmentRemark}
            onChange={(event) => setAmendmentRemark(event.target.value)}
            rows={3}
            placeholder="What must the inspector fix? (e.g. duplicate RONDAAN on pole A 3, missing photo)"
            className="mt-1.5 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={isBusy || amendmentRemark.trim().length === 0}
              onClick={() => {
                onRequestAmendment(amendmentRemark.trim());
                setAmendmentRemark("");
                setAmendmentOpen(false);
              }}
              className={amberBtn}
            >
              {pendingAction === "request-amendment" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <AlertTriangle size={15} />
              )}
              Send back for amendments
            </button>
            <button
              type="button"
              onClick={() => setAmendmentOpen(false)}
              className={subtleBtn}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {visit.lifecycleEvents.length > 0 ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold uppercase text-slate-500">History</p>
          <ul className="mt-2 space-y-2">
            {visit.lifecycleEvents.map((event) => (
              <li key={event.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="text-slate-800">
                    {event.fromStatus ? `${lifecycleLabel(event.fromStatus)} → ` : ""}
                    <span className="font-semibold">{lifecycleLabel(event.toStatus)}</span>
                  </p>
                  {event.remark ? (
                    <p className="text-[var(--muted)]">&ldquo;{event.remark}&rdquo;</p>
                  ) : null}
                  <p className="text-xs text-[var(--muted)]">
                    {formatDateTime(event.createdAt)}
                    {event.createdBy?.name ? ` · ${event.createdBy.name}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CycleDeltaStat({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: "added" | "removed" | "carried";
}) {
  const className =
    tone === "added"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "removed"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`rounded-lg border p-3 text-center ${className}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs font-semibold uppercase">{label}</p>
    </div>
  );
}

function CycleDeltaPoleList({
  poles,
  emptyText,
}: {
  poles: CycleDeltaPole[];
  emptyText: string;
}) {
  if (poles.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{emptyText}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {poles.map((pole) => (
        <li
          key={pole.id}
          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700"
        >
          {pole.assetCode}
          {pole.noTiangLama ? ` · ${pole.noTiangLama}` : ""}
        </li>
      ))}
    </ul>
  );
}

function CycleDeltaPanel({ delta }: { delta: CycleDelta }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
        <CalendarDays size={17} className="text-[var(--brand)]" />
        Inspection Cycle
      </div>

      {delta.recency.lastInspectedAt ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-[var(--muted)]">Last inspected:</span>
          <span className="font-semibold text-slate-900">
            {formatDateTime(delta.recency.lastInspectedAt)}
          </span>
          {delta.recency.monthsSince !== null ? (
            <span className="text-[var(--muted)]">
              · {formatMonthsAgo(delta.recency.monthsSince)}
            </span>
          ) : null}
          <DueBadge status={delta.recency.status} />
        </div>
      ) : null}

      {delta.isBaseline ? (
        <p className="mt-2 text-sm text-[var(--muted)]">
          Foundation survey — {delta.summary.observed} pole
          {delta.summary.observed === 1 ? "" : "s"} on record. The next
          re-inspection will compare against this baseline.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">
            This survey versus the previous inspection:
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <CycleDeltaStat count={delta.summary.added} label="New" tone="added" />
            <CycleDeltaStat count={delta.summary.removed} label="Removed" tone="removed" />
            <CycleDeltaStat count={delta.summary.carried} label="Carried" tone="carried" />
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase text-emerald-700">
                New poles
              </p>
              <CycleDeltaPoleList poles={delta.newPoles} emptyText="None added this cycle." />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase text-red-700">
                Removed / not re-surveyed
              </p>
              <CycleDeltaPoleList
                poles={delta.removedPoles}
                emptyText="None removed this cycle."
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ReassignTeamPanel({
  visit,
  token,
  canReassign,
  onReassigned,
}: {
  visit: SiteVisitDetail;
  token: string | null;
  canReassign: boolean;
  onReassigned: (next: SiteVisitDetail) => void;
}) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [toTeamId, setToTeamId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || teamsLoaded || !token) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const list = await fetchTeams(token);
        if (!cancelled) {
          setTeams(list);
          setTeamsLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load the team list.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, teamsLoaded, token]);

  const status = visit.lifecycle?.status ?? null;
  const isReassignable =
    visit.status !== "CANCELLED" &&
    visit.status !== "COMPLETED" &&
    (status === null || status === "DALAM_RONDAAN" || status === "PERLU_PINDAAN");

  if (!canReassign || !isReassignable) {
    return null;
  }

  const currentTeamId = visit.team?.id ?? null;
  const currentTeamLabel =
    visit.team?.name?.trim() || visit.team?.code?.trim() || "Unassigned";
  // Only same-company teams are valid targets — derive the company from the
  // current team (the /teams list includes it) and filter to it.
  const currentTeam = teams.find((team) => team.id === currentTeamId);
  const options = teams.filter(
    (team) =>
      team.id !== currentTeamId &&
      (!currentTeam ||
        (team.organizationId ?? null) === (currentTeam.organizationId ?? null)),
  );
  const canSubmit =
    Boolean(token) && Boolean(toTeamId) && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!token || !toTeamId || reason.trim().length === 0) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const next = await reassignSiteVisit(token, visit.id, toTeamId, reason.trim());
      onReassigned(next);
      setOpen(false);
      setToTeamId("");
      setReason("");
    } catch (reassignError) {
      setError(
        reassignError instanceof Error
          ? reassignError.message
          : "Unable to reassign this site visit.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <Users size={17} className="text-[var(--brand)]" />
            Team Assignment
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Owned by{" "}
            <span className="font-semibold text-slate-700">{currentTeamLabel}</span>. Hand the
            in-progress survey to another team — every inspection, photo and defect transfers.
          </p>
        </div>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
          >
            <ArrowLeftRight size={15} /> Reassign team
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <label className="block text-xs font-semibold uppercase text-slate-600">
            Reassign to team
          </label>
          <select
            value={toTeamId}
            onChange={(event) => setToTeamId(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
          >
            <option value="">{teamsLoaded ? "Select a team…" : "Loading teams…"}</option>
            {options.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name?.trim() || team.code?.trim() || team.id}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-semibold uppercase text-slate-600">
            Reason (required)
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Why is this being reassigned? (e.g. Team Alpha pulled to an outage — Beta to finish the walk)"
            className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20"
          />

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void submit()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <ArrowLeftRight size={15} />
              )}
              Reassign
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SiteVisitDetailContent({ siteVisitId }: { siteVisitId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [visit, setVisit] = useState<SiteVisitDetail | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(null);
  const [lifecycleError, setLifecycleError] = useState("");
  const [cycleDelta, setCycleDelta] = useState<CycleDelta | null>(null);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadVisit = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");

      try {
        const nextVisit = await fetchSiteVisitDetail(token, siteVisitId);
        setVisit(nextVisit);
      } catch (visitError) {
        if (visitError instanceof ApiError && visitError.status === 401) {
          handleLogout();
          return;
        }

        setError(visitError instanceof Error ? visitError.message : "Unable to load site visit.");
        if (showLoading) {
          setVisit(null);
        }
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [handleLogout, siteVisitId],
  );

  const loadDelta = useCallback(
    async (token: string) => {
      try {
        setCycleDelta(await fetchCycleDelta(token, siteVisitId));
      } catch {
        // The delta is a supplementary view — never block the detail on it.
        setCycleDelta(null);
      }
    },
    [siteVisitId],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadVisit(storedSession.token);
      void loadDelta(storedSession.token);
    }
  }, [loadVisit, loadDelta]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadVisit(session.token, false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadVisit, session?.token]);

  const isReadOnly = session?.user?.role !== "ADMIN";
  const isAdmin = !isReadOnly;
  // Inspector owns RONDAAN SELESAI; in the admin console that maps to full-access
  // (ADMIN). DC governance (amendments / archive) and report generation reuse the
  // server-provided authority flags, so the UI shows exactly what the API allows.
  const canInspect = isAdmin;
  const canGovern = isAdmin || (session?.user?.canGovernQa ?? false);
  const canReport = isAdmin || (session?.user?.canReport ?? false);
  // Server-computed flag (ADMIN / MANAGER / SUPERVISOR) — the admin console can't read
  // those roles client-side (MANAGER/SUPERVISOR collapse to VIEWER on login), so we mirror
  // the API's authority. The endpoint still enforces the per-team / cross-org rules.
  const canReassign = isAdmin || (session?.user?.canReassign ?? false);

  const runLifecycle = useCallback(
    async (action: LifecycleAction, run: () => Promise<SiteVisitDetail>) => {
      if (!session?.token) {
        return;
      }
      setPendingAction(action);
      setLifecycleError("");
      try {
        setVisit(await run());
      } catch (actionError) {
        if (actionError instanceof ApiError && actionError.status === 401) {
          handleLogout();
          return;
        }
        setLifecycleError(
          actionError instanceof Error
            ? actionError.message
            : "Unable to update the survey lifecycle.",
        );
      } finally {
        setPendingAction(null);
      }
    },
    [session?.token, handleLogout],
  );

  const handleRondaanSelesai = useCallback(() => {
    const token = session?.token;
    if (!token) return;
    void runLifecycle("rondaan-selesai", () => markRondaanSelesai(token, siteVisitId));
  }, [runLifecycle, session?.token, siteVisitId]);

  const handleRequestAmendment = useCallback(
    (remark: string) => {
      const token = session?.token;
      if (!token) return;
      void runLifecycle("request-amendment", () =>
        requestSurveyAmendment(token, siteVisitId, remark),
      );
    },
    [runLifecycle, session?.token, siteVisitId],
  );

  const handleGenerateReport = useCallback(() => {
    const token = session?.token;
    if (!token) return;
    void runLifecycle("generate-report", () => generateSurveyReport(token, siteVisitId));
  }, [runLifecycle, session?.token, siteVisitId]);

  const handleArchive = useCallback(() => {
    const token = session?.token;
    if (!token) return;
    void runLifecycle("archive", () => archiveSurvey(token, siteVisitId));
  }, [runLifecycle, session?.token, siteVisitId]);

  const handleOpenNextCycle = useCallback(async () => {
    const token = session?.token;
    if (!token) return;
    setPendingAction("open-next-cycle");
    setLifecycleError("");
    try {
      const next = await openNextCycle(token, siteVisitId);
      // Land on the fresh DALAM RONDAAN survey for the new cycle.
      router.push(`/site-visits/${next.id}`);
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) {
        handleLogout();
        return;
      }
      setLifecycleError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to open the next cycle.",
      );
      setPendingAction(null);
    }
  }, [session?.token, siteVisitId, router, handleLogout]);

  const submittedInspections = useMemo(
    () => visit?.inspections.filter((inspection) => inspection.completionStatus === "SUBMITTED") ?? [],
    [visit],
  );
  const operationalAssetRows = useMemo(() => {
    if (!visit) {
      return [];
    }

    const assetsById = new Map<string, SiteVisitAssetLink>();

    visit.linkedAssets.forEach((link) => {
      assetsById.set(link.assetId, link);
    });

    visit.inspections.forEach((inspection) => {
      if (!inspection.assetId || assetsById.has(inspection.assetId)) {
        return;
      }

      assetsById.set(inspection.assetId, {
        id: `inspection-${inspection.assetId}`,
        assetId: inspection.assetId,
        addedAt: inspection.submittedAt ?? inspection.createdAt,
        source: "INSPECTION",
        notes: null,
        asset: {
          id: inspection.assetId,
          assetCode: inspection.assetCode,
          name: inspection.assetName,
        },
      });
    });

    return Array.from(assetsById.values()).sort((left, right) =>
      left.asset.assetCode.localeCompare(right.asset.assetCode, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [visit]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/site-visits")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                Site Visits
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Operations Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {visit ? displayPencawang(visit) : "Site Visit"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  Auto-refresh 60s
                </label>
                {visit ? <HealthBadge status={visit.operationalHealthStatus} /> : null}
                {visit ? <StatusBadge status={visit.status} /> : null}
                {visit ? <ValidationBadge status={visit.validationStatus} /> : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadVisit(session.token, false) : undefined)}
              disabled={(isLoading && !visit) || isRefreshing || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !visit ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-72 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error && !visit ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : visit ? (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Completion"
                    value={`${visit.completionPercentage}%`}
                    icon={CheckCircle2}
                    tone="success"
                  />
                  <MetricTile label="Linked Assets" value={visit.totalAssets} icon={Activity} />
                  <MetricTile
                    label="Defects Found"
                    value={visit.defectsFound}
                    icon={AlertTriangle}
                    tone={visit.defectsFound > 0 ? "warning" : "neutral"}
                  />
                  <MetricTile
                    label="Last Activity"
                    value={formatDateTime(visit.lastActivityAt)}
                    icon={Clock3}
                  />
                </div>

                <SurveyLifecyclePanel
                  visit={visit}
                  canInspect={canInspect}
                  canGovern={canGovern}
                  canReport={canReport}
                  pendingAction={pendingAction}
                  error={lifecycleError}
                  onRondaanSelesai={handleRondaanSelesai}
                  onRequestAmendment={handleRequestAmendment}
                  onGenerateReport={handleGenerateReport}
                  onArchive={handleArchive}
                  onOpenNextCycle={handleOpenNextCycle}
                />

                <ReassignTeamPanel
                  visit={visit}
                  token={session?.token ?? null}
                  canReassign={canReassign}
                  onReassigned={setVisit}
                />

                {cycleDelta ? <CycleDeltaPanel delta={cycleDelta} /> : null}

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6">
                    <ProgressPanel visit={visit} />

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                        <Activity size={17} className="text-[var(--brand)]" />
                        Operational Metadata
                      </div>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <MainheadDetailField visit={visit} />
                        <DetailField label="Pencawang Code" value={formatNullable(visit.pencawangCode)} />
                        <DetailField label="Pencawang Name" value={formatNullable(visit.pencawangName)} />
                        <DetailField label="Functional Location" value={formatNullable(visit.functionalLocation)} />
                        <DetailField label="Visit Type" value={formatEnum(visit.visitType)} />
                        <DetailField
                          label="Operational Domain"
                          value={
                            visit.operationalDomain === "UNSPECIFIED"
                              ? "Not recorded"
                              : formatEnum(visit.operationalDomain)
                          }
                        />
                        <DetailField
                          label="Last inspected"
                          value={
                            cycleDelta?.recency.lastInspectedAt
                              ? `${formatDateTime(cycleDelta.recency.lastInspectedAt)}${
                                  cycleDelta.recency.monthsSince !== null
                                    ? ` · ${formatMonthsAgo(cycleDelta.recency.monthsSince)}`
                                    : ""
                                }`
                              : "Not recorded"
                          }
                        />
                        <DetailField label="Team" value={displayTeam(visit)} />
                        <DetailField label="Created By" value={formatNullable(visit.createdBy?.name ?? visit.createdBy?.email)} />
                      </dl>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <Users size={17} className="text-[var(--brand)]" />
                          Team Members
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {visit.teamMembers.length} active on visit
                        </span>
                      </div>
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {visit.teamMembers.length > 0 ? (
                          visit.teamMembers.map((member) => (
                            <div key={`${member.id}-${member.siteVisitUserId ?? ""}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                              <p className="text-sm font-semibold text-slate-950">
                                {member.name || member.email || "Team member"}
                              </p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                {formatNullable(member.role)} / Joined {formatDateTime(member.joinedAt)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)] md:col-span-2">
                            No team members returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <Activity size={17} className="text-[var(--brand)]" />
                          Linked Assets
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {operationalAssetRows.length} rows
                        </span>
                      </div>
                      <div className="mt-5 overflow-x-auto">
                        {operationalAssetRows.length > 0 ? (
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                                <th className="px-4 py-3">Asset</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Source</th>
                                <th className="px-4 py-3">Added</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {operationalAssetRows.map((link) => (
                                <tr key={link.id}>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {link.asset.assetCode}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-700">
                                    {formatNullable(link.asset.assetType?.name ?? link.asset.assetType?.code)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatNullable(link.source)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatDateTime(link.addedAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No linked assets returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                          <CalendarDays size={17} className="text-[var(--brand)]" />
                          Inspections
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {submittedInspections.length}/{visit.inspections.length} submitted
                        </span>
                      </div>
                      <div className="mt-5 overflow-x-auto">
                        {visit.inspections.length > 0 ? (
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                                <th className="px-4 py-3">Asset</th>
                                <th className="px-4 py-3">Template</th>
                                <th className="px-4 py-3">Cycle</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Defects</th>
                                <th className="px-4 py-3">Images</th>
                                <th className="px-4 py-3">Submitted</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {visit.inspections.map((inspection) => (
                                <tr key={inspection.id}>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {inspection.assetCode}
                                  </td>
                                  <td className="min-w-56 px-4 py-4 text-slate-700">
                                    {formatNullable(inspection.templateName)}
                                    {inspection.templateVersion ? (
                                      <span className="ml-2 text-xs text-[var(--muted)]">
                                        v{inspection.templateVersion}
                                      </span>
                                    ) : null}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {inspection.cycleNumber ?? "N/A"}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatEnum(inspection.completionStatus)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 font-semibold text-slate-900">
                                    {inspection.defectCount}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {inspection.imageCount}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                                    {formatDateTime(inspection.submittedAt)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No inspections returned for this visit.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                        <Clock3 size={17} className="text-[var(--brand)]" />
                        Timestamps & Notes
                      </div>
                      <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField label="Started" value={formatDateTime(visit.startedAt)} />
                        <DetailField label="Completed" value={formatDateTime(visit.completedAt)} />
                        <DetailField label="Ended" value={formatDateTime(visit.endedAt)} />
                        <DetailField label="Validated" value={formatDateTime(visit.validatedAt)} />
                        <DetailField label="Validation Summary" value={formatNullable(visit.validationSummary)} />
                        <DetailField label="Completion Notes" value={formatNullable(visit.completionNotes)} />
                        <DetailField label="Visit Notes" value={formatNullable(visit.notes)} />
                        <DetailField label="Cancel Reason" value={formatNullable(visit.cancelReason)} />
                      </dl>
                    </section>
                  </div>

                  <GisPanel visit={visit} />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                Site visit not found.
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function SiteVisitDetailClient({ siteVisitId }: { siteVisitId: string }) {
  return (
    <AuthGuard>
      <SiteVisitDetailContent siteVisitId={siteVisitId} />
    </AuthGuard>
  );
}
