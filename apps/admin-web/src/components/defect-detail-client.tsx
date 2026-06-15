"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertTriangle,
  Ban,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { API_ORIGIN, ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession, refreshStoredSessionUser } from "@/lib/auth";
import {
  addDefectComment,
  completeDefectMaintenance,
  fetchDefectDetail,
  rejectDefect,
  updateDefectAssignment,
  updateDefectDueDate,
  updateDefectStatus,
  verifyDefect,
  verifyDefectClosure,
} from "@/lib/defects";
import { fetchTeams, fetchUsers } from "@/lib/users";
import type { AuthSession } from "@/types/auth";
import {
  DEFECT_WORKFLOW_STATUSES,
  type DefectDetail,
  type DefectEvidenceImage,
  type DefectLifecycleStatus,
  type DefectResolutionOutcome,
  type DefectSeverity,
  type DefectStatus,
  type DefectTimelineEntry,
  type DefectWorkflowStatus,
} from "@/types/defects";
import type { ManagedTeam, ManagedUser } from "@/types/users";

const statusOptions: Array<{ label: string; value: DefectWorkflowStatus }> = [
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Monitoring", value: "MONITORING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];
const MAINTENANCE_RESOLUTION_OUTCOMES = [
  "RESOLVED",
  "TEMPORARY_FIX",
  "MONITORING_REQUIRED",
  "EXTERNAL_CONSTRAINT",
  "DEFERRED",
] as const satisfies ReadonlyArray<Exclude<DefectResolutionOutcome, "UNKNOWN">>;
const resolutionOutcomeOptions: Array<{
  label: string;
  value: Exclude<DefectResolutionOutcome, "UNKNOWN">;
}> = MAINTENANCE_RESOLUTION_OUTCOMES.map((outcome) => ({
  label: formatEnumLabel(outcome),
  value: outcome,
}));
const exceptionResolutionOutcomes = new Set<DefectResolutionOutcome>([
  "EXTERNAL_CONSTRAINT",
  "DEFERRED",
  "TEMPORARY_FIX",
  "MONITORING_REQUIRED",
  "FALSE_POSITIVE",
  "DUPLICATE",
]);

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

