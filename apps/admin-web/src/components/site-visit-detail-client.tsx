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
  CheckCircle2,
  ChevronRight,
  ChevronsUpDown,
  Clock3,
  Download,
  ImageOff,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
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
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import {
  archiveSurvey,
  deleteSiteVisit,
  fetchCycleDelta,
  fetchSiteVisitContributions,
  fetchSiteVisitDetail,
  fetchSurveyDeletePreview,
  generateSurveyReport,
  managerApproveSurvey,
  managerRequestAmendment,
  markRondaanSelesai,
  openNextCycle,
  reassignSiteVisit,
  requestSurveyAmendment,
  type SurveyDeletePreview,
} from "@/lib/site-visits";
import { downloadCompiledReport } from "@/lib/report-templates";
import { getImageSourceUrl } from "@/components/inspection-evidence-grid";
import {
  checkRondaanForCompletion,
  type AssetLike,
  type RondaanCheckResult,
} from "@ascure/shared-utils";
import { fetchTeams, type TeamOption } from "@/lib/teams";
import type { AuthSession } from "@/types/auth";
import type {
  CycleDelta,
  CycleDeltaPole,
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitContributions,
  SiteVisitDetail,
  SiteVisitSensorPhoto,
  SiteVisitStatus,
  SiteVisitValidationStatus,
  SurveyDueStatus,
  SurveyLifecycleStatus,
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
  onRondaanSelesai: () => void;
  onManagerApprove: () => void;
  onManagerRequestAmendment: (remark: string) => void;
  onRequestAmendment: (remark: string) => void;
  onGenerateReport: () => void;
  onArchive: () => void;
  onDownloadReport: () => void;
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
  onRondaanSelesai,
  onManagerApprove,
  onManagerRequestAmendment,
  onRequestAmendment,
  onGenerateReport,
  onArchive,
  onDownloadReport,
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
          {canReport ? (
            <Tbtn
              variant="secondary"
              onClick={onDownloadReport}
              disabled={isBusy || downloadingReport}
            >
              {downloadingReport ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Download compiled report
            </Tbtn>
          ) : null}
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
            <Tbtn variant="primary" onClick={onGenerateReport} disabled={isBusy}>
              {pendingAction === "generate-report" ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              Generate report (Laporan Selesai)
            </Tbtn>
          ) : null}

          {status === "LAPORAN_SELESAI" && canReport ? (
            <Tbtn
              variant="secondary"
              onClick={onDownloadReport}
              disabled={isBusy || downloadingReport}
            >
              {downloadingReport ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Download compiled report
            </Tbtn>
          ) : null}

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
            {options.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name?.trim() || team.code?.trim() || team.id}
              </option>
            ))}
          </select>

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
        aria-label={`Smart Sensor photo for ${view.poleCode}`}
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
              Recorded Bacaan Kelegaan 1:{" "}
              <span className="font-semibold text-[var(--foreground-soft)]">
                {view.reading ?? "Not recorded"}
              </span>{" "}
              — compare against the LCD in the photo.
            </p>
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
              alt={view.photo.filename ?? `Smart Sensor photo for ${view.poleCode}`}
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

type AssetSortKey =
  | "rondaan"
  | "lama"
  | "bacaan"
  | "gambar"
  | "catitan"
  | "type"
  | "source"
  | "added";
