"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Download,
  ImageOff,
  Map as MapIcon,
  Pencil,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  CardHead,
  Chip,
  KpiCard,
  PageHeader,
  ProgressBar,
  Tbtn,
  filterControlClass,
  filterLabelClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableMonoCellClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { storeAssetNavContext } from "@/lib/asset-nav";
import { focusPencawangOnMap } from "@/lib/map-nav";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  archiveSurvey,
  correctKelegaanReading,
  editChecklistValue,
  deleteSiteVisit,
  fetchCycleDelta,
  fetchSiteVisitContributions,
  fetchSiteVisitDetail,
  fetchSurveyDeletePreview,
  fetchSurveyReportStatus,
  generateSurveyReport,
  type SurveyReportStatus,
  managerApproveSurvey,
  managerRequestAmendment,
  markRondaanSelesai,
  openNextCycle,
  reassignSiteVisit,
  requestReinspection,
  requestSurveyAmendment,
  type SurveyDeletePreview,
} from "@/lib/site-visits";
import {
  downloadCompiledReport,
  downloadDefectReport,
} from "@/lib/report-templates";
import { updateAssetCode } from "@/lib/assets";
import { getImageSourceUrl } from "@/components/inspection-evidence-grid";
import {
  checkRondaanForCompletion,
  normalizePoleInput,
  type AssetLike,
  type RondaanCheckResult,
} from "@ascure/shared-utils";
import { fetchTeams, type TeamOption } from "@/lib/teams";
import type { AuthSession } from "@/types/auth";
import type {
  ChecklistColumn,
  CycleDelta,
  CycleDeltaPole,
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitContributions,
  SiteVisitDetail,
  SiteVisitInspection,
  SiteVisitSensorPhoto,
  SiteVisitStatus,
  SiteVisitValidationStatus,
  SurveyDueStatus,
  SurveyLifecycleStatus,
} from "@/types/site-visits";
import {
  STANDALONE_SURVEY_SCOPES,
  SURVEY_SCOPE_LABELS,
} from "@/types/site-visits";

type LifecycleAction =
  | "rondaan-selesai"
  | "manager-approve"
  | "manager-request-amendment"
  | "request-amendment"
  | "generate-report"
  | "archive"
  | "open-next-cycle";

const LIFECYCLE_MAIN_STEPS: {
  key: SurveyLifecycleStatus;
  label: string;
  caption: string;
}[] = [
  { key: "DALAM_RONDAAN", label: "In Progress", caption: "Inspecting" },
  { key: "RONDAAN_SELESAI", label: "In Review", caption: "Pending DC" },
  { key: "LAPORAN_SELESAI", label: "Completed", caption: "Report generated" },
  { key: "ARKIB", label: "Archived", caption: "Cycle closed" },
];

const LIFECYCLE_STEP_INDEX: Record<SurveyLifecycleStatus, number> = {
  DALAM_RONDAAN: 0,
  RONDAAN_SELESAI: 1,
  // The amendment detour all sits at the review step (1): the DC bounced it
  // (PERLU PINDAAN), the crew re-completed it (PINDAAN SELESAI, pending the
  // manager's recheck), or the now-deprecated manager-approved DISAHKAN PENGURUS.
  PERLU_PINDAAN: 1,
  PINDAAN_SELESAI: 1,
  DISAHKAN_PENGURUS: 1,
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
  const { tone, label } =
    status === "OVERDUE"
      ? { tone: "critical" as Tone, label: "Overdue" }
      : status === "DUE_SOON"
        ? { tone: "warning" as Tone, label: "Due soon" }
        : { tone: "success" as Tone, label: "On time" };
  return <Chip tone={tone}>{label}</Chip>;
}

function displayPencawang(visit: SiteVisitDetail) {
  const pencawang = [visit.pencawangCode, visit.pencawangName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" - ");

  if (pencawang) {
    return pencawang;
  }

  // A standalone equipment survey has no Pencawang by design.
  if (STANDALONE_SURVEY_SCOPES.has(visit.surveyScope)) {
    return `${SURVEY_SCOPE_LABELS[visit.surveyScope]} survey`;
  }

  return "Site Visit";
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
  const tone: Tone =
    status === "CRITICAL" ? "critical" : status === "WARNING" ? "warning" : "success";

  return <Chip tone={tone}>{status}</Chip>;
}

function StatusBadge({ status }: { status: SiteVisitStatus }) {
  const tone: Tone =
    status === "COMPLETED" ? "success" : status === "CANCELLED" ? "neutral" : "info";

  return <Chip tone={tone}>{formatEnum(status)}</Chip>;
}

function ValidationBadge({ status }: { status: SiteVisitValidationStatus }) {
  const tone: Tone =
    status === "FAILED"
      ? "critical"
      : status === "WARNING"
        ? "warning"
        : status === "VALIDATED"
          ? "success"
          : "neutral";

  return <Chip tone={tone}>{formatEnum(status)}</Chip>;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold text-[var(--foreground)]">{value}</dd>
    </div>
  );
}