function formatEnumLabel(value: string | null | undefined) {
  if (!value || value === "UNKNOWN") {
    return "Not recorded";
  }

  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getDisplayLifecycleStatus(
  status: DefectLifecycleStatus | null | undefined,
): Exclude<DefectLifecycleStatus, "UNKNOWN"> {
  return !status || status === "UNKNOWN" ? "DETECTED" : status;
}

function formatLifecycleStatus(status: DefectLifecycleStatus | null | undefined) {
  return formatEnumLabel(getDisplayLifecycleStatus(status));
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

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "Not set";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function toDateInputValue(date: string | null | undefined) {
  if (!date) {
    return "";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toISOString().slice(0, 10);
}

function formatSlaState(state: DefectDetail["slaState"]) {
  if (!state || state === "UNKNOWN") {
    return "Unknown";
  }

  return state
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAssignee(defect: DefectDetail) {
  return defect.assignedTo?.trim() || "Unassigned";
}

function formatNullable(value: string | null | undefined) {
  return value?.trim() || "Not recorded";
}

function isExceptionResolutionOutcome(
  outcome: DefectResolutionOutcome | null | undefined,
) {
  return Boolean(outcome && exceptionResolutionOutcomes.has(outcome));
}

function isGovernanceException(defect: DefectDetail) {
  return (
    getDisplayLifecycleStatus(defect.lifecycleStatus) === "REJECTED" ||
    isExceptionResolutionOutcome(defect.resolutionOutcome)
  );
}

function getExceptionNotes(defect: DefectDetail) {
  if (getDisplayLifecycleStatus(defect.lifecycleStatus) === "REJECTED") {
    return defect.verificationNotes ?? defect.verificationRemarks ?? defect.actionRemark;
  }

  if (!isExceptionResolutionOutcome(defect.resolutionOutcome)) {
    return null;
  }

  if (
    defect.resolutionOutcome === "FALSE_POSITIVE" ||
    defect.resolutionOutcome === "DUPLICATE"
  ) {
    return defect.verificationNotes ?? defect.verificationRemarks ?? defect.actionRemark;
  }

  return (
    defect.maintenanceNotes ??
    defect.closureVerificationNotes ??
    defect.closureRemarks ??
    defect.actionRemark
  );
}

function getResolutionGovernanceHelper(defect: DefectDetail) {
  const lifecycleStatus = getDisplayLifecycleStatus(defect.lifecycleStatus);

  if (lifecycleStatus === "REJECTED") {
    return "Rejected QA/QC decisions are retained with notes, actor, and timestamp for audit.";
  }

  if (defect.resolutionOutcome === "EXTERNAL_CONSTRAINT") {
    return "External constraints are tracked as operational exceptions, not deleted or failed defects.";
  }

  if (isExceptionResolutionOutcome(defect.resolutionOutcome)) {
    return "Outcome exceptions remain visible while the lifecycle status stays globally standardized.";
  }

  return "Resolution outcome is recorded separately from lifecycle status for closure traceability.";
}

function isWorkflowStatus(status: DefectStatus): status is DefectWorkflowStatus {
  return DEFECT_WORKFLOW_STATUSES.includes(status as DefectWorkflowStatus);
}

function isMaintenanceResolutionOutcome(
  outcome: DefectResolutionOutcome | null | undefined,
): outcome is (typeof MAINTENANCE_RESOLUTION_OUTCOMES)[number] {
  return MAINTENANCE_RESOLUTION_OUTCOMES.includes(
    outcome as (typeof MAINTENANCE_RESOLUTION_OUTCOMES)[number],
  );
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

function LifecycleBadge({ status }: { status: DefectLifecycleStatus | null | undefined }) {
  const displayStatus = getDisplayLifecycleStatus(status);
  const className =
    displayStatus === "VERIFIED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : displayStatus === "REJECTED"
        ? "border-red-200 bg-red-50 text-red-700"
        : displayStatus === "CLOSED"
          ? "border-green-200 bg-green-50 text-green-700"
          : displayStatus === "COMPLETED" || displayStatus === "VERIFICATION_PENDING"
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : displayStatus === "ASSIGNED" || displayStatus === "IN_PROGRESS"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : displayStatus === "UNDER_REVIEW"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatLifecycleStatus(displayStatus)}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: DefectResolutionOutcome | null | undefined }) {
  if (!outcome || outcome === "UNKNOWN") {
    return null;
  }

  const className =
    outcome === "RESOLVED" || outcome === "REPAIRED"
      ? "border-green-200 bg-green-50 text-green-700"
      : outcome === "EXTERNAL_CONSTRAINT" || outcome === "ESCALATED"
        ? "border-orange-200 bg-orange-50 text-orange-700"
        : outcome === "TEMPORARY_FIX" ||
            outcome === "MONITORING_REQUIRED" ||
            outcome === "PARTIAL" ||
            outcome === "DEFERRED" ||
            outcome === "MONITOR_ONLY"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : outcome === "DUPLICATE" || outcome === "FALSE_POSITIVE"
            ? "border-slate-200 bg-slate-50 text-slate-700"
            : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {formatEnumLabel(outcome)}
    </span>
  );
}

function SlaBadge({ defect }: { defect: DefectDetail }) {
  const className = defect.isOverdue
    ? "border-red-200 bg-red-50 text-red-700"
    : defect.slaState === "ON_TRACK"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : defect.slaState === "STOPPED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {defect.isOverdue ? <AlertTriangle size={13} /> : null}
      {formatSlaState(defect.slaState)}
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

function GovernanceNoteField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-slate-100 pt-3">
      <dt className="text-[11px] font-semibold uppercase text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-slate-800">{value}</dd>
    </div>
  );
}

function CompactMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-xs font-semibold text-slate-900">{value}</dd>
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

type EvidenceImageEntry = {
  image: DefectEvidenceImage;
  sourceUrl: string;
};

function formatEvidenceTimestamp(image: DefectEvidenceImage) {
  return formatDateTime(image.timestamp ?? image.uploadedAt ?? image.createdAt);
}

function formatEvidenceGps(image: DefectEvidenceImage) {
  if (
    typeof image.latitude === "number" &&
    Number.isFinite(image.latitude) &&
    typeof image.longitude === "number" &&
    Number.isFinite(image.longitude)
  ) {
    return `${image.latitude.toFixed(6)}, ${image.longitude.toFixed(6)}`;
  }

  return null;
}

function EvidenceImageGrid({
  entries,
  emptyText,
  titlePrefix,
}: {
  entries: EvidenceImageEntry[];
  emptyText: string;
  titlePrefix: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(({ image, sourceUrl }, index) => {
        const gps = formatEvidenceGps(image);

        return (
          <a
            key={`${image.id}-${index}`}
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          >
            <img
              src={sourceUrl}
              alt={image.filename ?? titlePrefix}
              className="aspect-video w-full object-cover transition group-hover:scale-[1.02]"
            />
            <div className="space-y-1 border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                {titlePrefix} {index + 1}
              </div>
              <div>{formatEvidenceTimestamp(image)}</div>
              {gps ? <div>GPS {gps}</div> : null}
              {image.note ? <div className="line-clamp-2">{image.note}</div> : null}
            </div>
          </a>
        );
      })}
    </div>
  );
}