type AssetSortDirection = "asc" | "desc";

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
}: {
  photo: SiteVisitSensorPhoto | null;
  reading: string | null;
  poleCode: string;
  onOpen: (view: SensorPhotoView) => void;
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
        title="Sensor photo unavailable"
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
        onOpen({ photo, reading, poleCode });
      }}
      onKeyDown={(event) => {
        // Keep Enter/Space from bubbling to the row (which navigates to the
        // asset); let every other key (Escape, Tab, …) pass through.
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
        }
      }}
      aria-label={`View Smart Sensor photo for ${poleCode}`}
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
  const [assetSortKey, setAssetSortKey] = useState<AssetSortKey>("rondaan");
  const [assetSortDirection, setAssetSortDirection] =
    useState<AssetSortDirection>("asc");

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

  const [downloadingReport, setDownloadingReport] = useState(false);
  const handleDownloadReport = useCallback(async () => {
    const token = session?.token;
    if (!token || !visit) return;
    setDownloadingReport(true);
    setLifecycleError("");
    try {
      await downloadCompiledReport(token, {
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
          : "Unable to download the compiled report.",
      );
    } finally {
      setDownloadingReport(false);
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
                  {visit ? <HealthBadge status={visit.operationalHealthStatus} /> : null}
                  {visit ? <StatusBadge status={visit.status} /> : null}
                  {visit ? <ValidationBadge status={visit.validationStatus} /> : null}
                </>
              }
              actions={
                <Tbtn
                  onClick={() =>
                    session?.token ? loadVisit(session.token, false) : undefined
                  }
                  disabled={(isLoading && !visit) || isRefreshing || !session?.token}
                >
                  <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
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
                  onRondaanSelesai={handleRondaanSelesai}
                  onManagerApprove={handleManagerApprove}
                  onManagerRequestAmendment={handleManagerRequestAmendment}
                  onRequestAmendment={handleRequestAmendment}
                  downloadingReport={downloadingReport}
                  onGenerateReport={handleGenerateReport}
                  onArchive={handleArchive}
                  onDownloadReport={handleDownloadReport}
                  onOpenNextCycle={handleOpenNextCycle}
                />

                <ReassignTeamPanel
                  visit={visit}
                  token={session?.token ?? null}
                  canReassign={canReassign}
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
                  <div className="space-y-6">
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
                          <span className="text-[12px] text-[var(--muted)]">
                            {filteredAssetRows.length === operationalAssetRows.length
                              ? `${operationalAssetRows.length} rows`
                              : `${filteredAssetRows.length} / ${operationalAssetRows.length} rows`}
                          </span>
                        }
                      />

                      {operationalAssetRows.length > 0 ? (
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
                            <ul className="mt-1.5 list-disc space-y-1 pl-6 text-[12.5px]">
                              {rondaanCheck.issues.slice(0, 15).map((issue, index) => (
                                <li key={index}>{issue.message}</li>
                              ))}
                              {rondaanCheck.issues.length > 15 ? (
                                <li className="list-none opacity-80">
                                  +{rondaanCheck.issues.length - 15} more…
                                </li>
                              ) : null}
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
                                {(
                                  [
                                    ["No Tiang Rondaan", "rondaan"],
                                    ["No Tiang Lama", "lama"],
                                    ["Bacaan Kelegaan 1", "bacaan"],
                                    ["Gambar Kelegaan", "gambar"],
                                    ["Catitan", "catitan"],
                                    ["Type", "type"],
                                    ["Source", "source"],
                                    ["Added", "added"],
                                  ] as [string, AssetSortKey][]
                                ).map(([label, key]) => (
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
                              </tr>
                            </thead>
                            <tbody>
                              {sortedAssetRows.map((link) => {
                                // Carry a return path so Asset Detail's back
                                // button comes back here, not to the Assets list.
                                const assetHref = `/assets/${link.assetId}?from=${encodeURIComponent(
                                  `/site-visits/${siteVisitId}`,
                                )}`;
                                return (
                                <tr
                                  key={link.id}
                                  tabIndex={0}
                                  onClick={() => router.push(assetHref)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      router.push(assetHref);
                                    }
                                  }}
                                  className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--brand-tint)]`}
                                  aria-label={`Open asset ${link.asset.assetCode}`}
                                >
                                  <td className={`${tableMonoCellClass} whitespace-nowrap font-semibold text-[var(--foreground)]`}>
                                    {link.asset.assetCode}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatNullable(link.asset.noTiangLama ?? link.asset.name)}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatNullable(link.checklist?.bacaanKelegaan1)}
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
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatNullable(link.asset.assetType?.name ?? link.asset.assetType?.code)}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatNullable(link.source)}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatDateTime(link.addedAt)}
                                  </td>
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