function MainheadDetailField({ visit }: { visit: SiteVisitDetail }) {
  const isLegacy = !visit.mainheadRecord && Boolean(visit.mainhead?.trim());

  return (
    <div>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]">
        MAINHEAD
      </dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[var(--foreground)]">
        <span>{displayMainhead(visit)}</span>
        {isLegacy ? (
          <Chip
            tone="warning"
            title="Free-text MAINHEAD captured before Governance G1. Not linked to a MAINHEAD record."
          >
            Legacy MAINHEAD
          </Chip>
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
  // MetricTile's local tone union predates the shared Tone scale; "danger" is
  // the console's "critical". Everything else maps 1:1.
  const kpiTone: Tone = tone === "danger" ? "critical" : tone;

  return <KpiCard label={label} value={value} icon={Icon} tone={kpiTone} />;
}

function ProgressPanel({ visit }: { visit: SiteVisitDetail }) {
  const boundedPercentage = Math.min(Math.max(visit.completionPercentage, 0), 100);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            className="text-[14.5px] font-semibold leading-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Inspection Progress
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {visit.inspectedAssets} of {visit.totalAssets} linked assets submitted
          </p>
        </div>
        <div
          className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums text-[var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {boundedPercentage}%
        </div>
      </div>
      <div className="mt-5">
        <ProgressBar value={boundedPercentage} showLabel={false} />
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
    </Card>
  );
}

interface SurveyLifecyclePanelProps {
  visit: SiteVisitDetail;
  canInspect: boolean;
  canReviewSurvey: boolean;
  canGovern: boolean;
  canReport: boolean;
  pendingAction: LifecycleAction | null;
  error: string;
  downloadingReport: boolean;
  downloadingDefectReport: boolean;
  /** The latest background compile run (null = never compiled). */
  reportRun: SurveyReportStatus["run"];
  /** The latest frozen version's volumes (1 for small surveys, N Jilid for big). */
  reportVolumes: SurveyReportStatus["volumes"];
  onRondaanSelesai: () => void;
  onManagerApprove: () => void;
  onManagerRequestAmendment: (remark: string) => void;
  onRequestAmendment: (remark: string) => void;
  onGenerateReport: () => void;
  onArchive: () => void;
  onDownloadReport: (part?: number) => void;
  onDownloadDefectReport: () => void;
  onOpenNextCycle: () => void;
}

function SurveyLifecyclePanel({
  visit,
  canInspect,
  canReviewSurvey,
  canGovern,
  canReport,
  pendingAction,
  error,
  downloadingReport,
  downloadingDefectReport,
  reportRun,
  reportVolumes,
  onRondaanSelesai,
  onManagerApprove,
  onManagerRequestAmendment,
  onRequestAmendment,
  onGenerateReport,
  onArchive,
  onDownloadReport,
  onDownloadDefectReport,
  onOpenNextCycle,
}: SurveyLifecyclePanelProps) {
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentRemark, setAmendmentRemark] = useState("");

  const status: SurveyLifecycleStatus = visit.lifecycle?.status ?? "DALAM_RONDAAN";
  const currentIndex = LIFECYCLE_STEP_INDEX[status];
  const isPerluPindaan = status === "PERLU_PINDAAN";
  const isPindaanSelesai = status === "PINDAAN_SELESAI";
  const isCancelled = visit.status === "CANCELLED";
  const isBusy = pendingAction !== null;
  // A survey that has been bounced at least once carries an amendment remark —
  // used to flag a re-issued "Rondaan Selesai" apart from a fresh submission.
  const wasAmended = Boolean(visit.lifecycle?.amendmentRemark);

  // Who may send the survey back for amendments from the CURRENT state: the DC
  // from its review queue (RONDAAN SELESAI, or the deprecated DISAHKAN PENGURUS),
  // or the MANAGER while rechecking a completed amendment (PINDAAN SELESAI). The
  // dialog routes to the matching handler.
  const canManagerAmend = isPindaanSelesai && canReviewSurvey;
  const canDcAmend =
    (status === "RONDAAN_SELESAI" || status === "DISAHKAN_PENGURUS") && canGovern;
  const amendmentVisible = canManagerAmend || canDcAmend;

  // The background compile run: progress while it works, an amber note if the
  // last one failed (the survey stayed put — Generate simply retries). QUEUED
  // runs come from the list page's batch generate — same treatment as RUNNING.
  const compileRunning =
    reportRun?.status === "RUNNING" || reportRun?.status === "QUEUED";
  const compileFailed =
    reportRun?.status === "FAILED" &&
    (status === "RONDAAN_SELESAI" || status === "DISAHKAN_PENGURUS");

  // Download: one button for a single-volume report, one per Jilid otherwise.
  const downloadButtons =
    reportVolumes.length > 1 ? (
      <div className="flex flex-wrap gap-2">
        {reportVolumes.map((volume) => (
          <Tbtn
            key={volume.part}
            variant="secondary"
            onClick={() => onDownloadReport(volume.part)}
            disabled={isBusy || downloadingReport}
            title={volume.range ? `Tiang ${volume.range}` : undefined}
          >
            {downloadingReport ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <Download size={15} />
            )}
            Jilid {volume.part}/{volume.partCount}
            {volume.range ? ` · ${volume.range}` : ""}
          </Tbtn>
        ))}
      </div>
    ) : (
      <Tbtn
        variant="secondary"
        onClick={() => onDownloadReport()}
        disabled={isBusy || downloadingReport}
      >
        {downloadingReport ? (
          <RefreshCw size={15} className="animate-spin" />
        ) : (
          <Download size={15} />
        )}
        Download compiled report
      </Tbtn>
    );

  // On-demand defect handover report (Laporan Kejanggalan): defect poles only,
  // colour-coded A/B/C categories + photos, ~3 poles per page — what the
  // maintenance team receives. Never frozen; always reflects current data, so
  // it's offered at every lifecycle stage.
  const defectReportButton = (
    <Tbtn
      variant="secondary"
      onClick={onDownloadDefectReport}
      disabled={isBusy || downloadingDefectReport}
      title="Tiang berkecacatan sahaja — kategori A/B/C berwarna + gambar, untuk serahan kepada pasukan penyelenggaraan"
    >
      {downloadingDefectReport ? (
        <RefreshCw size={15} className="animate-spin" />
      ) : (
        <AlertTriangle size={15} />
      )}
      Laporan Kejanggalan
    </Tbtn>
  );

  // The console has no warning-toned button variant, so a secondary Tbtn is
  // repainted with the `medium` (amber) status tokens for the amendment actions.
  const amberBtnClass =
    "!border-[var(--medium-border)] !bg-[var(--medium-bg)] !text-[var(--medium-text)] hover:!opacity-90";

  return (
    <Card>
      <CardHead
        title={
          <span className="inline-flex items-center gap-2">
            <Activity size={16} className="text-[var(--brand)]" />
            Survey Lifecycle
          </span>
        }
        hint="The annual cycle survey for this Pencawang — inspect, review, report, archive."
      />

      <ol className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        {LIFECYCLE_MAIN_STEPS.map((step, index) => {
          const completed = index < currentIndex;
          const active = index === currentIndex;
          const attention = active && isPerluPindaan;
          const circle = completed
            ? "border-[var(--success)] bg-[var(--success)] text-[var(--on-brand)]"
            : attention
              ? "border-[var(--medium-border)] bg-[var(--medium-bg)] text-[var(--medium-text)]"
              : active
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                : "border-[var(--line-strong)] bg-[var(--panel)] text-[var(--muted-2)]";
          return (
            <li key={step.key} className="flex flex-1 items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${circle}`}
              >
                {completed ? <CheckCircle2 size={16} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${active ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-[var(--muted)]">{step.caption}</p>
              </div>
              {index < LIFECYCLE_MAIN_STEPS.length - 1 ? (
                <span className="hidden h-px flex-1 bg-[var(--line)] sm:block" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {isPerluPindaan ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--medium-border)] bg-[var(--medium-bg)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--medium-text)]">
            <AlertTriangle size={15} /> Sent back for amendments (Perlu Pindaan)
          </p>
          {visit.lifecycle?.amendmentRemark ? (
            <p className="mt-1 text-sm text-[var(--medium-text)]">
              &ldquo;{visit.lifecycle.amendmentRemark}&rdquo;
            </p>
          ) : null}
        </div>
      ) : null}

      {isPindaanSelesai ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--medium-border)] bg-[var(--medium-bg)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--medium-text)]">
            <AlertTriangle size={15} /> Amendment completed — pending manager recheck
          </p>
          {visit.lifecycle?.amendmentRemark ? (
            <p className="mt-1 text-sm text-[var(--medium-text)]">
              DC asked: &ldquo;{visit.lifecycle.amendmentRemark}&rdquo;
            </p>
          ) : null}
        </div>
      ) : null}

      {status === "RONDAAN_SELESAI" && wasAmended ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--info-border)] bg-[var(--info-bg)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--info-text)]">
            <RefreshCw size={15} /> Re-issued after amendment
          </p>
          {visit.lifecycle?.amendmentRemark ? (
            <p className="mt-1 text-sm text-[var(--info-text)]">
              Last amendment note: &ldquo;{visit.lifecycle.amendmentRemark}&rdquo;
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-sm text-[var(--critical-text)]">
          {error}
        </div>
      ) : null}

      {isCancelled ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          This visit is cancelled — the survey lifecycle is closed.
        </p>
      ) : status === "ARKIB" ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--success)]">
            <CheckCircle2 size={15} /> Cycle archived
            {visit.lifecycle?.archivedAt
              ? ` · ${formatDateTime(visit.lifecycle.archivedAt)}`
              : ""}
            .
          </p>
          {canReport ? downloadButtons : null}
          {canReport ? defectReportButton : null}
          {canInspect ? (
            <Tbtn variant="secondary" onClick={onOpenNextCycle} disabled={isBusy}>
              {pendingAction === "open-next-cycle" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CalendarDays size={15} />
              )}
              Open next cycle (re-survey)
            </Tbtn>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {(status === "DALAM_RONDAAN" || status === "PERLU_PINDAAN") && canInspect ? (
            <Tbtn variant="primary" onClick={onRondaanSelesai} disabled={isBusy}>
              {pendingAction === "rondaan-selesai" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {status === "PERLU_PINDAAN"
                ? "Re-submit (manager recheck)"
                : "Submit for DC review"}
            </Tbtn>
          ) : null}

          {isPindaanSelesai && canReviewSurvey ? (
            <Tbtn variant="primary" onClick={onManagerApprove} disabled={isBusy}>
              {pendingAction === "manager-approve" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              Confirm fixes — re-issue to DC
            </Tbtn>
          ) : null}

          {amendmentVisible ? (
            <Tbtn
              variant="secondary"
              onClick={() => setAmendmentOpen((open) => !open)}
              disabled={isBusy}
              className={amberBtnClass}
            >
              <AlertTriangle size={15} />{" "}
              {canManagerAmend ? "Send back to crew" : "Request amendment"}
            </Tbtn>
          ) : null}

          {(status === "RONDAAN_SELESAI" || status === "DISAHKAN_PENGURUS") &&
          canReport ? (
            compileRunning && reportRun ? (
              // The compile runs in the background — a big Pencawang takes
              // minutes. The page polls and flips to LAPORAN SELESAI when done.
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--info-border)] bg-[var(--info-bg)] px-3 py-2 text-sm font-semibold text-[var(--info-text)]">
                <RefreshCw size={15} className="animate-spin" />
                Menjana laporan… {reportRun.processedAssets}/{reportRun.totalAssets}{" "}
                tiang
              </span>
            ) : (
              <Tbtn
                variant="primary"
                onClick={onGenerateReport}
                disabled={isBusy}
              >
                {pendingAction === "generate-report" ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                Generate report (Laporan Selesai)
              </Tbtn>
            )
          ) : null}

          {compileFailed && reportRun?.error && !compileRunning ? (
            <p className="w-full rounded-[var(--radius-control)] border border-[var(--medium-border)] bg-[var(--medium-bg)] px-3 py-2 text-sm text-[var(--medium-text)]">
              Penjanaan laporan gagal: {reportRun.error}
            </p>
          ) : null}

          {status === "LAPORAN_SELESAI" && canReport ? downloadButtons : null}

          {/* Regenerate: re-issues the frozen report from current data with the
              currently-active template as a NEW version (downloads serve the
              latest; older versions stay stored for audit). */}
          {status === "LAPORAN_SELESAI" && canReport ? (
            compileRunning && reportRun ? (
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--info-border)] bg-[var(--info-bg)] px-3 py-2 text-sm font-semibold text-[var(--info-text)]">
                <RefreshCw size={15} className="animate-spin" />
                Menjana semula… {reportRun.processedAssets}/{reportRun.totalAssets}{" "}
                tiang
              </span>
            ) : (
              <Tbtn variant="secondary" onClick={onGenerateReport} disabled={isBusy}>
                {pendingAction === "generate-report" ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Regenerate report (new template)
              </Tbtn>
            )
          ) : null}

          {canReport ? defectReportButton : null}

          {status === "LAPORAN_SELESAI" && canGovern ? (
            <Tbtn variant="primary" onClick={onArchive} disabled={isBusy}>
              {pendingAction === "archive" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              Archive (Arkib)
            </Tbtn>
          ) : null}
        </div>
      )}

      {amendmentOpen && amendmentVisible ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--medium-border)] bg-[var(--medium-bg)] p-3">
          <label className="block font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--medium-text)]">
            {canManagerAmend
              ? "Manager recheck — what's still not fixed? (required)"
              : "Amendment remark (required)"}
          </label>
          <textarea
            value={amendmentRemark}
            onChange={(event) => setAmendmentRemark(event.target.value)}
            rows={3}
            placeholder="What must the inspector fix? (e.g. duplicate RONDAAN on pole A 3, missing photo)"
            className={`${filterControlClass} mt-1.5 !h-auto w-full resize-none py-2`}
          />
          <div className="mt-2 flex gap-2">
            <Tbtn
              variant="secondary"
              disabled={isBusy || amendmentRemark.trim().length === 0}
              onClick={() => {
                const remark = amendmentRemark.trim();
                if (canManagerAmend) {
                  onManagerRequestAmendment(remark);
                } else {
                  onRequestAmendment(remark);
                }
                setAmendmentRemark("");
                setAmendmentOpen(false);
              }}
              className={amberBtnClass}
            >
              {pendingAction === "manager-request-amendment" ||
              pendingAction === "request-amendment" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <AlertTriangle size={15} />
              )}
              Send back for amendments
            </Tbtn>
            <Tbtn variant="secondary" onClick={() => setAmendmentOpen(false)}>
              Cancel
            </Tbtn>
          </div>
        </div>
      ) : null}

      {visit.lifecycleEvents.length > 0 ? (
        <div className="mt-5 border-t border-[var(--line2)] pt-4">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]">
            History
          </p>
          <ul className="mt-2 space-y-2">
            {visit.lifecycleEvents.map((event) => (
              <li key={event.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="text-[var(--foreground-soft)]">
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
    </Card>
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
      ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
      : tone === "removed"
        ? "border-[var(--critical-border)] bg-[var(--critical-bg)] text-[var(--critical-text)]"
        : "border-[var(--neutral-border)] bg-[var(--neutral-bg)] text-[var(--neutral-text)]";
  return (
    <div className={`rounded-[var(--radius-control)] border p-3 text-center ${className}`}>
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
          className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-0.5 text-xs font-semibold text-[var(--foreground-soft)]"
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
    <Card>
      <CardHead
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarDays size={16} className="text-[var(--brand)]" />
            Inspection Cycle
          </span>
        }
      />

      {delta.recency.lastInspectedAt ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-[var(--muted)]">Last inspected:</span>
          <span className="font-semibold text-[var(--foreground)]">
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
          <p className="mt-2 text-sm text-[var(--muted)]">
            This survey versus the previous inspection:
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <CycleDeltaStat count={delta.summary.added} label="New" tone="added" />
            <CycleDeltaStat count={delta.summary.removed} label="Removed" tone="removed" />
            <CycleDeltaStat count={delta.summary.carried} label="Carried" tone="carried" />
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--success-text)]">
                New poles
              </p>
              <CycleDeltaPoleList poles={delta.newPoles} emptyText="None added this cycle." />
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--critical-text)]">
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
    </Card>
  );
}