function TimelineIcon({ entry }: { entry: DefectTimelineEntry }) {
  if (entry.type === "DEFECT_VERIFIED" || entry.type === "CLOSURE_VERIFIED") {
    return <ShieldCheck size={16} />;
  }

  if (entry.type === "MAINTENANCE_STARTED" || entry.type === "MAINTENANCE_COMPLETED") {
    return <Wrench size={16} />;
  }

  if (entry.type === "RESOLUTION_OUTCOME_UPDATED") {
    return <FileCheck2 size={16} />;
  }

  if (entry.type === "STATUS_CHANGED") {
    return <CheckCircle2 size={16} />;
  }

  if (entry.type === "ASSIGNMENT_CHANGED" || entry.type === "DEFECT_ASSIGNED") {
    return <UserRound size={16} />;
  }

  if (entry.type === "DUE_DATE_CHANGED") {
    return <CalendarDays size={16} />;
  }

  if (entry.type === "COMMENT") {
    return <MessageSquare size={16} />;
  }

  return <Clock3 size={16} />;
}

function timelineTitle(entry: DefectTimelineEntry) {
  if (entry.type === "DEFECT_VERIFIED") {
    return "Defect verified";
  }

  if (entry.type === "DEFECT_ASSIGNED") {
    return "Defect assigned";
  }

  if (entry.type === "MAINTENANCE_STARTED") {
    return "Maintenance started";
  }

  if (entry.type === "MAINTENANCE_COMPLETED") {
    return "Maintenance completed";
  }

  if (entry.type === "RESOLUTION_OUTCOME_UPDATED") {
    return "Resolution outcome updated";
  }

  if (entry.type === "CLOSURE_VERIFIED") {
    return "Closure verified";
  }

  if (entry.type === "STATUS_CHANGED") {
    return "Status changed";
  }

  if (entry.type === "COMMENT") {
    return "Comment";
  }

  if (entry.type === "ASSIGNMENT_CHANGED") {
    return "Assignment updated";
  }

  if (entry.type === "DUE_DATE_CHANGED") {
    return "Due date updated";
  }

  return "Created";
}

function timelineDetail(entry: DefectTimelineEntry) {
  const details: string[] = [];

  if (
    entry.fromLifecycleStatus &&
    entry.toLifecycleStatus &&
    entry.fromLifecycleStatus !== "UNKNOWN" &&
    entry.toLifecycleStatus !== "UNKNOWN" &&
    entry.fromLifecycleStatus !== entry.toLifecycleStatus
  ) {
    details.push(
      `Lifecycle ${formatLifecycleStatus(entry.fromLifecycleStatus)} to ${formatLifecycleStatus(
        entry.toLifecycleStatus,
      )}`,
    );
  }

  if (
    entry.fromResolutionOutcome &&
    entry.toResolutionOutcome &&
    entry.fromResolutionOutcome !== "UNKNOWN" &&
    entry.toResolutionOutcome !== "UNKNOWN" &&
    entry.fromResolutionOutcome !== entry.toResolutionOutcome
  ) {
    details.push(
      `Outcome ${formatEnumLabel(entry.fromResolutionOutcome)} to ${formatEnumLabel(
        entry.toResolutionOutcome,
      )}`,
    );
  } else if (
    entry.toResolutionOutcome &&
    entry.toResolutionOutcome !== "UNKNOWN"
  ) {
    details.push(`Outcome ${formatEnumLabel(entry.toResolutionOutcome)}`);
  }

  if (entry.type === "STATUS_CHANGED" && entry.fromStatus && entry.toStatus) {
    details.push(`Workflow ${formatStatus(entry.fromStatus)} to ${formatStatus(entry.toStatus)}`);
  }

  if (entry.type === "CREATED" && entry.toStatus) {
    details.push(`Initial status ${formatStatus(entry.toStatus)}`);
  }

  return details.length > 0 ? details.join(" | ") : null;
}