function ContributionsPanel({
  contributions,
}: {
  contributions: SiteVisitContributions;
}) {
  const { teams, reassignments, totalAssets, totalCompleted } = contributions;

  return (
    <Card>
      <CardHead
        title={
          <span className="inline-flex items-center gap-2">
            <Users size={16} className="text-[var(--brand)]" />
            Team Contributions
          </span>
        }
        hint={
          <>
            Each team&apos;s share of completed inspections — the basis for contractor
            billing when a Pencawang is split across teams (ADR 0002 §5).
            {totalAssets > 0 ? (
              <>
                {" "}
                <span className="font-semibold text-[var(--foreground-soft)]">
                  {totalCompleted} of {totalAssets}
                </span>{" "}
                assets completed.
              </>
            ) : null}
          </>
        }
      />

      <div className="mt-4 space-y-3">
        {teams.map((team) => {
          const pct =
            totalAssets > 0
              ? Math.round((team.assetsCompleted / totalAssets) * 100)
              : 0;

          return (
            <div key={team.teamId} className="rounded-[var(--radius-control)] border border-[var(--line)] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                  {team.teamName ?? "Unknown team"}
                  {team.isCurrent ? <Chip tone="success">Current</Chip> : null}
                </span>
                <span className="text-sm font-semibold text-[var(--foreground-soft)]">
                  {team.assetsCompleted}
                  {totalAssets > 0 ? ` / ${totalAssets}` : ""}
                  <span className="ml-1 text-xs text-[var(--muted)]">({pct}%)</span>
                </span>
              </div>
              <div className="mt-1.5">
                <ProgressBar value={pct} showLabel={false} />
              </div>
              {team.snapshots.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {team.snapshots.map((snapshot, index) => (
                    <span
                      key={index}
                      className="rounded-md border border-[var(--line)] bg-[var(--panel-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]"
                    >
                      {snapshot.reason === "COMPLETED" ? "Completed" : "Handover"}:{" "}
                      {snapshot.assetsCompleted}
                      {snapshot.at ? ` · ${formatDateTime(snapshot.at)}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {reassignments.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]">
            Handover history
          </p>
          <ul className="space-y-2">
            {reassignments.map((entry, index) => (
              <li key={index} className="text-sm text-[var(--foreground-soft)]">
                <span className="flex flex-wrap items-center gap-x-1.5">
                  <span className="font-semibold">{entry.fromTeamName ?? "—"}</span>
                  <ArrowLeftRight size={13} className="text-[var(--muted)]" />
                  <span className="font-semibold">{entry.toTeamName ?? "—"}</span>
                  {entry.at ? (
                    <span className="text-xs text-[var(--muted)]">
                      · {formatDateTime(entry.at)}
                    </span>
                  ) : null}
                </span>
                {entry.reason ? (
                  <span className="mt-0.5 block text-xs italic text-[var(--muted)]">
                    “{entry.reason}”
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function ReassignTeamPanel({
  visit,
  token,
  canReassign,
  allowCrossCompany,
  onReassigned,
}: {
  visit: SiteVisitDetail;
  token: string | null;
  canReassign: boolean;
  allowCrossCompany: boolean;
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
  // Same-company teams are the default targets; an ADMIN may hand the survey
  // to ANY company's team (the API permits cross-org reassign for ADMIN only,
  // so widening the picker for anyone else would just earn a 403). The API also
  // rejects an inactive target team, so those never make useful options.
  const currentTeam = teams.find((team) => team.id === currentTeamId);
  const options = teams.filter(
    (team) =>
      team.id !== currentTeamId &&
      team.isActive &&
      (allowCrossCompany ||
        !currentTeam ||
        (team.organizationId ?? null) === (currentTeam.organizationId ?? null)),
  );
  // Cross-company picker groups by company, current team's company first.
  const companyGroups = allowCrossCompany
    ? [...options]
        .sort((a, b) =>
          (a.organizationName ?? "￿").localeCompare(b.organizationName ?? "￿"),
        )
        .reduce<{ key: string; label: string; teams: TeamOption[] }[]>((acc, team) => {
          const key = team.organizationId ?? "";
          const group = acc.find((entry) => entry.key === key);
          if (group) {
            group.teams.push(team);
          } else {
            acc.push({
              key,
              label: team.organizationName ?? "No company",
              teams: [team],
            });
          }
          return acc;
        }, [])
        .sort((a, b) =>
          a.key === (currentTeam?.organizationId ?? "")
            ? -1
            : b.key === (currentTeam?.organizationId ?? "")
              ? 1
              : 0,
        )
    : null;
  const selectedTeam = options.find((team) => team.id === toTeamId);
  const isCrossCompanyTarget = Boolean(
    selectedTeam &&
      (selectedTeam.organizationId ?? null) !== (currentTeam?.organizationId ?? null),
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
    <Card>
      <CardHead
        title={
          <span className="inline-flex items-center gap-2">
            <Users size={16} className="text-[var(--brand)]" />
            Team Assignment
          </span>
        }
        hint={
          <>
            Owned by{" "}
            <span className="font-semibold text-[var(--foreground-soft)]">
              {currentTeamLabel}
            </span>
            . Hand the in-progress survey to another team — every inspection, photo and
            defect transfers.
          </>
        }
        actions={
          !open ? (
            <Tbtn variant="secondary" onClick={() => setOpen(true)}>
              <ArrowLeftRight size={15} /> Reassign team
            </Tbtn>
          ) : null
        }
      />

      {error ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-sm text-[var(--critical-text)]">
          {error}
        </div>
      ) : null}

      {open ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-4">
          <label className={filterLabelClass}>Reassign to team</label>
          <select
            value={toTeamId}
            onChange={(event) => setToTeamId(event.target.value)}
            className={`${filterSelectClass} mt-1.5 w-full`}
          >
            <option value="">{teamsLoaded ? "Select a team…" : "Loading teams…"}</option>
            {companyGroups
              ? companyGroups.map((group) => (
                  <optgroup key={group.key || "none"} label={group.label}>
                    {group.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name?.trim() || team.code?.trim() || team.id}
                      </option>
                    ))}
                  </optgroup>
                ))
              : options.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name?.trim() || team.code?.trim() || team.id}
                  </option>
                ))}
          </select>

          {isCrossCompanyTarget ? (
            <div className="mt-2 rounded-[var(--radius-control)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-[var(--warning-text)]">
              This hands the survey to a <span className="font-semibold">different company</span>
              {selectedTeam?.organizationName ? (
                <>
                  {" "}
                  (<span className="font-semibold">{selectedTeam.organizationName}</span>)
                </>
              ) : null}
              . Every inspection, photo and defect transfers with it, and the outgoing
              team&apos;s contribution is snapshotted for billing.
            </div>
          ) : null}

          <label className={`${filterLabelClass} mt-3 block`}>Reason (required)</label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Why is this being reassigned? (e.g. Team Alpha pulled to an outage — Beta to finish the walk)"
            className={`${filterControlClass} mt-1.5 !h-auto w-full resize-none py-2`}
          />

          <div className="mt-3 flex gap-2">
            <Tbtn variant="primary" disabled={!canSubmit} onClick={() => void submit()}>
              {submitting ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <ArrowLeftRight size={15} />
              )}
              Reassign
            </Tbtn>
            <Tbtn
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </Tbtn>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function DeleteStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "danger" | "neutral";
}) {
  const className =
    tone === "danger"
      ? "border-[var(--critical-border)] bg-[var(--critical-bg)] text-[var(--critical-text)]"
      : "border-[var(--neutral-border)] bg-[var(--neutral-bg)] text-[var(--neutral-text)]";
  return (
    <div className={`rounded-[var(--radius-control)] border p-3 text-center ${className}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-semibold uppercase">{label}</p>
    </div>
  );
}

/**
 * ADMIN-only danger zone: hard-delete this survey + the poles created during it
 * (poles shared with another survey are kept). Loads a server preview of what
 * will be removed, and requires typing the Pencawang code to arm the delete.
 */
function DeleteSurveyPanel({
  visit,
  token,
  onDeleted,
  onUnauthorized,
}: {
  visit: SiteVisitDetail;
  token: string | null;
  onDeleted: () => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SurveyDeletePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const confirmTarget =
    visit.pencawangCode?.trim() ||
    visit.pencawangName?.trim() ||
    visit.substation?.code?.trim() ||
    visit.substation?.name?.trim() ||
    "DELETE";

  const openPanel = useCallback(async () => {
    setOpen(true);
    setError("");
    setPreviewError("");
    setPreview(null);
    setConfirmText("");
    if (!token) return;
    try {
      setPreview(await fetchSurveyDeletePreview(token, visit.id));
    } catch (previewLoadError) {
      if (previewLoadError instanceof ApiError && previewLoadError.status === 401) {
        onUnauthorized();
        return;
      }
      setPreviewError(
        previewLoadError instanceof Error
          ? previewLoadError.message
          : "Unable to load the deletion preview.",
      );
    }
  }, [token, visit.id, onUnauthorized]);

  const canConfirm =
    Boolean(token) && !submitting && confirmText.trim() === confirmTarget;

  const submit = useCallback(async () => {
    if (!token || confirmText.trim() !== confirmTarget) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await deleteSiteVisit(token, visit.id);
      onDeleted();
    } catch (deleteError) {
      if (deleteError instanceof ApiError && deleteError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete this survey.",
      );
      setSubmitting(false);
    }
  }, [token, confirmText, confirmTarget, visit.id, onDeleted, onUnauthorized]);

  return (
    <Card className="!border-[var(--critical-border)] !bg-[var(--danger-tint)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="flex items-center gap-2 text-[14.5px] font-semibold text-[var(--critical-text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Trash2 size={16} className="text-[var(--critical)]" />
            Danger zone — delete survey
          </div>
          <p className="mt-1 text-[12px] text-[var(--critical-text)]">
            Permanently deletes this survey and the poles created during it — its
            inspections, photos, compiled report and history. Poles also used by
            another survey/cycle are kept. This cannot be undone.
          </p>
        </div>
        {!open ? (
          <Tbtn variant="danger" onClick={() => void openPanel()}>
            <Trash2 size={15} /> Delete survey
          </Tbtn>
        ) : null}
      </div>

      {open ? (
        <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--panel)] p-4">
          {previewError ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--medium-border)] bg-[var(--medium-bg)] px-3 py-2 text-sm text-[var(--medium-text)]">
              {previewError}
            </div>
          ) : preview ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <DeleteStat label="Poles to delete" value={preview.assetsToDelete} tone="danger" />
              <DeleteStat label="Inspections" value={preview.inspections} tone="danger" />
              <DeleteStat label="Shared poles kept" value={preview.sharedAssetsKept} tone="neutral" />
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Loading deletion preview…</p>
          )}

          <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--critical-text)]">
            Type <span className="font-mono text-[var(--foreground)]">{confirmTarget}</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={confirmTarget}
            className={`${filterControlClass} mt-1.5 w-full !border-[var(--critical-border)]`}
          />

          {error ? (
            <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-sm text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Tbtn variant="danger" disabled={!canConfirm} onClick={() => void submit()}>
              {submitting ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Permanently delete
            </Tbtn>
            <Tbtn
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </Tbtn>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

interface SensorPhotoView {
  photo: SiteVisitSensorPhoto;
  reading: string | null;
  poleCode: string;
  /** What the photo is — the pinned Kelegaan cell keeps the Smart Sensor wording;
   *  a template IMAGE column passes its own field label. */
  label?: string;
}

/**
 * Full-size viewer for a Smart Sensor photo, shown beside its recorded reading so
 * the DC can confirm the OCR value matches the LCD in the photo. Closes on the X,
 * a backdrop click, or Escape.
 */
function SensorPhotoLightbox({
  view,
  onClose,
}: {
  view: SensorPhotoView;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog so Escape/Tab act on it — not the thumbnail
    // button behind the overlay — then restore focus to the opener on close.
    dialogRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) {
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const src = getImageSourceUrl({ url: view.photo.url });
  const gps =
    typeof view.photo.latitude === "number" &&
    Number.isFinite(view.photo.latitude) &&
    typeof view.photo.longitude === "number" &&
    Number.isFinite(view.photo.longitude)
      ? `${view.photo.latitude.toFixed(6)}, ${view.photo.longitude.toFixed(6)}`
      : null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${view.label ?? "Smart Sensor photo"} for ${view.poleCode}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)] outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[13px] font-semibold text-[var(--foreground)]">
              {view.poleCode}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">
              {view.label ?? "Smart Sensor photo"}
            </p>
            {/* The reading comparison only makes sense for the Smart Sensor cell;
                a template IMAGE column opens with no reading. */}
            {view.reading !== null ? (
              <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                Recorded reading:{" "}
                <span className="font-semibold text-[var(--foreground-soft)]">
                  {view.reading}
                </span>{" "}
                — compare against the LCD in the photo.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--panel-muted)] p-3">
          {src && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={
                view.photo.filename ??
                `${view.label ?? "Smart Sensor photo"} for ${view.poleCode}`
              }
              onError={() => setBroken(true)}
              className="max-h-[70vh] w-auto max-w-full rounded-[var(--radius-control)] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--muted)]">
              <ImageOff size={28} className="text-[var(--muted-2)]" />
              Photo unavailable — the file could not be loaded.
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-2 text-[11px] text-[var(--muted)]">
          <span>{formatDateTime(view.photo.timestamp)}</span>
          <span className="flex items-center gap-3">
            {gps ? <span>GPS {gps}</span> : null}
            {src ? (
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[var(--brand)] hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                Open full size
              </a>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

type FixedAssetSortKey =
  | "rondaan"
  | "lama"
  | "bacaan"
  | "gambar"
  | "catitan"
  | "type"
  | "source"
  | "added";
/** A fixed column key, or a DC-toggled checklist column keyed `checklist:<label>`. */
type AssetSortKey = FixedAssetSortKey | `checklist:${string}`;
type AssetSortDirection = "asc" | "desc";

const CHECKLIST_SORT_PREFIX = "checklist:";
/** localStorage key for the DC's personal set of extra checklist columns. Global
 *  across visits — the picker renders only the ones a given visit actually has. */
const CHECKLIST_COLUMNS_STORAGE_KEY = "ascure.siteVisit.checklistColumns";
/** localStorage key for the optional Type/Source/Added metadata columns —
 *  HIDDEN by default (owner: they eat width the checklist values need). */
const META_COLUMNS_STORAGE_KEY = "ascure.siteVisit.metaColumns";

function assetSortText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Comparable value for a Linked-Assets column: numeric for the reading / photo
 * presence / added-date, natural-sortable lowercase text for the rest. Empties
 * collapse to "" or 0 so they cluster at one end (matches the Assets table).
 */
function getAssetSortValue(link: SiteVisitAssetLink, key: AssetSortKey): string | number {
  switch (key) {
    case "rondaan":
      return assetSortText(link.asset.assetCode);
    case "lama":
      return assetSortText(link.asset.noTiangLama ?? link.asset.name);
    case "bacaan": {
      const raw = link.checklist?.bacaanKelegaan1 ?? "";
      const numeric = Number.parseFloat(raw);
      return Number.isFinite(numeric) ? numeric : assetSortText(raw);
    }
    case "gambar":
      return link.checklist?.bacaanKelegaan1Image?.url ? 1 : 0;
    case "catitan":
      return assetSortText(link.checklist?.catitan);
    case "type":
      return assetSortText(link.asset.assetType?.name ?? link.asset.assetType?.code);
    case "source":
      return assetSortText(link.source);
    case "added": {
      const time = link.addedAt ? new Date(link.addedAt).getTime() : 0;
      return Number.isFinite(time) ? time : 0;
    }
    default: {
      // Dynamic checklist column (`checklist:<normalized label>`): numeric when
      // the recorded value parses as a number, else natural-sortable text.
      const raw =
        link.checklistValues?.[key.slice(CHECKLIST_SORT_PREFIX.length)]?.trim() ?? "";
      if (!raw) {
        return "";
      }
      const numeric = Number.parseFloat(raw);
      return Number.isFinite(numeric) ? numeric : raw.toLowerCase();
    }
  }
}

function compareAssetSortValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  // Natural, case-insensitive — so "A 1/1/1/1/2" orders sensibly with numbers.
  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

/** Clickable Linked-Assets column header: sort by this key, toggle asc/desc. */
function SortButton({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: AssetSortKey;
  activeSortKey: AssetSortKey;
  direction: AssetSortDirection;
  onSort: (key: AssetSortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}${
        isActive ? (direction === "asc" ? " (ascending)" : " (descending)") : ""
      }`}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-left transition ${
        isActive ? "text-[var(--foreground)]" : "hover:text-[var(--foreground-soft)]"
      }`}
    >
      {label}
      <Icon size={13} className={isActive ? "text-[var(--brand)]" : "text-[var(--muted-2)]"} />
    </button>
  );
}

/**
 * Inline-editable Linked-Assets cell (NO TIANG RONDAAN / Bacaan Kelegaan 1). When
 * `canEdit`, a hover pencil switches the cell to an input with save/cancel;
 * Enter saves, Esc cancels. All interactions stopPropagation so the row's
 * navigate-to-asset click/keydown doesn't fire. `onSave` does the API write +
 * refetch; errors surface inline.
 */
function EditableCell({
  value,
  canEdit,
  onSave,
  ariaLabel,
  placeholder,
  inputMode = "text",
  mono = false,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
  ariaLabel: string;
  placeholder?: string;
  inputMode?: "text" | "decimal";
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
      wasEditing.current = true;
    } else if (wasEditing.current) {
      // On close (save/cancel) return focus to the pencil so a keyboard user
      // keeps their place instead of dropping to document.body.
      wasEditing.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  const begin = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    setDraft(value ?? "");
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError("");
  };
  const commit = async () => {
    if (saving) {
      return;
    }
    const next = draft.trim();
    if (next === (value ?? "").trim()) {
      cancel();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group/edit flex items-center gap-1.5">
        <span className={mono ? "font-mono" : undefined}>{formatNullable(value)}</span>
        {canEdit ? (
          <button
            ref={triggerRef}
            type="button"
            onClick={begin}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={`Edit ${ariaLabel}`}
            className="shrink-0 rounded p-0.5 text-[var(--muted-2)] opacity-0 outline-none transition group-hover/edit:opacity-100 hover:text-[var(--brand)] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[var(--brand)]"
          >
            <Pencil size={13} />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          inputMode={inputMode}
          disabled={saving}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className={`h-8 w-full min-w-28 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--panel)] px-2 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--brand)] ${
            mono ? "font-mono" : ""
          }`}
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void commit();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={saving}
          aria-label="Save"
          className="shrink-0 rounded p-1 text-[var(--success)] hover:bg-[var(--panel-muted)] disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            cancel();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={saving}
          aria-label="Cancel"
          className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--panel-muted)] disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
      {error ? (
        <span className="text-[11px] text-[var(--critical-text)]">{error}</span>
      ) : null}
    </div>
  );
}

/**
 * Linked-Assets cell for a checklist column whose item is a dropdown (a SELECT's
 * configured options, or a BOOLEAN's Yes/No) — mirrors the checklist template so
 * a manager picks a value instead of typing. Always-visible when editable; the
 * leading "N/A" clears the value. Changing it saves immediately. stopPropagation
 * keeps the row's navigate-to-asset click quiet.
 */
function ChecklistSelectCell({
  value,
  options,
  canEdit,
  ariaLabel,
  onSave,
}: {
  value: string | null;
  options: { label: string; value: string }[];
  canEdit: boolean;
  ariaLabel: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = value ?? "";

  if (!canEdit) {
    return <span>{formatNullable(value)}</span>;
  }

  // A stored value that isn't one of the current template options still renders,
  // so the cell shows the truth instead of silently dropping to N/A.
  const knownValue =
    current === "" || options.some((option) => option.value === current);

  const handleChange = async (next: string) => {
    if (next === current) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(next);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()}>
      <select
        value={current}
        disabled={saving}
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => void handleChange(event.target.value)}
        className="h-8 w-full min-w-28 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--panel)] px-2 text-[13px] text-[var(--foreground)] outline-none transition focus:border-[var(--brand)] disabled:opacity-50"
      >
        <option value="">— N/A —</option>
        {!knownValue ? <option value={current}>{current}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-[11px] text-[var(--critical-text)]">{error}</span>
      ) : null}
    </div>
  );
}

/**
 * Linked-Assets cell for the Smart Sensor photo behind a Bacaan Kelegaan 1
 * reading. Shows a thumbnail that opens the full-size viewer; a muted dash when
 * no item-tagged photo was captured. Stops click/keyboard events from bubbling
 * to the row (which navigates to the asset detail).
 */
function SensorPhotoCell({
  photo,
  reading,
  poleCode,
  onOpen,
  label = "Smart Sensor photo",
}: {
  photo: SiteVisitSensorPhoto | null;
  reading: string | null;
  poleCode: string;
  onOpen: (view: SensorPhotoView) => void;
  /** What this photo is, for the a11y label — the pinned Kelegaan cell keeps the
   *  Smart Sensor wording; a template IMAGE column passes its own field label. */
  label?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = photo ? getImageSourceUrl({ url: photo.url }) : null;

  if (!photo || !src) {
    // No item-tagged photo was captured for this reading.
    return <span className="text-[var(--muted-2)]">—</span>;
  }

  if (broken) {
    // A photo record exists but its file could not be loaded — flag it (distinct
    // from the em-dash "no photo") so the DC knows the reading is unverifiable.
    return (
      <span
        className="inline-flex items-center gap-1 text-[var(--muted-2)]"
        title={`${label} unavailable`}
      >
        <ImageOff size={14} /> N/A
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen({ photo, reading, poleCode, label });
      }}
      onKeyDown={(event) => {
        // Keep Enter/Space from bubbling to the row (which navigates to the
        // asset); let every other key (Escape, Tab, …) pass through.
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
        }
      }}
      aria-label={`View ${label} for ${poleCode}`}
      className="group block h-10 w-14 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover transition group-hover:scale-105"
      />
    </button>
  );
}

/** The pole a "send back for re-inspection" prompt is open for. */
type SendBackTarget = { inspectionId: string; assetCode: string };

/**
 * Prompt for sending ONE pole back for re-inspection from the Linked Assets
 * table — the same action the Asset Map panel offers, asked for in a dialog
 * because a table row has nowhere to expand. The reason is required and is what
 * the crew sees; nothing is deleted, the pole simply reads as not inspected
 * until they redo it. `onSubmit` does the API write + refetch and its error is
 * shown here rather than closing over a lost edit.
 */
function SendBackDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: SendBackTarget;
  onClose: () => void;
  onSubmit: (inspectionId: string, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = async () => {
    const trimmed = reason.trim();
    if (saving || !trimmed) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(target.inspectionId, trimmed);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to send this pole back.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Send ${target.assetCode} back for re-inspection`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]"
      >
        <p
          className="text-[14.5px] font-semibold text-[var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Send{" "}
          <span className="font-mono">{target.assetCode}</span> back for
          re-inspection
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-[var(--muted)]">
          The crew sees your reason. Every recorded answer, photo and defect is
          kept — the pole simply reads as not inspected until they redo it.
        </p>

        <label className="mt-4 block font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--medium-text)]">
          Why does this pole need re-inspecting? (required)
        </label>
        <textarea
          autoFocus
          rows={3}
          value={reason}
          disabled={saving}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Kelegaan reading 5.98 m does not match the photo — please re-measure"
          className={`${filterControlClass} mt-1.5 !h-auto w-full resize-none py-2`}
        />

        {error ? (
          <p className="mt-2 text-[12.5px] text-[var(--critical-text)]">{error}</p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Tbtn
            variant="secondary"
            disabled={saving || reason.trim().length === 0}
            onClick={() => void commit()}
            className="!border-[var(--medium-border)] !bg-[var(--medium-bg)] !text-[var(--medium-text)] hover:!opacity-90"
          >
            {saving ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <RotateCcw size={15} />
            )}
            Send back
          </Tbtn>
          <Tbtn variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Tbtn>
        </div>
      </div>
    </div>
  );
}

// Fixed Linked-Assets columns shown before / after the DC's toggleable checklist
// columns. The extras slot between Catitan and Type so every checklist-derived
// field clusters together, ahead of the asset/link metadata.
const LINKED_ASSET_LEAD_COLUMNS: [string, AssetSortKey][] = [
  ["No Tiang Rondaan", "rondaan"],
  ["No Tiang Lama", "lama"],
  ["Bacaan Kelegaan 1", "bacaan"],
  ["Gambar Kelegaan", "gambar"],
  ["Catitan", "catitan"],
];
// Asset/link metadata columns after the checklist block. NOT shown by default
// (they crowd out the checklist values) — the Columns picker toggles them on,
// persisted like the checklist selection.
const LINKED_ASSET_TAIL_COLUMNS: [string, AssetSortKey][] = [
  ["Type", "type"],
  ["Source", "source"],
  ["Added", "added"],
];

/**
 * "Columns" dropdown for the Linked Assets table: lets the DC toggle any
 * template-defined checklist field on as an extra read-only column. Options come
 * from the visit's `checklistColumns` (template order, grouped by section); the
 * selection is personal (persisted by the parent to localStorage). Closes on an
 * outside click or Escape. Renders nothing when the visit exposes no fields.
 */
function ChecklistColumnPicker({
  columns,
  selectedKeys,
  onChange,
  metaColumns,
  selectedMetaKeys,
  onMetaChange,
}: {
  columns: ChecklistColumn[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  /** The optional Type/Source/Added metadata columns (hidden by default). */
  metaColumns: { key: string; label: string }[];
  selectedMetaKeys: string[];
  onMetaChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (columns.length === 0 && metaColumns.length === 0) {
    return null;
  }

  const selectedCount =
    columns.filter((column) => selectedKeys.includes(column.key)).length +
    metaColumns.filter((column) => selectedMetaKeys.includes(column.key)).length;

  const toggle = (key: string) => {
    onChange(
      selectedKeys.includes(key)
        ? selectedKeys.filter((value) => value !== key)
        : [...selectedKeys, key],
    );
  };

  const toggleMeta = (key: string) => {
    onMetaChange(
      selectedMetaKeys.includes(key)
        ? selectedMetaKeys.filter((value) => value !== key)
        : [...selectedMetaKeys, key],
    );
  };

  // Group into contiguous runs by section title, preserving template order.
  const groups: { section: string | null; items: ChecklistColumn[] }[] = [];
  for (const column of columns) {
    const last = groups[groups.length - 1];
    if (last && last.section === column.section) {
      last.items.push(column);
    } else {
      groups.push({ section: column.section, items: [column] });
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Tbtn variant="secondary" onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={15} />
        Columns
        {selectedCount > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-bold text-[var(--on-brand)]">
            {selectedCount}
          </span>
        ) : null}
      </Tbtn>
      {open ? (
        <div className="absolute right-0 z-30 mt-1.5 w-72 overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between border-b border-[var(--line2)] px-3 py-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]">
              Checklist columns
            </span>
            {selectedCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onChange([]);
                  onMetaChange([]);
                }}
                className="text-[11px] font-semibold text-[var(--brand)] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {groups.map((group, groupIndex) => (
              <div key={group.section ?? `group-${groupIndex}`} className="mb-1 last:mb-0">
                {group.section ? (
                  <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-[var(--muted)]">
                    {group.section}
                  </p>
                ) : null}
                {group.items.map((column) => (
                  <label
                    key={column.key}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(column.key)}
                      onChange={() => toggle(column.key)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                    />
                    <span className="min-w-0 flex-1 break-words">{column.label}</span>
                  </label>
                ))}
              </div>
            ))}
            {metaColumns.length > 0 ? (
              <div className={columns.length > 0 ? "mt-1 border-t border-[var(--line2)] pt-1" : undefined}>
                <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-[var(--muted)]">
                  Table info
                </p>
                {metaColumns.map((column) => (
                  <label
                    key={column.key}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[13px] text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMetaKeys.includes(column.key)}
                      onChange={() => toggleMeta(column.key)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                    />
                    <span className="min-w-0 flex-1 break-words">{column.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
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
  const [contributions, setContributions] = useState<SiteVisitContributions | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [inspectionsExpanded, setInspectionsExpanded] = useState(false);
  const [sensorPhotoView, setSensorPhotoView] = useState<SensorPhotoView | null>(null);
  // Stable identity so the lightbox's focus effect isn't torn down/re-run (and
  // focus yanked back) by the 60s auto-refresh re-render while it's open.
  const closeSensorPhoto = useCallback(() => setSensorPhotoView(null), []);
  // The pole whose "send back for re-inspection" prompt is open (null = closed).
  // Stable callbacks for the same reason as the lightbox above.
  const [sendBackTarget, setSendBackTarget] = useState<SendBackTarget | null>(null);
  const closeSendBack = useCallback(() => setSendBackTarget(null), []);
  const [assetSortKey, setAssetSortKey] = useState<AssetSortKey>("rondaan");
  const [assetSortDirection, setAssetSortDirection] =
    useState<AssetSortDirection>("asc");
  // DC's personal set of extra checklist columns (normalized label keys). Hydrated
  // from localStorage after mount to avoid an SSR/first-paint hydration mismatch.
  const [selectedChecklistKeys, setSelectedChecklistKeys] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHECKLIST_COLUMNS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSelectedChecklistKeys(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      // Ignore unavailable or malformed storage — the table just shows no extras.
    }
  }, []);

  const persistChecklistKeys = useCallback((keys: string[]) => {
    setSelectedChecklistKeys(keys);
    try {
      window.localStorage.setItem(CHECKLIST_COLUMNS_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Selection still applies for this session even if it can't be persisted.
    }
  }, []);

  // Optional Type/Source/Added metadata columns — hidden by default, toggled on
  // via the same Columns picker. Hydrated after mount like the checklist keys.
  const [selectedMetaKeys, setSelectedMetaKeys] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(META_COLUMNS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSelectedMetaKeys(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      // Ignore unavailable or malformed storage — the columns just stay hidden.
    }
  }, []);

  const persistMetaKeys = useCallback((keys: string[]) => {
    setSelectedMetaKeys(keys);
    try {
      window.localStorage.setItem(META_COLUMNS_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Selection still applies for this session even if it can't be persisted.
    }
  }, []);

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

  const loadContributions = useCallback(
    async (token: string) => {
      try {
        setContributions(await fetchSiteVisitContributions(token, siteVisitId));
      } catch {
        // Supplementary billing view — never block the detail on it.
        setContributions(null);
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
      void loadContributions(storedSession.token);
    }
  }, [loadVisit, loadDelta, loadContributions]);

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
  // Manager review gate (technician/supervisor → MANAGER → DC). ADMIN or a
  // MANAGER (server flag, since MANAGER collapses to VIEWER client-side). The
  // lifecycle endpoint still enforces the role + the manager's company scope.
  const canReviewSurvey = isAdmin || (session?.user?.canReviewSurvey ?? false);
  const canGovern = isAdmin || (session?.user?.canGovernQa ?? false);
  const canReport = isAdmin || (session?.user?.canReport ?? false);
  // Server-computed flag (ADMIN / MANAGER / SUPERVISOR) — the admin console can't read
  // those roles client-side (MANAGER/SUPERVISOR collapse to VIEWER on login), so we mirror
  // the API's authority. The endpoint still enforces the per-team / cross-org rules.
  const canReassign = isAdmin || (session?.user?.canReassign ?? false);
  // Hard-delete the survey (+ its created poles). ADMIN, or a MANAGER (server
  // flag — MANAGER collapses to VIEWER client-side); the API scopes a MANAGER to
  // their own company.
  const canDeleteSurvey = isAdmin || (session?.user?.canDeleteSurvey ?? false);
  // Inline edit of NO TIANG RONDAAN + Bacaan Kelegaan 1 in the Linked Assets
  // table — ADMIN, DC (canGovernQa), or the respective MANAGER (canReviewSurvey).
  // The API re-enforces its own scope on each write.
  const canEditLinkedAssets = canGovern || canReviewSurvey;

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

  const handleManagerApprove = useCallback(() => {
    const token = session?.token;
    if (!token) return;
    void runLifecycle("manager-approve", () =>
      managerApproveSurvey(token, siteVisitId),
    );
  }, [runLifecycle, session?.token, siteVisitId]);

  const handleManagerRequestAmendment = useCallback(
    (remark: string) => {
      const token = session?.token;
      if (!token) return;
      void runLifecycle("manager-request-amendment", () =>
        managerRequestAmendment(token, siteVisitId, remark),
      );
    },
    [runLifecycle, session?.token, siteVisitId],
  );

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

  // The background report compile: Generate starts a run; the page polls the
  // run's progress and reloads the visit (now LAPORAN SELESAI) when it lands.
  const [reportStatus, setReportStatus] = useState<SurveyReportStatus | null>(
    null,
  );
  const refreshReportStatus = useCallback(async () => {
    const token = session?.token;
    if (!token) return;
    try {
      setReportStatus(await fetchSurveyReportStatus(token, siteVisitId));
    } catch {
      // Progress is a convenience — a failed poll must never break the page.
    }
  }, [session?.token, siteVisitId]);

  const lifecycleStatusValue = visit?.lifecycle?.status ?? null;
  useEffect(() => {
    if (
      lifecycleStatusValue === "RONDAAN_SELESAI" ||
      lifecycleStatusValue === "DISAHKAN_PENGURUS" ||
      lifecycleStatusValue === "LAPORAN_SELESAI" ||
      lifecycleStatusValue === "ARKIB"
    ) {
      void refreshReportStatus();
    }
  }, [lifecycleStatusValue, refreshReportStatus]);

  useEffect(() => {
    const runStatus = reportStatus?.run?.status;
    if (runStatus !== "RUNNING" && runStatus !== "QUEUED") return;
    const timer = setInterval(() => {
      void refreshReportStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [reportStatus?.run?.status, refreshReportStatus]);

  // When the run lands, reload the visit — the lifecycle flipped server-side.
  const prevRunStatus = useRef<string | null>(null);
  useEffect(() => {
    const current = reportStatus?.run?.status ?? null;
    if (
      (prevRunStatus.current === "RUNNING" || prevRunStatus.current === "QUEUED") &&
      current === "COMPLETED"
    ) {
      const token = session?.token;
      if (token) void loadVisit(token, false);
    }
    prevRunStatus.current = current;
  }, [reportStatus?.run?.status, session?.token, loadVisit]);

  const handleGenerateReport = useCallback(async () => {
    const token = session?.token;
    if (!token) return;
    setPendingAction("generate-report");
    setLifecycleError("");
    try {
      await generateSurveyReport(token, siteVisitId);
      await refreshReportStatus();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleLogout();
        return;
      }
      setLifecycleError(
        error instanceof Error
          ? error.message
          : "Unable to start the report compile.",
      );
    } finally {
      setPendingAction(null);
    }
  }, [session?.token, siteVisitId, refreshReportStatus, handleLogout]);

  const handleArchive = useCallback(() => {
    const token = session?.token;
    if (!token) return;
    void runLifecycle("archive", () => archiveSurvey(token, siteVisitId));
  }, [runLifecycle, session?.token, siteVisitId]);

  // Send ONE pole back for re-inspection from its Linked Assets row. The reason
  // is required (the crew reads it) and nothing is deleted — the pole returns to
  // DRAFT, so it turns red on the crew's map and drops out of coverage until
  // they re-submit. The API re-enforces authority and its own guards (already in
  // maintenance / not submitted / cancelled visit); those errors surface in the
  // dialog.
  const handleSendBack = useCallback(
    async (inspectionId: string, reason: string) => {
      const token = session?.token;
      if (!token) {
        throw new Error("Your session has expired.");
      }
      await requestReinspection(token, inspectionId, reason);
      await loadVisit(token, false);
    },
    [session?.token, loadVisit],
  );

  const [downloadingReport, setDownloadingReport] = useState(false);
  const handleDownloadReport = useCallback(async (part?: number) => {
    const token = session?.token;
    if (!token || !visit) return;
    setDownloadingReport(true);
    setLifecycleError("");
    try {
      await downloadCompiledReport(
        token,
        {
          id: visit.id,
          pencawangCode: visit.pencawangCode ?? undefined,
        },
        part,
      );
    } catch (downloadError) {
      if (downloadError instanceof ApiError && downloadError.status === 401) {
        handleLogout();
        return;
      }
      setLifecycleError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download the compiled report.",
      );
    } finally {
      setDownloadingReport(false);
    }
  }, [session?.token, visit, handleLogout]);

  const [downloadingDefectReport, setDownloadingDefectReport] = useState(false);
  const handleDownloadDefectReport = useCallback(async () => {
    const token = session?.token;
    if (!token || !visit) return;
    setDownloadingDefectReport(true);
    setLifecycleError("");
    try {
      await downloadDefectReport(token, {
        id: visit.id,
        pencawangCode: visit.pencawangCode ?? undefined,
      });
    } catch (downloadError) {
      if (downloadError instanceof ApiError && downloadError.status === 401) {
        handleLogout();
        return;
      }
      setLifecycleError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download the defect report.",
      );
    } finally {
      setDownloadingDefectReport(false);
    }
  }, [session?.token, visit, handleLogout]);

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

  // THIS visit's inspection per pole — what a Linked-Assets row's "send back"
  // acts on. Deliberately NOT link.asset.latestInspectionId: that is the pole's
  // globally latest submitted inspection, which for a re-surveyed pole belongs
  // to a NEWER cycle. The checklist edits get away with it because they pass
  // siteVisitId and the API refuses a cross-cycle write; request-reinspection
  // has no such guard, so it would silently send back another cycle's
  // inspection. Also covers a row that exists only because an inspection
  // references it (no link row) — those never had a latestInspectionId at all.
  //
  // ⚠ One pole can hold SEVERAL inspections in one visit (a leftover draft
  // beside the real submission — the demo data has exactly that), so this picks
  // the meaningful one rather than the first: already sent back > submitted >
  // anything else, newest within a tier.
  const visitInspectionByAssetId = useMemo(() => {
    const rank = (inspection: SiteVisitInspection) =>
      inspection.reinspectionReason
        ? 2
        : inspection.completionStatus === "SUBMITTED"
          ? 1
          : 0;
    const recency = (inspection: SiteVisitInspection) => {
      const time = new Date(
        inspection.submittedAt ?? inspection.createdAt ?? 0,
      ).getTime();
      return Number.isFinite(time) ? time : 0;
    };

    const byAssetId = new Map<string, SiteVisitInspection>();
    for (const inspection of visit?.inspections ?? []) {
      if (!inspection.assetId) {
        continue;
      }
      const current = byAssetId.get(inspection.assetId);
      if (
        !current ||
        rank(inspection) > rank(current) ||
        (rank(inspection) === rank(current) && recency(inspection) > recency(current))
      ) {
        byAssetId.set(inspection.assetId, inspection);
      }
    }
    return byAssetId;
  }, [visit?.inspections]);
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

  // The SAME NO TIANG RONDAAN pre-check the inspector runs before completing,
  // re-run here so DC can see at a glance whether the sequence is clean without
  // reading every row. Errors = must fix; warnings = gaps the inspector may have
  // confirmed (see completion notes).
  const rondaanCheck: RondaanCheckResult = useMemo(
    () =>
      checkRondaanForCompletion(
        operationalAssetRows.map(
          (link): AssetLike => ({
            id: link.assetId,
            name: link.asset.name,
            assetCode: link.asset.assetCode,
            noTiangRondaan: link.asset.assetCode,
          }),
        ),
      ),
    [operationalAssetRows],
  );

  const filteredAssetRows = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) {
      return operationalAssetRows;
    }
    return operationalAssetRows.filter((link) => {
      const type =
        link.asset.assetType?.name ?? link.asset.assetType?.code ?? "";
      return [link.asset.assetCode, link.asset.name ?? "", type].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  }, [operationalAssetRows, assetSearch]);

  const handleAssetSort = useCallback(
    (key: AssetSortKey) => {
      if (key === assetSortKey) {
        setAssetSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setAssetSortKey(key);
      // Dates read most-useful newest-first; every other column A→Z.
      setAssetSortDirection(key === "added" ? "desc" : "asc");
    },
    [assetSortKey],
  );

  const sortedAssetRows = useMemo(() => {
    const directionMultiplier = assetSortDirection === "asc" ? 1 : -1;
    return [...filteredAssetRows].sort(
      (left, right) =>
        compareAssetSortValues(
          getAssetSortValue(left, assetSortKey),
          getAssetSortValue(right, assetSortKey),
        ) * directionMultiplier,
    );
  }, [filteredAssetRows, assetSortKey, assetSortDirection]);

  // Checklist columns to actually render: the DC's selection, intersected with the
  // fields THIS visit's template exposes (a saved key from another template's
  // checklist simply doesn't appear), kept in template order.
  const activeChecklistColumns = useMemo(
    () =>
      (visit?.checklistColumns ?? []).filter((column) =>
        selectedChecklistKeys.includes(column.key),
      ),
    [visit?.checklistColumns, selectedChecklistKeys],
  );

  // Metadata (tail) columns the user has toggled on, in fixed order.
  const activeTailColumns = useMemo(
    () => LINKED_ASSET_TAIL_COLUMNS.filter(([, key]) => selectedMetaKeys.includes(key)),
    [selectedMetaKeys],
  );

  // SAVT's checklist records ONE clearance per pole (its labels carry no "1"),
  // so the pinned Kelegaan column drops the SAVR suffix on a route survey.
  const kelegaanLabel =
    visit?.surveyScope === "SAVT" ? "Bacaan Kelegaan" : "Bacaan Kelegaan 1";
  const leadColumns = useMemo<[string, AssetSortKey][]>(
    () =>
      LINKED_ASSET_LEAD_COLUMNS.map(([label, key]) =>
        key === "bacaan" ? [kelegaanLabel, key] : [label, key],
      ),
    [kelegaanLabel],
  );

  // "Show on Map" — open the Asset Map drilled into this visit's Pencawang
  // (same sessionStorage hand-off as the asset page, minus the pole panel).
  const handleShowOnMap = useCallback(() => {
    const substation = visit?.substation;
    if (!substation?.id) {
      return;
    }
    focusPencawangOnMap({
      pencawangId: substation.id,
      pencawangName: substation.name || visit?.pencawangName || "Pencawang",
    });
    router.push("/map");
  }, [visit?.substation, visit?.pencawangName, router]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <button
            type="button"
            onClick={() => router.push("/site-visits")}
            className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
          >
            <ArrowLeft size={16} />
            Site Visits
          </button>

          <div className="mt-4">
            <PageHeader
              eyebrow="Operations Detail"
              title={visit ? displayPencawang(visit) : "Site Visit"}
              chips={
                <>
                  <Chip tone="neutral">
                    <ShieldCheck size={13} />
                    {isReadOnly ? "Read-only" : "Full access"}
                  </Chip>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--panel)] px-[9px] py-[3px] text-[11px] font-semibold leading-tight text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)]">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(event) => setAutoRefresh(event.target.checked)}
                      className="h-3 w-3 rounded border-[var(--line-strong)] accent-[var(--brand)]"
                    />
                    Auto-refresh 60s
                  </label>
                  {visit ? (
                    <Chip tone="neutral">{SURVEY_SCOPE_LABELS[visit.surveyScope]}</Chip>
                  ) : null}
                  {visit ? <HealthBadge status={visit.operationalHealthStatus} /> : null}
                  {visit ? <StatusBadge status={visit.status} /> : null}
                  {visit ? <ValidationBadge status={visit.validationStatus} /> : null}
                </>
              }
              actions={
                <>
                  {visit?.substation?.id ? (
                    <Tbtn
                      onClick={handleShowOnMap}
                      title="Open the Asset Map drilled into this Pencawang"
                    >
                      <MapIcon size={16} />
                      Show on Map
                    </Tbtn>
                  ) : null}
                  <Tbtn
                    onClick={() =>
                      session?.token ? loadVisit(session.token, false) : undefined
                    }
                    disabled={(isLoading && !visit) || isRefreshing || !session?.token}
                  >
                    <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                    Refresh
                  </Tbtn>
                </>
              }
            />
          </div>

          <div className="mt-6">
            {isLoading && !visit ? (
              <Card>
                <div className="h-8 w-72 animate-pulse rounded-[var(--radius-control)] bg-[var(--panel-muted)]" />
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-[var(--radius-control)] bg-[var(--panel-muted)]" />
                  ))}
                </div>
              </Card>
            ) : error && !visit ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : visit ? (
              <div className="space-y-6">
                {error ? (
                  <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
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
                  canReviewSurvey={canReviewSurvey}
                  canGovern={canGovern}
                  canReport={canReport}
                  pendingAction={pendingAction}
                  error={lifecycleError}
                  reportRun={reportStatus?.run ?? null}
                  reportVolumes={reportStatus?.volumes ?? []}
                  onRondaanSelesai={handleRondaanSelesai}
                  onManagerApprove={handleManagerApprove}
                  onManagerRequestAmendment={handleManagerRequestAmendment}
                  onRequestAmendment={handleRequestAmendment}
                  downloadingReport={downloadingReport}
                  downloadingDefectReport={downloadingDefectReport}
                  onGenerateReport={handleGenerateReport}
                  onArchive={handleArchive}
                  onDownloadReport={handleDownloadReport}
                  onDownloadDefectReport={handleDownloadDefectReport}
                  onOpenNextCycle={handleOpenNextCycle}
                />

                <ReassignTeamPanel
                  visit={visit}
                  token={session?.token ?? null}
                  canReassign={canReassign}
                  allowCrossCompany={isAdmin}
                  onReassigned={(next) => {
                    setVisit(next);
                    if (session?.token) {
                      void loadContributions(session.token);
                    }
                  }}
                />

                {contributions &&
                (contributions.reassignments.length > 0 ||
                  contributions.teams.some((team) => team.snapshots.length > 0)) ? (
                  <ContributionsPanel contributions={contributions} />
                ) : null}

                {cycleDelta ? <CycleDeltaPanel delta={cycleDelta} /> : null}

                <div className="grid gap-6">
                  {/* min-w-0: a grid item's default min-width:auto refuses to
                      shrink below the Linked-Assets table's content width —
                      the card then balloons past the page instead of letting
                      the table's own overflow-x scroller engage. */}
                  <div className="min-w-0 space-y-6">
                    <ProgressPanel visit={visit} />

                    <Card>
                      <CardHead
                        title={
                          <span className="inline-flex items-center gap-2">
                            <Activity size={16} className="text-[var(--brand)]" />
                            Operational Metadata
                          </span>
                        }
                      />
                      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        <MainheadDetailField visit={visit} />
                        <DetailField
                          label="Survey Scope"
                          value={SURVEY_SCOPE_LABELS[visit.surveyScope]}
                        />
                        {/* A standalone equipment survey has no Pencawang —
                            hide the three fields instead of "Not recorded" x3. */}
                        {STANDALONE_SURVEY_SCOPES.has(visit.surveyScope) ? null : (
                          <>
                            <DetailField label="Pencawang Code" value={formatNullable(visit.pencawangCode)} />
                            <DetailField label="Pencawang Name" value={formatNullable(visit.pencawangName)} />
                            <DetailField label="Functional Location" value={formatNullable(visit.functionalLocation)} />
                          </>
                        )}
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
                    </Card>

                    <Card>
                      <CardHead
                        title={
                          <span className="inline-flex items-center gap-2">
                            <Users size={16} className="text-[var(--brand)]" />
                            Team Members
                          </span>
                        }
                        actions={
                          <span className="text-[12px] text-[var(--muted)]">
                            {visit.teamMembers.length} active on visit
                          </span>
                        }
                      />
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {visit.teamMembers.length > 0 ? (
                          visit.teamMembers.map((member) => (
                            <div key={`${member.id}-${member.siteVisitUserId ?? ""}`} className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-4">
                              <p className="text-sm font-semibold text-[var(--foreground)]">
                                {member.name || member.email || "Team member"}
                              </p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                {formatNullable(member.role)} / Joined {formatDateTime(member.joinedAt)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line-strong)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted)] md:col-span-2">
                            No team members returned for this visit.
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card>
                      <CardHead
                        title={
                          <span className="inline-flex items-center gap-2">
                            <Activity size={16} className="text-[var(--brand)]" />
                            Linked Assets
                          </span>
                        }
                        actions={
                          <div className="flex items-center gap-3">
                            <ChecklistColumnPicker
                              columns={visit.checklistColumns ?? []}
                              selectedKeys={selectedChecklistKeys}
                              onChange={persistChecklistKeys}
                              metaColumns={LINKED_ASSET_TAIL_COLUMNS.map(
                                ([label, key]) => ({ key, label }),
                              )}
                              selectedMetaKeys={selectedMetaKeys}
                              onMetaChange={persistMetaKeys}
                            />
                            <span className="whitespace-nowrap text-[12px] text-[var(--muted)]">
                              {filteredAssetRows.length === operationalAssetRows.length
                                ? `${operationalAssetRows.length} rows`
                                : `${filteredAssetRows.length} / ${operationalAssetRows.length} rows`}
                            </span>
                          </div>
                        }
                      />

                      {/* NO TIANG RONDAAN is pole-grammar territory — a
                          standalone equipment survey's PC/FP/LB/CB refCodes
                          are not pole codes, so the badge would only shout
                          false errors there. */}
                      {operationalAssetRows.length > 0 &&
                      !STANDALONE_SURVEY_SCOPES.has(visit.surveyScope) ? (
                        rondaanCheck.ok ? (
                          <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-[13px] text-[var(--success-text)]">
                            <CheckCircle2 size={15} className="shrink-0" />
                            NO TIANG RONDAAN sequence looks correct.
                          </div>
                        ) : (
                          <div
                            className={`mt-4 rounded-[var(--radius-control)] border px-3 py-2.5 text-[13px] ${
                              rondaanCheck.hasErrors
                                ? "border-[var(--critical-border)] bg-[var(--critical-bg)] text-[var(--critical-text)]"
                                : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
                            }`}
                          >
                            <div className="flex items-center gap-2 font-semibold">
                              <AlertTriangle size={15} className="shrink-0" />
                              {rondaanCheck.hasErrors
                                ? `${rondaanCheck.errors.length} NO TIANG RONDAAN error${
                                    rondaanCheck.errors.length === 1 ? "" : "s"
                                  } to fix`
                                : `${rondaanCheck.warnings.length} NO TIANG RONDAAN gap${
                                    rondaanCheck.warnings.length === 1 ? "" : "s"
                                  } to confirm`}
                              {rondaanCheck.hasErrors && rondaanCheck.warnings.length > 0
                                ? ` · ${rondaanCheck.warnings.length} gap${
                                    rondaanCheck.warnings.length === 1 ? "" : "s"
                                  }`
                                : ""}
                            </div>
                            <ul className="mt-1.5 max-h-40 list-disc space-y-1 overflow-y-auto pl-6 pr-1 text-[12.5px]">
                              {rondaanCheck.issues.map((issue, index) => (
                                <li key={index}>{issue.message}</li>
                              ))}
                            </ul>
                          </div>
                        )
                      ) : null}

                      {operationalAssetRows.length > 0 ? (
                        <label className="relative mt-4 block">
                          <span className="sr-only">Search linked assets</span>
                          <Search
                            size={15}
                            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
                          />
                          <input
                            type="search"
                            value={assetSearch}
                            onChange={(event) => setAssetSearch(event.target.value)}
                            placeholder="Search by code, name or type"
                            className={`${filterControlClass} w-full pl-9`}
                          />
                        </label>
                      ) : null}

                      <div className="mt-4 max-h-[28rem] overflow-x-auto overflow-y-auto">
                        {operationalAssetRows.length === 0 ? (
                          <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line-strong)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No linked assets returned for this visit.
                          </div>
                        ) : filteredAssetRows.length === 0 ? (
                          <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line-strong)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                            No assets match your search.
                          </div>
                        ) : (
                          <table className="min-w-full text-left">
                            <thead>
                              <tr className={`sticky top-0 z-10 border-y border-[var(--line)] ${tableHeadClass}`}>
                                {leadColumns.map(([label, key]) => (
                                  <th key={key} className={tableHeadCellClass}>
                                    <SortButton
                                      label={label}
                                      sortKey={key}
                                      activeSortKey={assetSortKey}
                                      direction={assetSortDirection}
                                      onSort={handleAssetSort}
                                    />
                                  </th>
                                ))}
                                {activeChecklistColumns.map((column) => (
                                  <th
                                    key={`${CHECKLIST_SORT_PREFIX}${column.key}`}
                                    className={tableHeadCellClass}
                                  >
                                    <SortButton
                                      label={column.label}
                                      sortKey={`${CHECKLIST_SORT_PREFIX}${column.key}`}
                                      activeSortKey={assetSortKey}
                                      direction={assetSortDirection}
                                      onSort={handleAssetSort}
                                    />
                                  </th>
                                ))}
                                {activeTailColumns.map(([label, key]) => (
                                  <th key={key} className={tableHeadCellClass}>
                                    <SortButton
                                      label={label}
                                      sortKey={key}
                                      activeSortKey={assetSortKey}
                                      direction={assetSortDirection}
                                      onSort={handleAssetSort}
                                    />
                                  </th>
                                ))}
                                {/* Per-pole send-back action — only for someone
                                    who may govern the data. */}
                                {canEditLinkedAssets ? (
                                  <th className={`${tableHeadCellClass} whitespace-nowrap`}>
                                    Re-inspect
                                  </th>
                                ) : null}
                              </tr>
                            </thead>
                            <tbody>
                              {sortedAssetRows.map((link) => {
                                // Carry a return path so Asset Detail's back
                                // button comes back here, not to the Assets list.
                                const assetHref = `/assets/${link.assetId}?from=${encodeURIComponent(
                                  `/site-visits/${siteVisitId}`,
                                )}`;
                                const openLinkedAsset = () => {
                                  // Stash the table's current order so the
                                  // detail page can step Prev/Next through
                                  // this visit's poles.
                                  storeAssetNavContext(
                                    sortedAssetRows.map((row) => row.assetId),
                                    `/site-visits/${siteVisitId}`,
                                    link.assetId,
                                  );
                                  router.push(assetHref);
                                };
                                const rowInspection =
                                  visitInspectionByAssetId.get(link.assetId) ?? null;
                                return (
                                <tr
                                  key={link.id}
                                  tabIndex={0}
                                  onClick={openLinkedAsset}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      openLinkedAsset();
                                    }
                                  }}
                                  className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--brand-tint)]`}
                                  aria-label={`Open asset ${link.asset.assetCode}`}
                                >
                                  <td className={`${tableMonoCellClass} font-semibold text-[var(--foreground)]`}>
                                    <EditableCell
                                      value={link.asset.assetCode}
                                      canEdit={canEditLinkedAssets}
                                      mono
                                      ariaLabel={`NO TIANG RONDAAN for ${link.asset.assetCode}`}
                                      onSave={async (next) => {
                                        const token = session?.token;
                                        if (!token) {
                                          throw new Error("Your session has expired.");
                                        }
                                        const canonical = normalizePoleInput(next);
                                        if (!canonical) {
                                          throw new Error("NO TIANG RONDAAN is required.");
                                        }
                                        await updateAssetCode(token, link.assetId, canonical);
                                        await loadVisit(token, false);
                                      }}
                                    />
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatNullable(link.asset.noTiangLama ?? link.asset.name)}
                                  </td>
                                  <td className={tableCellClass}>
                                    <EditableCell
                                      value={link.checklist?.bacaanKelegaan1 ?? null}
                                      canEdit={
                                        canEditLinkedAssets &&
                                        Boolean(link.asset.latestInspectionId)
                                      }
                                      inputMode="decimal"
                                      placeholder="e.g. 5.69"
                                      ariaLabel={`${kelegaanLabel} for ${link.asset.assetCode}`}
                                      onSave={async (next) => {
                                        const token = session?.token;
                                        const inspectionId = link.asset.latestInspectionId;
                                        if (!token) {
                                          throw new Error("Your session has expired.");
                                        }
                                        if (!inspectionId) {
                                          throw new Error(
                                            "No submitted inspection to correct.",
                                          );
                                        }
                                        await correctKelegaanReading(
                                          token,
                                          inspectionId,
                                          next,
                                          siteVisitId,
                                        );
                                        await loadVisit(token, false);
                                      }}
                                    />
                                  </td>
                                  <td className={tableCellClass}>
                                    <SensorPhotoCell
                                      photo={link.checklist?.bacaanKelegaan1Image ?? null}
                                      reading={link.checklist?.bacaanKelegaan1 ?? null}
                                      poleCode={link.asset.assetCode}
                                      onOpen={setSensorPhotoView}
                                    />
                                  </td>
                                  <td className={`${tableCellClass} min-w-48`}>
                                    {formatNullable(link.checklist?.catitan)}
                                  </td>
                                  {activeChecklistColumns.map((column) => {
                                    // Number-ish items get the decimal keypad; every
                                    // other non-IMAGE, non-option type edits as free
                                    // text (the server coerces to the item's type).
                                    const decimalInput =
                                      column.inputType === "NUMBER" ||
                                      column.inputType === "READING" ||
                                      column.inputType === "OCR";
                                    const canEditCell =
                                      canEditLinkedAssets &&
                                      Boolean(link.asset.latestInspectionId);
                                    const cellValue =
                                      link.checklistValues?.[column.key] ?? null;
                                    const cellAriaLabel = `${column.label} for ${link.asset.assetCode}`;
                                    // An IMAGE column renders the pole's item-tagged
                                    // photo, READ-ONLY (capture happens on mobile) —
                                    // resolved via any of the column's item ids.
                                    const checklistPhoto =
                                      column.inputType === "IMAGE"
                                        ? ((column.templateItemIds ?? [])
                                            .map((id) => link.checklistImages?.[id])
                                            .find((photo) => Boolean(photo)) ?? null)
                                        : null;
                                    const saveCell = async (next: string) => {
                                      const token = session?.token;
                                      const inspectionId = link.asset.latestInspectionId;
                                      if (!token) {
                                        throw new Error("Your session has expired.");
                                      }
                                      if (!inspectionId) {
                                        throw new Error("No submitted inspection to edit.");
                                      }
                                      await editChecklistValue(
                                        token,
                                        inspectionId,
                                        column.key,
                                        next,
                                        siteVisitId,
                                      );
                                      await loadVisit(token, false);
                                    };
                                    return (
                                      <td
                                        key={`${CHECKLIST_SORT_PREFIX}${column.key}`}
                                        className={`${tableCellClass} min-w-32`}
                                      >
                                        {column.inputType === "IMAGE" ? (
                                          <SensorPhotoCell
                                            photo={checklistPhoto}
                                            reading={null}
                                            poleCode={link.asset.assetCode}
                                            label={column.label}
                                            onOpen={setSensorPhotoView}
                                          />
                                        ) : column.options && column.options.length > 0 ? (
                                          <ChecklistSelectCell
                                            value={cellValue}
                                            options={column.options}
                                            canEdit={canEditCell}
                                            ariaLabel={cellAriaLabel}
                                            onSave={saveCell}
                                          />
                                        ) : (
                                          <EditableCell
                                            value={cellValue}
                                            canEdit={canEditCell}
                                            inputMode={decimalInput ? "decimal" : "text"}
                                            ariaLabel={cellAriaLabel}
                                            onSave={saveCell}
                                          />
                                        )}
                                      </td>
                                    );
                                  })}
                                  {selectedMetaKeys.includes("type") ? (
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {formatNullable(link.asset.assetType?.name ?? link.asset.assetType?.code)}
                                    </td>
                                  ) : null}
                                  {selectedMetaKeys.includes("source") ? (
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {formatNullable(link.source)}
                                    </td>
                                  ) : null}
                                  {selectedMetaKeys.includes("added") ? (
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {formatDateTime(link.addedAt)}
                                    </td>
                                  ) : null}
                                  {/* Send this pole back for re-inspection —
                                      the same action the Asset Map panel
                                      offers, on the row the DC is reading. Only
                                      on a pole that is actually submitted, and
                                      never twice (the flag clears when the crew
                                      re-submits). */}
                                  {canEditLinkedAssets ? (
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {rowInspection?.reinspectionReason ? (
                                        <span
                                          title={`Sent back: ${rowInspection.reinspectionReason}`}
                                          className="inline-flex items-center gap-1 rounded-full border border-[var(--medium-border)] bg-[var(--medium-bg)] px-2 py-[3px] text-[11px] font-semibold text-[var(--medium-text)]"
                                        >
                                          <RotateCcw size={12} />
                                          Sent back
                                        </span>
                                      ) : rowInspection?.completionStatus === "SUBMITTED" ? (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSendBackTarget({
                                              inspectionId: rowInspection.id,
                                              assetCode: link.asset.assetCode,
                                            });
                                          }}
                                          onKeyDown={(event) => event.stopPropagation()}
                                          title="Send this pole back for re-inspection — the recorded data is kept"
                                          aria-label={`Send ${link.asset.assetCode} back for re-inspection`}
                                          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line)] px-2 py-[3px] text-[11px] font-semibold text-[var(--foreground-soft)] outline-none transition hover:border-[var(--medium-border)] hover:text-[var(--medium-text)] focus-visible:ring-1 focus-visible:ring-[var(--brand)]"
                                        >
                                          <RotateCcw size={12} />
                                          Send back
                                        </button>
                                      ) : (
                                        <span className="text-[var(--muted-2)]">—</span>
                                      )}
                                    </td>
                                  ) : null}
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </Card>

                    <Card>
                      <button
                        type="button"
                        onClick={() => setInspectionsExpanded((open) => !open)}
                        aria-expanded={inspectionsExpanded}
                        className="flex w-full items-center justify-between gap-4 text-left"
                      >
                        <span
                          className="inline-flex items-center gap-2 text-[14.5px] font-semibold text-[var(--foreground)]"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          <ChevronRight
                            size={16}
                            className={`shrink-0 text-[var(--muted-2)] transition-transform ${
                              inspectionsExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <CalendarDays size={16} className="text-[var(--brand)]" />
                          Inspections
                        </span>
                        <span className="shrink-0 text-[12px] text-[var(--muted)]">
                          {submittedInspections.length}/{visit.inspections.length} submitted
                        </span>
                      </button>
                      {inspectionsExpanded ? (
                        <div className="mt-5 overflow-x-auto">
                          {visit.inspections.length > 0 ? (
                            <table className="min-w-full text-left">
                              <thead>
                                <tr className={`border-y border-[var(--line)] ${tableHeadClass}`}>
                                  <th className={tableHeadCellClass}>Asset</th>
                                  <th className={tableHeadCellClass}>Template</th>
                                  <th className={tableHeadCellClass}>Cycle</th>
                                  <th className={tableHeadCellClass}>Status</th>
                                  <th className={tableHeadCellClass}>Defects</th>
                                  <th className={tableHeadCellClass}>Images</th>
                                  <th className={tableHeadCellClass}>Submitted</th>
                                </tr>
                              </thead>
                              <tbody>
                                {visit.inspections.map((inspection) => (
                                  <tr key={inspection.id} className={`${tableRowClass} last:border-b-0`}>
                                    <td className={`${tableMonoCellClass} whitespace-nowrap font-semibold text-[var(--foreground)]`}>
                                      {inspection.assetCode}
                                    </td>
                                    <td className={`${tableCellClass} min-w-56`}>
                                      {formatNullable(inspection.templateName)}
                                      {inspection.templateVersion ? (
                                        <span className="ml-2 text-xs text-[var(--muted)]">
                                          v{inspection.templateVersion}
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {inspection.cycleNumber ?? "N/A"}
                                    </td>
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {formatEnum(inspection.completionStatus)}
                                    </td>
                                    <td className={`${tableCellClass} whitespace-nowrap font-semibold text-[var(--foreground)]`}>
                                      {inspection.defectCount}
                                    </td>
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {inspection.imageCount}
                                    </td>
                                    <td className={`${tableCellClass} whitespace-nowrap`}>
                                      {formatDateTime(inspection.submittedAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--line-strong)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                              No inspections returned for this visit.
                            </div>
                          )}
                        </div>
                      ) : null}
                    </Card>

                    <Card>
                      <CardHead
                        title={
                          <span className="inline-flex items-center gap-2">
                            <Clock3 size={16} className="text-[var(--brand)]" />
                            Timestamps & Notes
                          </span>
                        }
                      />
                      <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        <DetailField label="Started" value={formatDateTime(visit.startedAt)} />
                        <DetailField label="Completed" value={formatDateTime(visit.completedAt)} />
                        <DetailField label="Ended" value={formatDateTime(visit.endedAt)} />
                        <DetailField label="Validated" value={formatDateTime(visit.validatedAt)} />
                        <DetailField label="Validation Summary" value={formatNullable(visit.validationSummary)} />
                        <DetailField label="Completion Notes" value={formatNullable(visit.completionNotes)} />
                        <DetailField label="Visit Notes" value={formatNullable(visit.notes)} />
                        <DetailField label="Cancel Reason" value={formatNullable(visit.cancelReason)} />
                      </dl>
                    </Card>
                  </div>
                </div>

                {canDeleteSurvey ? (
                  <DeleteSurveyPanel
                    visit={visit}
                    token={session?.token ?? null}
                    onDeleted={() => router.push("/site-visits")}
                    onUnauthorized={handleLogout}
                  />
                ) : null}
              </div>
            ) : (
              <Card padded={false} className="p-8 text-center text-sm text-[var(--muted)]">
                Site visit not found.
              </Card>
            )}
          </div>
        </div>
      </main>
      {sensorPhotoView ? (
        <SensorPhotoLightbox view={sensorPhotoView} onClose={closeSensorPhoto} />
      ) : null}
      {sendBackTarget ? (
        <SendBackDialog
          target={sendBackTarget}
          onClose={closeSendBack}
          onSubmit={handleSendBack}
        />
      ) : null}
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