function DefectDetailContent({ defectId }: { defectId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [defect, setDefect] = useState<DefectDetail | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<DefectWorkflowStatus>("OPEN");
  const [selectedAssignedUserId, setSelectedAssignedUserId] = useState("");
  const [selectedAssignedTeamId, setSelectedAssignedTeamId] = useState("");
  const [selectedDueDate, setSelectedDueDate] = useState("");
  const [selectedResolutionOutcome, setSelectedResolutionOutcome] =
    useState<Exclude<DefectResolutionOutcome, "UNKNOWN">>("RESOLVED");
  const [actionRemark, setActionRemark] = useState("");
  const [verificationRemarks, setVerificationRemarks] = useState("");
  const [completionRemarks, setCompletionRemarks] = useState("");
  const [closureRemarks, setClosureRemarks] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [isSavingDueDate, setIsSavingDueDate] = useState(false);
  const [isSavingGovernance, setIsSavingGovernance] = useState(false);
  const [isAddingComment, setIsAddingComment] = useState(false);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const applyDefect = useCallback((nextDefect: DefectDetail) => {
    setDefect(nextDefect);
    setActionRemark(nextDefect.actionRemark ?? "");
    setSelectedStatus(isWorkflowStatus(nextDefect.status) ? nextDefect.status : "OPEN");
    setSelectedAssignedUserId(
      nextDefect.assignedToUserId ?? nextDefect.assignedUserId ?? "",
    );
    setSelectedAssignedTeamId(
      nextDefect.assignedToTeamId ?? nextDefect.assignedTeamId ?? "",
    );
    setSelectedDueDate(toDateInputValue(nextDefect.dueDate));
    setSelectedResolutionOutcome(
      isMaintenanceResolutionOutcome(nextDefect.resolutionOutcome)
        ? nextDefect.resolutionOutcome
        : "RESOLVED",
    );
    setVerificationRemarks(
      nextDefect.verificationNotes ?? nextDefect.verificationRemarks ?? "",
    );
    setCompletionRemarks(nextDefect.maintenanceNotes ?? nextDefect.actionRemark ?? "");
    setClosureRemarks(
      nextDefect.closureVerificationNotes ?? nextDefect.closureRemarks ?? "",
    );
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

  const loadAssignmentOptions = useCallback(
    async (token: string) => {
      try {
        const [nextUsers, nextTeams] = await Promise.all([
          fetchUsers(token),
          fetchTeams(token),
        ]);

        setUsers(nextUsers.filter((managedUser) => managedUser.isActive));
        setTeams(nextTeams.filter((team) => team.isActive));
      } catch (optionsError) {
        if (optionsError instanceof ApiError && optionsError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          optionsError instanceof Error
            ? optionsError.message
            : "Unable to load assignment options.",
        );
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadDefect(storedSession.token);

      if (storedSession.user?.role === "ADMIN") {
        void loadAssignmentOptions(storedSession.token);
      }

      // Refresh the current-user payload so newly-granted QA authority
      // (canGovernQa) takes effect on this page without a full re-login.
      // Non-fatal: on failure we keep the cached session (loadDefect handles
      // an invalid token).
      void refreshStoredSessionUser(storedSession.token)
        .then((user) => {
          if (user) {
            setSession((current) => (current ? { ...current, user } : current));
          }
        })
        .catch(() => {
          /* keep cached session on transient/offline errors */
        });
    }
  }, [loadAssignmentOptions, loadDefect]);

  const isReadOnly = session?.user?.role !== "ADMIN";
  // Defect QA governance authority (verify / reject / closure) is provided by the
  // server (ADMIN, or an ASCURE QA actor holding an active QA_VALIDATION
  // capability). Role alone is insufficient here because MANAGER is normalized to
  // VIEWER client-side. ADMIN is OR'd in for resilience against sessions persisted
  // before the flag existed.
  const canGovernQa =
    session?.user?.role === "ADMIN" || Boolean(session?.user?.canGovernQa);
  const canSaveStatus = Boolean(session?.token && defect && !isReadOnly && !isSavingStatus);
  const canSaveAssignment = Boolean(
    session?.token && defect && !isReadOnly && !isSavingAssignment,
  );
  const canSaveDueDate = Boolean(session?.token && defect && !isReadOnly && !isSavingDueDate);
  // QA governance controls (verify / reject / closure + their notes) follow the
  // server QA authority so the buttons enable exactly when the API would allow.
  const canSaveGovernance = Boolean(
    session?.token && defect && canGovernQa && !isSavingGovernance,
  );
  // Maintenance completion uses a different API guard (assertCanCompleteMaintenance),
  // so keep its prior authority and don't enable a button the API would reject.
  const canCompleteMaintenance = Boolean(
    session?.token && defect && !isReadOnly && !isSavingGovernance,
  );
  const canAddComment = Boolean(
    session?.token &&
      defect &&
      !isReadOnly &&
      !isAddingComment &&
      comment.trim().length > 0,
  );

  const maintenanceEvidenceImages = useMemo(
    () =>
      (defect?.maintenanceProofImages?.length
        ? defect.maintenanceProofImages
        : defect?.evidenceImages ?? [])
        .map((image) => ({
          image,
          sourceUrl: getImageSourceUrl(image),
        }))
        .filter((entry): entry is EvidenceImageEntry => Boolean(entry.sourceUrl)) ?? [],
    [defect],
  );
  const inspectionEvidenceImages = useMemo(
    () =>
      (defect?.images ?? [])
        .map((image) => ({
          image,
          sourceUrl: getImageSourceUrl(image),
        }))
        .filter((entry): entry is EvidenceImageEntry => Boolean(entry.sourceUrl)),
    [defect],
  );
  const resolutionGovernance = useMemo(
    () =>
      defect
        ? {
            isException: isGovernanceException(defect),
            exceptionNotes: getExceptionNotes(defect),
            helperText: getResolutionGovernanceHelper(defect),
          }
        : null,
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

  async function handleAssignmentUpdate() {
    if (!session?.token || !defect || isReadOnly) {
      return;
    }

    setIsSavingAssignment(true);
    setError("");
    setNotice("");

    try {
      const nextDefect = await updateDefectAssignment(session.token, defect.id, {
        assignedUserId: selectedAssignedUserId || null,
        assignedTeamId: selectedAssignedTeamId || null,
        assignedToUserId: selectedAssignedUserId || null,
        assignedToTeamId: selectedAssignedTeamId || null,
      });

      applyDefect(nextDefect);
      setNotice("Assignment updated.");
    } catch (assignmentError) {
      if (assignmentError instanceof ApiError && assignmentError.status === 401) {
        handleLogout();
        return;
      }

      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : "Unable to update assignment.",
      );
    } finally {
      setIsSavingAssignment(false);
    }
  }

  async function handleDueDateUpdate() {
    if (!session?.token || !defect || isReadOnly) {
      return;
    }

    setIsSavingDueDate(true);
    setError("");
    setNotice("");

    try {
      const nextDefect = await updateDefectDueDate(
        session.token,
        defect.id,
        selectedDueDate || null,
      );

      applyDefect(nextDefect);
      setNotice("Due date updated.");
    } catch (dueDateError) {
      if (dueDateError instanceof ApiError && dueDateError.status === 401) {
        handleLogout();
        return;
      }

      setError(
        dueDateError instanceof Error ? dueDateError.message : "Unable to update due date.",
      );
    } finally {
      setIsSavingDueDate(false);
    }
  }

  async function runGovernanceAction(
    action: (token: string, defectId: string) => Promise<DefectDetail>,
    successMessage: string,
    canRun: boolean,
  ) {
    if (!session?.token || !defect || !canRun) {
      return;
    }

    setIsSavingGovernance(true);
    setError("");
    setNotice("");

    try {
      const nextDefect = await action(session.token, defect.id);
      applyDefect(nextDefect);
      setNotice(successMessage);
    } catch (governanceError) {
      if (governanceError instanceof ApiError && governanceError.status === 401) {
        handleLogout();
        return;
      }

      setError(
        governanceError instanceof Error
          ? governanceError.message
          : "Unable to update defect governance.",
      );
    } finally {
      setIsSavingGovernance(false);
    }
  }

  function handleVerifyDefect() {
    void runGovernanceAction(
      (token, id) => verifyDefect(token, id, verificationRemarks.trim() || null),
      "Defect verified.",
      canGovernQa,
    );
  }

  function handleRejectDefect() {
    void runGovernanceAction(
      (token, id) => rejectDefect(token, id, verificationRemarks.trim() || null),
      "Defect rejected.",
      canGovernQa,
    );
  }

  function handleMaintenanceCompletion() {
    void runGovernanceAction(
      (token, id) =>
        completeDefectMaintenance(token, id, {
          resolutionOutcome: selectedResolutionOutcome,
          maintenanceNotes: completionRemarks.trim() || null,
        }),
      "Maintenance completion recorded.",
      canCompleteMaintenance,
    );
  }

  function handleClosureVerification() {
    void runGovernanceAction(
      (token, id) => verifyDefectClosure(token, id, closureRemarks.trim() || null),
      "Closure verified.",
      canGovernQa,
    );
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
                  {session?.user?.role === "ADMIN"
                    ? "Full access"
                    : canGovernQa
                      ? "QA access"
                      : "Read-only"}
                </span>
                {defect ? <SeverityBadge severity={defect.severity} /> : null}
                {defect ? <StatusBadge status={defect.status} /> : null}
                {defect ? <LifecycleBadge status={defect.lifecycleStatus} /> : null}
                {defect ? <OutcomeBadge outcome={defect.resolutionOutcome} /> : null}
                {defect ? <SlaBadge defect={defect} /> : null}
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
                    <div className="w-full rounded-lg border border-teal-100 bg-teal-50/40 p-4 lg:max-w-md">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">
                            Operational Ownership
                          </h3>
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Current accountable people and timestamps
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          <LifecycleBadge status={defect.lifecycleStatus} />
                          <OutcomeBadge outcome={defect.resolutionOutcome} />
                        </div>
                      </div>

                      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                        <CompactMeta
                          label="Assigned"
                          value={formatAssignee(defect)}
                        />
                        <CompactMeta
                          label="Assigned At"
                          value={formatDateTime(defect.assignedAt)}
                        />
                        <CompactMeta
                          label="QA/QC"
                          value={formatNullable(
                            defect.verifiedByUser?.name ?? defect.verifiedByUser?.email,
                          )}
                        />
                        <CompactMeta
                          label="Verified At"
                          value={formatDateTime(defect.verifiedAt)}
                        />
                        <CompactMeta
                          label="Maintained"
                          value={formatNullable(
                            defect.maintainedByUser?.name ?? defect.maintainedByUser?.email,
                          )}
                        />
                        <CompactMeta
                          label="Maintained At"
                          value={formatDateTime(defect.maintainedAt)}
                        />
                        <CompactMeta
                          label="Closure By"
                          value={formatNullable(
                            defect.closureVerifiedByUser?.name ??
                              defect.closureVerifiedByUser?.email,
                          )}
                        />
                        <CompactMeta
                          label="Closure At"
                          value={formatDateTime(defect.closureVerifiedAt)}
                        />
                      </dl>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={handleVerifyDefect}
                          disabled={!canSaveGovernance}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-3 text-xs font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isSavingGovernance ? (
                            <RefreshCw size={14} className="animate-spin" />
                          ) : (
                            <ShieldCheck size={14} />
                          )}
                          Verify Defect
                        </button>
                        <button
                          type="button"
                          onClick={handleRejectDefect}
                          disabled={!canSaveGovernance}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 shadow-[var(--shadow-soft)] transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <Ban size={14} />
                          Reject Defect
                        </button>
                        <button
                          type="button"
                          onClick={handleMaintenanceCompletion}
                          disabled={!canCompleteMaintenance}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <Wrench size={14} />
                          Mark Completed
                        </button>
                        <button
                          type="button"
                          onClick={handleClosureVerification}
                          disabled={!canSaveGovernance}
                          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-3 text-xs font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <FileCheck2 size={14} />
                          Verify Closure
                        </button>
                      </div>
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
                    <DetailField label="Assigned To" value={formatAssignee(defect)} />
                    <DetailField label="Assigned At" value={formatDateTime(defect.assignedAt)} />
                    <DetailField
                      label="Lifecycle"
                      value={formatLifecycleStatus(defect.lifecycleStatus)}
                    />
                    <DetailField
                      label="Resolution Outcome"
                      value={formatEnumLabel(defect.resolutionOutcome)}
                    />
                    <DetailField
                      label="QA/QC Verified By"
                      value={formatNullable(
                        defect.verifiedByUser?.name ?? defect.verifiedByUser?.email,
                      )}
                    />
                    <DetailField
                      label="QA/QC Verified At"
                      value={formatDateTime(defect.verifiedAt)}
                    />
                    <DetailField
                      label="Maintained By"
                      value={formatNullable(
                        defect.maintainedByUser?.name ?? defect.maintainedByUser?.email,
                      )}
                    />
                    <DetailField
                      label="Maintained At"
                      value={formatDateTime(defect.maintainedAt)}
                    />
                    <DetailField
                      label="Closure Verified By"
                      value={formatNullable(
                        defect.closureVerifiedByUser?.name ??
                          defect.closureVerifiedByUser?.email,
                      )}
                    />
                    <DetailField
                      label="Closure Verified At"
                      value={formatDateTime(defect.closureVerifiedAt)}
                    />
                    <DetailField label="Due Date" value={formatDate(defect.dueDate)} />
                    <DetailField label="SLA State" value={formatSlaState(defect.slaState)} />
                    <DetailField label="Latest Update" value={formatDateTime(defect.updatedAt)} />
                  </dl>

                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Operational Evidence
                    </h3>
                    <dl className="mt-3 grid gap-4 md:grid-cols-3">
                      <DetailField
                        label="Verification Notes"
                        value={formatNullable(
                          defect.verificationNotes ?? defect.verificationRemarks,
                        )}
                      />
                      <DetailField
                        label="Maintenance Notes"
                        value={formatNullable(defect.maintenanceNotes)}
                      />
                      <DetailField
                        label="Closure Notes"
                        value={formatNullable(
                          defect.closureVerificationNotes ?? defect.closureRemarks,
                        )}
                      />
                    </dl>
                    <div className="mt-5 border-t border-slate-100 pt-5">
                      <div className="flex items-center justify-between gap-4">
                        <h4 className="text-sm font-semibold text-slate-900">
                          Maintenance Proof Evidence
                        </h4>
                        <span className="text-sm text-[var(--muted)]">
                          {maintenanceEvidenceImages.length} photos
                        </span>
                      </div>
                      <div className="mt-3">
                        <EvidenceImageGrid
                          entries={maintenanceEvidenceImages}
                          emptyText="No maintenance proof photos linked."
                          titlePrefix="Maintenance Proof"
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-[var(--foreground)]">
                        Resolution Governance
                      </h2>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                        {resolutionGovernance?.helperText}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <LifecycleBadge status={defect.lifecycleStatus} />
                      {defect.resolutionOutcome ? (
                        <OutcomeBadge outcome={defect.resolutionOutcome} />
                      ) : (
                        <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600">
                          Outcome Not Recorded
                        </span>
                      )}
                    </div>
                  </div>

                  <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <GovernanceNoteField
                      label="Lifecycle Status"
                      value={formatLifecycleStatus(defect.lifecycleStatus)}
                    />
                    <GovernanceNoteField
                      label="Resolution Outcome"
                      value={formatEnumLabel(defect.resolutionOutcome)}
                    />
                    <GovernanceNoteField
                      label="Maintenance Notes"
                      value={formatNullable(defect.maintenanceNotes)}
                    />
                    <GovernanceNoteField
                      label="Closure Verification Notes"
                      value={formatNullable(
                        defect.closureVerificationNotes ?? defect.closureRemarks,
                      )}
                    />
                    {resolutionGovernance?.isException ? (
                      <div className="md:col-span-2 xl:col-span-4">
                        <GovernanceNoteField
                          label="Exception Notes"
                          value={formatNullable(resolutionGovernance.exceptionNotes)}
                        />
                      </div>
                    ) : null}
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
                          Inspection Evidence
                        </div>
                        <span className="text-sm text-[var(--muted)]">
                          {inspectionEvidenceImages.length} photos
                        </span>
                      </div>

                      <div className="mt-5">
                        <EvidenceImageGrid
                          entries={inspectionEvidenceImages}
                          emptyText="No inspection evidence photos linked."
                          titlePrefix="Inspection Image"
                        />
                      </div>
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
                        Operational Actions
                      </h2>
                      <div className="mt-4 space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <LifecycleBadge status={defect.lifecycleStatus} />
                          <OutcomeBadge outcome={defect.resolutionOutcome} />
                        </div>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Verification Notes
                          </span>
                          <textarea
                            value={verificationRemarks}
                            onChange={(event) => setVerificationRemarks(event.target.value)}
                            disabled={!canGovernQa || isSavingGovernance}
                            rows={3}
                            className={`mt-2 resize-none ${controlClassName}`}
                          />
                        </label>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <button
                            type="button"
                            onClick={handleVerifyDefect}
                            disabled={!canSaveGovernance}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-3 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {isSavingGovernance ? (
                              <RefreshCw size={16} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={16} />
                            )}
                            Verify Defect
                          </button>
                          <button
                            type="button"
                            onClick={handleRejectDefect}
                            disabled={!canSaveGovernance}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 shadow-[var(--shadow-soft)] transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <Ban size={16} />
                            Reject Defect
                          </button>
                        </div>

                        <label className="block border-t border-slate-100 pt-4">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Resolution Outcome
                          </span>
                          <select
                            value={selectedResolutionOutcome}
                            onChange={(event) =>
                              setSelectedResolutionOutcome(
                                event.target.value as Exclude<
                                  DefectResolutionOutcome,
                                  "UNKNOWN"
                                >,
                              )
                            }
                            disabled={isReadOnly || isSavingGovernance}
                            className={`mt-2 ${controlClassName}`}
                          >
                            {resolutionOutcomeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Maintenance Notes
                          </span>
                          <textarea
                            value={completionRemarks}
                            onChange={(event) => setCompletionRemarks(event.target.value)}
                            disabled={isReadOnly || isSavingGovernance}
                            rows={3}
                            className={`mt-2 resize-none ${controlClassName}`}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={handleMaintenanceCompletion}
                          disabled={!canCompleteMaintenance}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          <Wrench size={16} />
                          Mark Completed
                        </button>

                        <label className="block border-t border-slate-100 pt-4">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Closure Verification Notes
                          </span>
                          <textarea
                            value={closureRemarks}
                            onChange={(event) => setClosureRemarks(event.target.value)}
                            disabled={!canGovernQa || isSavingGovernance}
                            rows={3}
                            className={`mt-2 resize-none ${controlClassName}`}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={handleClosureVerification}
                          disabled={!canSaveGovernance}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <FileCheck2 size={16} />
                          Verify Closure
                        </button>
                      </div>
                    </section>

                    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        Assignment & SLA
                      </h2>
                      <div className="mt-4 space-y-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Assigned User
                          </span>
                          <select
                            value={selectedAssignedUserId}
                            onChange={(event) => setSelectedAssignedUserId(event.target.value)}
                            disabled={isReadOnly || isSavingAssignment}
                            className={`mt-2 ${controlClassName}`}
                          >
                            <option value="">Unassigned</option>
                            {users.map((managedUser) => (
                              <option key={managedUser.id} value={managedUser.id}>
                                {managedUser.name || managedUser.email}
                              </option>
                            ))}
                          </select>
                        </label>

                        {teams.length > 0 ? (
                          <label className="block">
                            <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                              Assigned Team
                            </span>
                            <select
                              value={selectedAssignedTeamId}
                              onChange={(event) => setSelectedAssignedTeamId(event.target.value)}
                              disabled={isReadOnly || isSavingAssignment}
                              className={`mt-2 ${controlClassName}`}
                            >
                              <option value="">Unassigned</option>
                              {teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                  {team.name || team.code}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        <button
                          type="button"
                          onClick={handleAssignmentUpdate}
                          disabled={!canSaveAssignment}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isSavingAssignment ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <UserRound size={16} />
                          )}
                          Update Assignment
                        </button>

                        <label className="block border-t border-slate-100 pt-4">
                          <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                            Due Date
                          </span>
                          <input
                            type="date"
                            value={selectedDueDate}
                            onChange={(event) => setSelectedDueDate(event.target.value)}
                            disabled={isReadOnly || isSavingDueDate}
                            className={`mt-2 ${controlClassName}`}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={handleDueDateUpdate}
                          disabled={!canSaveDueDate}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                        >
                          {isSavingDueDate ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : (
                            <CalendarDays size={16} />
                          )}
                          Update Due Date
                        </button>
                      </div>
                    </section>

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
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
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
