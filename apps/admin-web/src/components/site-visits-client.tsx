"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronsUpDown,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import {
  Card,
  Chip,
  Dot,
  Eyebrow,
  FilterBar,
  IconBtn,
  KpiCard,
  PageHeader,
  ProgressBar,
  SearchField,
  TableFooter,
  Tbtn,
  filterControlClass,
  filterSelectClass,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import { fetchTeams } from "@/lib/users";
import {
  batchGenerateReports,
  downloadDefectReportsZipFile,
  downloadReportsZip,
  fetchBatchReportStatus,
  fetchDefectReportsZipStatus,
  startDefectReportsZip,
} from "@/lib/report-templates";
import { createSiteVisit, fetchSiteVisits, fetchSubstations } from "@/lib/site-visits";
import type { AuthSession } from "@/types/auth";
import type { EnterpriseOptions } from "@/types/enterprise";
import type { ManagedTeam } from "@/types/users";
import type {
  DisplayStatus,
  OperationalDomain,
  SiteVisitListItem,
  SiteVisitSubstation,
  SiteVisitStatus,
  SiteVisitType,
  SurveyScope,
} from "@/types/site-visits";
import {
  STANDALONE_SURVEY_SCOPES,
  SURVEY_SCOPE_LABELS,
} from "@/types/site-visits";

type SortKey =
  | "status"
  | "pencawang"
  | "mainhead"
  | "team"
  | "progress"
  | "defects"
  | "lastActivity"
  | "startedAt";
type SortDirection = "asc" | "desc";
type StatusFilter = "ALL" | DisplayStatus;
type VisitTypeFilter = "ALL" | SiteVisitType;
type OperationalDomainFilter = "ALL" | OperationalDomain;
type AssetTypeFilter = "ALL" | SurveyScope;

interface SiteVisitCreateForm {
  teamId: string;
  substationId: string;
  pencawangCode: string;
  pencawangName: string;
  functionalLocation: string;
  mainheadId: string;
  projectId: string;
  workPackageId: string;
  operationalDomain: string;
  visitType: Exclude<SiteVisitType, "UNSPECIFIED">;
  notes: string;
}

const DEFAULT_SITE_VISIT_CREATE_FORM: SiteVisitCreateForm = {
  teamId: "",
  substationId: "",
  pencawangCode: "",
  pencawangName: "",
  functionalLocation: "",
  mainheadId: "",
  projectId: "",
  workPackageId: "",
  operationalDomain: "",
  visitType: "DISCOVERY",
  notes: "",
};

const PAGE_SIZE_OPTIONS = [10, 25, 50];
const AUTO_REFRESH_MS = 60000;

/** Server-side batch cap (mirrors the API's BATCH_COMPILE_MAX). */
const BATCH_REPORT_MAX = 20;
// Defect-report ZIPs allow bigger selections than compile batches — the owner
// hands over whole Mainheads (30+ Pencawang) to the maintenance team at once.
const DEFECT_ZIP_MAX = 40;
const BATCH_POLL_MS = 4000;

/** Survey lifecycle states the report compiler accepts (mirror of the API):
 *  RONDAAN_SELESAI / DISAHKAN_PENGURUS compile fresh, LAPORAN_SELESAI
 *  regenerates a new version. */
const REPORT_READY_LIFECYCLES = new Set([
  "RONDAAN_SELESAI",
  "DISAHKAN_PENGURUS",
  "LAPORAN_SELESAI",
]);

function isReportEligible(visit: SiteVisitListItem) {
  return (
    visit.lifecycleStatus !== null &&
    REPORT_READY_LIFECYCLES.has(visit.lifecycleStatus)
  );
}

type BatchPhase = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";

interface BatchItem {
  siteVisitId: string;
  label: string;
  phase: BatchPhase;
  detail: string;
  processed: number;
  total: number;
}

const BATCH_PHASE_LABELS: Record<BatchPhase, string> = {
  QUEUED: "Queued",
  RUNNING: "Generating",
  COMPLETED: "Done",
  FAILED: "Failed",
  SKIPPED: "Skipped",
};

function batchPhaseTone(phase: BatchPhase): Tone {
  if (phase === "COMPLETED") return "success";
  if (phase === "FAILED") return "critical";
  if (phase === "SKIPPED") return "warning";
  if (phase === "RUNNING") return "info";
  return "neutral";
}

function isTerminalBatchPhase(phase: BatchPhase) {
  return phase === "COMPLETED" || phase === "FAILED" || phase === "SKIPPED";
}
// Per-tab persistence of the Site Visits filter/sort/page view, so returning
// from a visit detail restores the same filtered list.
const FILTERS_STORAGE_KEY = "ascure:admin-web:site-visits-filters";
const STATUS_OPTIONS: Array<{ label: string; value: StatusFilter }> = [
  { label: "All statuses", value: "ALL" },
  { label: "Not Started", value: "NOT_STARTED" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Needs Amendment", value: "NEEDS_AMENDMENT" },
  { label: "In Review", value: "IN_REVIEW" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Archived", value: "ARCHIVED" },
  { label: "Cancelled", value: "CANCELLED" },
];
const VISIT_TYPE_OPTIONS: Array<{ label: string; value: VisitTypeFilter }> = [
  { label: "All types", value: "ALL" },
  { label: "Discovery", value: "DISCOVERY" },
  { label: "Reinspection", value: "REINSPECTION" },
  { label: "Special", value: "SPECIAL" },
  { label: "Audit", value: "AUDIT" },
  { label: "Unspecified", value: "UNSPECIFIED" },
];
const ASSET_TYPE_OPTIONS: Array<{ label: string; value: AssetTypeFilter }> = [
  { label: "All asset types", value: "ALL" },
  { label: "SAVR", value: "SAVR" },
  { label: "SAVT", value: "SAVT" },
  { label: "Pencawang", value: "PENCAWANG" },
  { label: "Feeder Pillar", value: "FEEDER_PILLAR" },
  { label: "Link Box", value: "LINK_BOX" },
  { label: "Cable Bridge", value: "CABLE_BRIDGE" },
];
const OPERATIONAL_DOMAIN_OPTIONS: Array<{ label: string; value: OperationalDomainFilter }> = [
  { label: "All domains", value: "ALL" },
  { label: "Survey", value: "SURVEY" },
  { label: "Inspection", value: "INSPECTION" },
  { label: "Maintenance", value: "MAINTENANCE" },
  { label: "Repair", value: "REPAIR" },
  { label: "Audit", value: "AUDIT" },
  { label: "Civil", value: "CIVIL" },
  { label: "Distribution", value: "DISTRIBUTION" },
  { label: "33 KV", value: "THIRTY_THREE_KV" },
  { label: "Emergency", value: "EMERGENCY" },
  { label: "Other", value: "OTHER" },
  { label: "Unspecified", value: "UNSPECIFIED" },
];
const STATUS_RANK: Record<SiteVisitStatus, number> = {
  ACTIVE: 0,
  OPEN: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  CANCELLED: 4,
  UNKNOWN: 5,
};

/** Modal fields are stacked, so they take the control pill at full width. */
const modalInputClass = `${filterControlClass} mt-1.5 w-full`;
const modalSelectClass = `${filterSelectClass} mt-1.5 w-full`;
const modalLabelClass = "text-[12.5px] font-semibold text-[var(--foreground-soft)]";
const tableSublineClass = "mt-1 truncate text-[11.5px] text-[var(--muted-2)]";

function SiteVisitsLoading() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-[110px] animate-pulse rounded-[var(--radius-card)] bg-[var(--panel-muted)]"
          />
        ))}
      </div>
      <Card>
        <div className="h-[38px] w-full animate-pulse rounded-[var(--radius-control)] bg-[var(--panel-muted)]" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-[9px] bg-[var(--panel-muted)]" />
          ))}
        </div>
      </Card>
    </div>
  );
}

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

function optionLabel(option: { name?: string | null; code?: string | null }) {
  const name = option.name?.trim();
  const code = option.code?.trim();

  if (code && name) {
    return `${code} - ${name}`;
  }

  return name || code || "Unnamed";
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
    hour: "2-digit",
    minute: "2-digit",
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

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeSearchText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function displayTeam(visit: SiteVisitListItem) {
  return visit.team?.name?.trim() || visit.team?.code?.trim() || "Unassigned";
}

function displayPencawang(visit: SiteVisitListItem) {
  const pencawang = [visit.pencawangCode, visit.pencawangName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" - ");

  if (pencawang) {
    return pencawang;
  }

  // A standalone equipment survey has no Pencawang by design — title it by
  // its scope instead of "Not recorded".
  if (STANDALONE_SURVEY_SCOPES.has(visit.surveyScope)) {
    return `${SURVEY_SCOPE_LABELS[visit.surveyScope]} survey`;
  }

  return "Not recorded";
}

function displayMainhead(visit: SiteVisitListItem) {
  return (
    visit.mainheadRecord?.name?.trim() ||
    visit.mainheadRecord?.code?.trim() ||
    visit.mainhead ||
    "MAINHEAD not recorded"
  );
}

function parseTimestamp(date: string | null | undefined) {
  const timestamp = date ? new Date(date).getTime() : Number.NaN;

  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatRelativeActivity(date: string | null | undefined) {
  const timestamp = parseTimestamp(date);

  if (!timestamp) {
    return "No activity";
  }

  const diffMilliseconds = Date.now() - timestamp;

  if (diffMilliseconds < 0) {
    return formatDateTime(date);
  }

  const minutes = Math.floor(diffMilliseconds / 60000);

  if (minutes < 1) {
    return "Updated just now";
  }

  if (minutes < 60) {
    return `Updated ${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `Updated ${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `Updated ${days}d ago`;
  }

  return formatDateTime(date);
}

/** Freshness of the last field write: green under an hour, amber under a day. */
function activityTone(date: string | null | undefined): Tone {
  const timestamp = parseTimestamp(date);

  if (!timestamp) {
    return "neutral";
  }

  const diffHours = (Date.now() - timestamp) / 3600000;

  if (diffHours <= 1) {
    return "success";
  }

  if (diffHours <= 24) {
    return "warning";
  }

  return "neutral";
}

function formatRefreshTime(date: Date | null) {
  if (!date) {
    return "Last refreshed pending";
  }

  return `Last refreshed ${new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)}`;
}

function getSortValue(visit: SiteVisitListItem, sortKey: SortKey) {
  if (sortKey === "status") {
    return STATUS_RANK[visit.status];
  }

  if (sortKey === "progress") {
    return visit.completionPercentage;
  }

  if (sortKey === "defects") {
    return visit.defectsFound;
  }

  if (sortKey === "lastActivity") {
    return dateSortValue(visit.lastActivityAt);
  }

  if (sortKey === "startedAt") {
    return dateSortValue(visit.startedAt);
  }

  if (sortKey === "pencawang") {
    return normalizeSearchText(displayPencawang(visit));
  }

  if (sortKey === "mainhead") {
    return normalizeSearchText(displayMainhead(visit));
  }

  return normalizeSearchText(displayTeam(visit));
}

function dateSortValue(date: string | null | undefined) {
  const timestamp = date ? new Date(date).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareSortValues(left: string | number, right: string | number) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function uniqueTeams(visits: SiteVisitListItem[]) {
  const teams = new Map<string, string>();

  visits.forEach((visit) => {
    if (!visit.team?.id) {
      return;
    }

    teams.set(visit.team.id, displayTeam(visit));
  });

  return Array.from(teams.entries()).sort((left, right) =>
    left[1].localeCompare(right[1], "en", { sensitivity: "base" }),
  );
}

/** In Review is the DC's queue — brand, not info, so it reads apart from In Progress. */
function displayStatusTone(displayStatus: DisplayStatus): Tone {
  if (displayStatus === "IN_PROGRESS") return "info";
  if (displayStatus === "NEEDS_AMENDMENT") return "warning";
  if (displayStatus === "IN_REVIEW") return "brand";
  if (displayStatus === "COMPLETED") return "success";
  return "neutral";
}

function StatusBadge({
  displayStatus,
  label,
}: {
  displayStatus: DisplayStatus;
  label: string;
}) {
  return (
    <Chip tone={displayStatusTone(displayStatus)} dot title={label}>
      {label}
    </Chip>
  );
}

function DefectChip({ count }: { count: number }) {
  const hasDefects = count > 0;

  return (
    <Chip tone={hasDefects ? "critical" : "neutral"}>
      {hasDefects ? <AlertTriangle size={12} /> : null}
      {hasDefects ? `${count.toLocaleString()} defect${count === 1 ? "" : "s"}` : "0 defects"}
    </Chip>
  );
}

function ActivityStatus({ date }: { date: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--foreground)]">
        <Dot tone={activityTone(date)} />
        <span className="truncate">{formatRelativeActivity(date)}</span>
      </div>
      {date ? (
        <div className="mt-1 truncate font-mono text-[11.5px] text-[var(--muted-2)]">
          {formatDateTime(date)}
        </div>
      ) : null}
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  activeSortKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === activeSortKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-left transition hover:text-[var(--foreground)] ${
        isActive ? "text-[var(--foreground)]" : ""
      }`}
    >
      {label}
      <ChevronsUpDown
        size={12}
        className={`shrink-0 ${isActive ? "text-[var(--brand)]" : "text-[var(--muted-2)]"}`}
      />
      {isActive ? <span className="sr-only">sorted {direction}</span> : null}
    </button>
  );
}

function SiteVisitCreateModal({
  values,
  teams,
  substations,
  enterpriseOptions,
  error,
  isSaving,
  onChange,
  onClose,
  onSubmit,
}: {
  values: SiteVisitCreateForm;
  teams: ManagedTeam[];
  substations: SiteVisitSubstation[];
  enterpriseOptions: EnterpriseOptions | null;
  error: string;
  isSaving: boolean;
  onChange: <K extends keyof SiteVisitCreateForm>(
    field: K,
    value: SiteVisitCreateForm[K],
  ) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div>
            <Eyebrow>Site Visit</Eyebrow>
            <h2
              className="mt-1 text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Create Site Visit
            </h2>
          </div>
          <IconBtn onClick={onClose} aria-label="Close site visit modal">
            <X size={16} />
          </IconBtn>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-[18px] py-5">
          {error ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={modalLabelClass}>Team</span>
              <select
                value={values.teamId}
                onChange={(event) => onChange("teamId", event.target.value)}
                required
                className={modalSelectClass}
              >
                <option value="">Select team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {optionLabel(team)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={modalLabelClass}>Visit Type</span>
              <select
                value={values.visitType}
                onChange={(event) =>
                  onChange("visitType", event.target.value as SiteVisitCreateForm["visitType"])
                }
                className={modalSelectClass}
              >
                {VISIT_TYPE_OPTIONS.filter((option) => option.value !== "UNSPECIFIED").map(
                  (option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={modalLabelClass}>Existing Pencawang</span>
              <select
                value={values.substationId}
                onChange={(event) => onChange("substationId", event.target.value)}
                className={modalSelectClass}
              >
                <option value="">Create from fields below</option>
                {substations.map((substation) => (
                  <option key={substation.id} value={substation.id}>
                    {optionLabel(substation)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={modalLabelClass}>Domain</span>
              <select
                value={values.operationalDomain}
                onChange={(event) => onChange("operationalDomain", event.target.value)}
                className={modalSelectClass}
              >
                <option value="">Not recorded</option>
                {enterpriseOptions?.operationalDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {formatEnum(domain)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={modalLabelClass}>Kod Pencawang</span>
              <input
                type="text"
                value={values.pencawangCode}
                onChange={(event) => onChange("pencawangCode", event.target.value)}
                className={modalInputClass}
              />
            </label>
            <label className="block">
              <span className={modalLabelClass}>Nama Pencawang</span>
              <input
                type="text"
                value={values.pencawangName}
                onChange={(event) => onChange("pencawangName", event.target.value)}
                className={modalInputClass}
              />
            </label>
            <label className="block">
              <span className={modalLabelClass}>Functional Location</span>
              <input
                type="text"
                value={values.functionalLocation}
                onChange={(event) => onChange("functionalLocation", event.target.value)}
                className={modalInputClass}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className={modalLabelClass}>MAINHEAD</span>
              <select
                value={values.mainheadId}
                onChange={(event) => onChange("mainheadId", event.target.value)}
                className={modalSelectClass}
                required
              >
                <option value="">Select MAINHEAD</option>
                {enterpriseOptions?.mainheads.map((mainhead) => (
                  <option key={mainhead.id} value={mainhead.id}>
                    {optionLabel(mainhead)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={modalLabelClass}>Project</span>
              <select
                value={values.projectId}
                onChange={(event) => onChange("projectId", event.target.value)}
                className={modalSelectClass}
              >
                <option value="">No project</option>
                {enterpriseOptions?.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {optionLabel(project)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={modalLabelClass}>Work Package</span>
              <select
                value={values.workPackageId}
                onChange={(event) => onChange("workPackageId", event.target.value)}
                className={modalSelectClass}
              >
                <option value="">No work package</option>
                {enterpriseOptions?.workPackages.map((workPackage) => (
                  <option key={workPackage.id} value={workPackage.id}>
                    {optionLabel(workPackage)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className={modalLabelClass}>Notes</span>
            <textarea
              value={values.notes}
              onChange={(event) => onChange("notes", event.target.value)}
              rows={3}
              className={`${modalInputClass} !h-auto resize-none py-2`}
            />
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--line2)] pt-4 sm:flex-row sm:justify-end">
            <Tbtn onClick={onClose}>Cancel</Tbtn>
            <Tbtn type="submit" variant="primary" disabled={isSaving}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : "Create Site Visit"}
            </Tbtn>
          </div>
        </form>
      </div>
    </div>
  );
}

function SiteVisitsContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [visits, setVisits] = useState<SiteVisitListItem[]>([]);
  const [teams, setTeams] = useState<ManagedTeam[]>([]);
  const [substations, setSubstations] = useState<SiteVisitSubstation[]>([]);
  const [enterpriseOptions, setEnterpriseOptions] = useState<EnterpriseOptions | null>(null);
  const [error, setError] = useState("");
  const [modalError, setModalError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingCreate, setIsSavingCreate] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<SiteVisitCreateForm>(
    DEFAULT_SITE_VISIT_CREATE_FORM,
  );
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [mainheadFilter, setMainheadFilter] = useState("ALL");
  const [pencawangFilter, setPencawangFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [memberFilter, setMemberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [visitTypeFilter, setVisitTypeFilter] = useState<VisitTypeFilter>("ALL");
  const [operationalDomainFilter, setOperationalDomainFilter] =
    useState<OperationalDomainFilter>("ALL");
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetTypeFilter>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActivity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Batch report generation: which visits are ticked, the live progress of a
  // running batch (null = no panel), and the two in-flight button states.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [batchItems, setBatchItems] = useState<BatchItem[] | null>(null);
  const [batchError, setBatchError] = useState("");
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  // Non-null while a defect-report ZIP job runs (the ZIP builds server-side;
  // this drives the button's "Menjana… n/m" progress).
  const [defectZipProgress, setDefectZipProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  // Persist the filter/sort/page view so returning from a visit detail (or any
  // back-navigation) restores the same filtered list instead of resetting.
  const filtersHydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, unknown>;
        // Enum filters: only restore values that still exist in their option
        // sets, so a value removed by a deploy can't strand the list. The
        // data-derived filters (mainhead/pencawang/team) are reconciled against
        // the loaded data below instead.
        const statusValues = new Set<string>(STATUS_OPTIONS.map((o) => o.value));
        const visitTypeValues = new Set<string>(VISIT_TYPE_OPTIONS.map((o) => o.value));
        const domainValues = new Set<string>(OPERATIONAL_DOMAIN_OPTIONS.map((o) => o.value));
        const assetTypeValues = new Set<string>(ASSET_TYPE_OPTIONS.map((o) => o.value));
        if (typeof saved.search === "string") setSearch(saved.search);
        if (typeof saved.mainheadFilter === "string") setMainheadFilter(saved.mainheadFilter);
        if (typeof saved.pencawangFilter === "string") setPencawangFilter(saved.pencawangFilter);
        if (typeof saved.teamFilter === "string") setTeamFilter(saved.teamFilter);
        if (typeof saved.memberFilter === "string") setMemberFilter(saved.memberFilter);
        if (typeof saved.statusFilter === "string" && statusValues.has(saved.statusFilter))
          setStatusFilter(saved.statusFilter as StatusFilter);
        if (typeof saved.visitTypeFilter === "string" && visitTypeValues.has(saved.visitTypeFilter))
          setVisitTypeFilter(saved.visitTypeFilter as VisitTypeFilter);
        if (typeof saved.operationalDomainFilter === "string" && domainValues.has(saved.operationalDomainFilter))
          setOperationalDomainFilter(saved.operationalDomainFilter as OperationalDomainFilter);
        if (typeof saved.assetTypeFilter === "string" && assetTypeValues.has(saved.assetTypeFilter))
          setAssetTypeFilter(saved.assetTypeFilter as AssetTypeFilter);
        if (typeof saved.startDate === "string") setStartDate(saved.startDate);
        if (typeof saved.endDate === "string") setEndDate(saved.endDate);
        if (typeof saved.sortKey === "string") setSortKey(saved.sortKey as SortKey);
        if (saved.sortDirection === "asc" || saved.sortDirection === "desc")
          setSortDirection(saved.sortDirection);
        if (typeof saved.pageSize === "number" && saved.pageSize > 0) setPageSize(saved.pageSize);
      }
    } catch {
      // Ignore corrupt/unavailable storage — fall back to defaults.
    }
  }, []);

  useEffect(() => {
    // Skip the initial mount commit: the restore effect above runs in the SAME
    // commit and its setState hasn't re-rendered yet, so the values here are
    // still the defaults — writing now would clobber the saved view before it
    // loads. Prime on the first run, then persist on every change after.
    if (!filtersHydrated.current) {
      filtersHydrated.current = true;
      return;
    }
    try {
      window.sessionStorage.setItem(
        FILTERS_STORAGE_KEY,
        JSON.stringify({
          search,
          mainheadFilter,
          pencawangFilter,
          teamFilter,
          memberFilter,
          statusFilter,
          visitTypeFilter,
          operationalDomainFilter,
          assetTypeFilter,
          startDate,
          endDate,
          sortKey,
          sortDirection,
          pageSize,
        }),
      );
    } catch {
      // Ignore quota/serialization errors — persistence is best-effort.
    }
  }, [
    search,
    mainheadFilter,
    pencawangFilter,
    teamFilter,
    memberFilter,
    statusFilter,
    visitTypeFilter,
    operationalDomainFilter,
    assetTypeFilter,
    startDate,
    endDate,
    sortKey,
    sortDirection,
    pageSize,
  ]);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadVisits = useCallback(
    async (token: string, showLoading = true) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError("");

      try {
        const nextVisits = await fetchSiteVisits(token);
        setVisits(nextVisits);
        setLastRefreshedAt(new Date());
      } catch (visitsError) {
        if (visitsError instanceof ApiError && visitsError.status === 401) {
          handleLogout();
          return;
        }

        setError(visitsError instanceof Error ? visitsError.message : "Unable to load site visits.");
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [handleLogout],
  );

  const loadCreateOptions = useCallback(
    async (token: string) => {
      try {
        const [nextTeams, nextSubstations, nextEnterpriseOptions] = await Promise.all([
          fetchTeams(token),
          fetchSubstations(token),
          fetchEnterpriseOptions(token),
        ]);

        setTeams(nextTeams.filter((team) => team.isActive !== false));
        setSubstations(nextSubstations);
        setEnterpriseOptions(nextEnterpriseOptions);
        setCreateForm((currentForm) => ({
          ...currentForm,
          teamId:
            currentForm.teamId ||
            nextTeams.find((team) => team.isActive !== false)?.id ||
            "",
        }));
      } catch (optionsError) {
        if (optionsError instanceof ApiError && optionsError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          optionsError instanceof Error
            ? optionsError.message
            : "Unable to load site visit creation options.",
        );
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadVisits(storedSession.token);
      void loadCreateOptions(storedSession.token);
    }
  }, [loadCreateOptions, loadVisits]);

  // ─── Batch report generation ──────────────────────────────────────────────

  const canBatchReport =
    session?.user?.role === "ADMIN" || session?.user?.canReport === true;

  const toggleSelected = useCallback((visitId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(visitId)) {
        next.delete(visitId);
      } else {
        next.add(visitId);
      }
      return next;
    });
  }, []);

  const handleBatchGenerate = useCallback(async () => {
    if (!session?.token || selectedIds.size === 0) return;
    setIsStartingBatch(true);
    setBatchError("");
    try {
      const result = await batchGenerateReports(session.token, [...selectedIds]);
      setBatchItems([
        ...result.accepted.map((entry) => ({
          siteVisitId: entry.siteVisitId,
          label: entry.label,
          phase: "QUEUED" as const,
          detail: `${entry.totalAssets} assets`,
          processed: 0,
          total: entry.totalAssets,
        })),
        ...result.skipped.map((entry) => ({
          siteVisitId: entry.siteVisitId,
          label: entry.label,
          phase: "SKIPPED" as const,
          detail: entry.reason,
          processed: 0,
          total: 0,
        })),
      ]);
      setSelectedIds(new Set());
    } catch (batchStartError) {
      if (batchStartError instanceof ApiError && batchStartError.status === 401) {
        handleLogout();
        return;
      }
      setBatchError(
        batchStartError instanceof Error
          ? batchStartError.message
          : "Unable to start the batch.",
      );
    } finally {
      setIsStartingBatch(false);
    }
  }, [handleLogout, selectedIds, session?.token]);

  const handleBatchDownload = useCallback(async () => {
    if (!session?.token || selectedIds.size === 0) return;
    setIsDownloadingZip(true);
    setBatchError("");
    try {
      await downloadReportsZip(session.token, [...selectedIds]);
    } catch (zipError) {
      if (zipError instanceof ApiError && zipError.status === 401) {
        handleLogout();
        return;
      }
      setBatchError(
        zipError instanceof Error ? zipError.message : "Unable to download the ZIP.",
      );
    } finally {
      setIsDownloadingZip(false);
    }
  }, [handleLogout, selectedIds, session?.token]);

  const handleDefectZipDownload = useCallback(async () => {
    const token = session?.token;
    if (!token || selectedIds.size === 0) return;
    setBatchError("");
    setDefectZipProgress({ processed: 0, total: selectedIds.size });
    try {
      const job = await startDefectReportsZip(token, [...selectedIds]);
      setDefectZipProgress({ processed: 0, total: job.total });
      // Poll until the server-side build finishes; a few transient poll
      // failures are tolerated (network blips must not orphan the job).
      let pollFailures = 0;
      for (;;) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 2500));
        let status;
        try {
          status = await fetchDefectReportsZipStatus(token, job.jobId);
          pollFailures = 0;
        } catch (pollError) {
          if (pollError instanceof ApiError && pollError.status === 401) {
            handleLogout();
            return;
          }
          pollFailures += 1;
          if (pollFailures >= 5) throw pollError;
          continue;
        }
        setDefectZipProgress({
          processed: status.processed,
          total: status.total,
        });
        if (status.status === "COMPLETED") break;
        if (status.status === "FAILED") {
          throw new Error(status.error || "Penjanaan ZIP gagal.");
        }
      }
      await downloadDefectReportsZipFile(token, job.jobId);
    } catch (zipError) {
      if (zipError instanceof ApiError && zipError.status === 401) {
        handleLogout();
        return;
      }
      setBatchError(
        zipError instanceof Error
          ? zipError.message
          : "Unable to download the defect-report ZIP.",
      );
    } finally {
      setDefectZipProgress(null);
    }
  }, [handleLogout, selectedIds, session?.token]);

  // Poll the batch's pending visits until every item is terminal, then refresh
  // the list once so the flipped lifecycles (→ Completed) show without waiting
  // for the 60s auto-refresh.
  useEffect(() => {
    if (!session?.token || !batchItems) {
      return;
    }
    const pendingIds = batchItems
      .filter((item) => !isTerminalBatchPhase(item.phase))
      .map((item) => item.siteVisitId);
    if (pendingIds.length === 0) {
      return;
    }
    const token = session.token;
    const intervalId = window.setInterval(async () => {
      let statuses;
      try {
        statuses = await fetchBatchReportStatus(token, pendingIds);
      } catch {
        return; // transient poll failure — try again next tick
      }
      const byId = new Map(statuses.map((entry) => [entry.siteVisitId, entry]));
      setBatchItems((current) => {
        if (!current) return current;
        let batchFinished = true;
        const next = current.map((item) => {
          if (isTerminalBatchPhase(item.phase)) {
            return item;
          }
          const run = byId.get(item.siteVisitId)?.run;
          const report = byId.get(item.siteVisitId)?.report;
          if (!run) {
            batchFinished = false;
            return item;
          }
          if (run.status === "COMPLETED") {
            return {
              ...item,
              phase: "COMPLETED" as const,
              processed: run.totalAssets,
              detail: report ? `v${report.version} ready` : "Ready",
            };
          }
          if (run.status === "FAILED") {
            return {
              ...item,
              phase: "FAILED" as const,
              detail: run.error ?? "Compile failed.",
            };
          }
          batchFinished = false;
          if (run.status === "RUNNING") {
            return {
              ...item,
              phase: "RUNNING" as const,
              processed: run.processedAssets,
              total: run.totalAssets,
              detail: `${run.processedAssets}/${run.totalAssets} assets`,
            };
          }
          return { ...item, phase: "QUEUED" as const };
        });
        if (batchFinished) {
          void loadVisits(token, false);
        }
        return next;
      });
    }, BATCH_POLL_MS);

    return () => window.clearInterval(intervalId);
  }, [batchItems, loadVisits, session?.token]);

  useEffect(() => {
    if (!autoRefresh || !session?.token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadVisits(session.token, false);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [autoRefresh, loadVisits, session?.token]);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    mainheadFilter,
    pencawangFilter,
    teamFilter,
    memberFilter,
    statusFilter,
    visitTypeFilter,
    operationalDomainFilter,
    assetTypeFilter,
    startDate,
    endDate,
    pageSize,
  ]);

  const teamOptions = useMemo(() => uniqueTeams(visits), [visits]);
  const mainheadOptions = useMemo(
    () =>
      Array.from(
        new Set(visits.map((visit) => displayMainhead(visit)).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [visits],
  );
  const pencawangOptions = useMemo(
    () =>
      Array.from(
        new Set(visits.map((visit) => displayPencawang(visit)).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [visits],
  );

  // Reconcile the data-derived filters against the loaded data: a restored (or
  // auto-refresh-stale) Mainhead/Pencawang/Team value whose option no longer
  // exists would strand the list on an empty result with a blank control, so
  // reset it to "ALL". Gated on loaded visits so it never clears a valid filter
  // during the initial fetch (when the option lists are still empty).
  useEffect(() => {
    if (visits.length === 0) {
      return;
    }
    if (mainheadFilter !== "ALL" && !mainheadOptions.includes(mainheadFilter)) {
      setMainheadFilter("ALL");
    }
    if (pencawangFilter !== "ALL" && !pencawangOptions.includes(pencawangFilter)) {
      setPencawangFilter("ALL");
    }
    if (teamFilter !== "ALL" && !teamOptions.some(([id]) => id === teamFilter)) {
      setTeamFilter("ALL");
    }
  }, [
    visits.length,
    mainheadOptions,
    pencawangOptions,
    teamOptions,
    mainheadFilter,
    pencawangFilter,
    teamFilter,
  ]);

  const filteredVisits = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);
    const normalizedMember = normalizeSearchText(memberFilter);

    return visits.filter((visit) => {
      const visitDate = toDateInputValue(visit.startedAt);
      const matchesSearch =
        !normalizedSearch ||
        [
          displayPencawang(visit),
          displayMainhead(visit),
          visit.functionalLocation,
          displayTeam(visit),
          formatEnum(visit.status),
          formatEnum(visit.validationStatus),
          formatEnum(visit.visitType),
          formatEnum(visit.operationalDomain),
          visit.surveyScope,
          visit.createdBy?.name,
          visit.createdBy?.email,
          visit.teamMembers.map((member) => `${member.name ?? ""} ${member.email ?? ""}`).join(" "),
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));
      const matchesMainhead =
        mainheadFilter === "ALL" || displayMainhead(visit) === mainheadFilter;
      const matchesPencawang =
        pencawangFilter === "ALL" || displayPencawang(visit) === pencawangFilter;
      const matchesTeam = teamFilter === "ALL" || visit.team?.id === teamFilter;
      const matchesMember =
        !normalizedMember ||
        visit.teamMembers.some((member) =>
          normalizeSearchText(`${member.name ?? ""} ${member.email ?? ""}`).includes(
            normalizedMember,
          ),
        );
      const matchesStatus =
        statusFilter === "ALL" || visit.displayStatus === statusFilter;
      const matchesVisitType =
        visitTypeFilter === "ALL" || visit.visitType === visitTypeFilter;
      const matchesOperationalDomain =
        operationalDomainFilter === "ALL" ||
        visit.operationalDomain === operationalDomainFilter;
      const matchesAssetType =
        assetTypeFilter === "ALL" || visit.surveyScope === assetTypeFilter;
      const matchesStartDate = !startDate || (visitDate && visitDate >= startDate);
      const matchesEndDate = !endDate || (visitDate && visitDate <= endDate);

      return (
        matchesSearch &&
        matchesMainhead &&
        matchesPencawang &&
        matchesTeam &&
        matchesMember &&
        matchesStatus &&
        matchesVisitType &&
        matchesOperationalDomain &&
        matchesAssetType &&
        matchesStartDate &&
        matchesEndDate
      );
    });
  }, [
    assetTypeFilter,
    endDate,
    mainheadFilter,
    memberFilter,
    operationalDomainFilter,
    pencawangFilter,
    search,
    startDate,
    statusFilter,
    teamFilter,
    visitTypeFilter,
    visits,
  ]);

  const sortedVisits = useMemo(() => {
    return [...filteredVisits].sort((left, right) => {
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const primarySort =
        compareSortValues(getSortValue(left, sortKey), getSortValue(right, sortKey)) *
        directionMultiplier;

      if (primarySort !== 0) {
        return primarySort;
      }

      return displayPencawang(left).localeCompare(displayPencawang(right), "en", {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [filteredVisits, sortDirection, sortKey]);

  const totalPages = Math.max(1, Math.ceil(sortedVisits.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItemIndex = sortedVisits.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItemIndex = Math.min(currentPage * pageSize, sortedVisits.length);
  const paginatedVisits = sortedVisits.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const isReadOnly = session?.user?.role !== "ADMIN";
  // Batch selection: which rows on this page can be ticked, and whether the
  // header checkbox should read as "all ticked".
  const eligiblePageIds = paginatedVisits
    .filter(isReportEligible)
    .map((visit) => visit.id);
  const allPageSelected =
    eligiblePageIds.length > 0 &&
    eligiblePageIds.every((id) => selectedIds.has(id));
  const batchBusy =
    isStartingBatch || isDownloadingZip || defectZipProgress !== null;
  const batchRunning =
    batchItems !== null &&
    batchItems.some((item) => !isTerminalBatchPhase(item.phase));
  const activeVisitCount = visits.filter((visit) =>
    ["ACTIVE", "OPEN", "IN_PROGRESS"].includes(visit.status),
  ).length;
  const completedVisitCount = visits.filter(
    (visit) => visit.displayStatus === "COMPLETED",
  ).length;
  const averageCompletion =
    visits.length === 0
      ? 0
      : Math.round(
          visits.reduce((total, visit) => total + visit.completionPercentage, 0) /
            visits.length,
        );

  function handleSort(nextSortKey: SortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "lastActivity" || nextSortKey === "startedAt" ? "desc" : "asc",
    );
  }

  function resetFilters() {
    setSearch("");
    setMainheadFilter("ALL");
    setPencawangFilter("ALL");
    setTeamFilter("ALL");
    setMemberFilter("");
    setStatusFilter("ALL");
    setVisitTypeFilter("ALL");
    setOperationalDomainFilter("ALL");
    setAssetTypeFilter("ALL");
    setStartDate("");
    setEndDate("");
  }

  function openVisit(visitId: string) {
    router.push(`/site-visits/${encodeURIComponent(visitId)}`);
  }

  function updateCreateForm<K extends keyof SiteVisitCreateForm>(
    field: K,
    value: SiteVisitCreateForm[K],
  ) {
    setCreateForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function openCreateModal() {
    setModalError("");
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    if (isSavingCreate) {
      return;
    }

    setIsCreateModalOpen(false);
    setModalError("");
  }

  async function handleCreateSiteVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session?.token || isReadOnly) {
      return;
    }

    const hasExistingSubstation = Boolean(createForm.substationId);

    if (!createForm.mainheadId) {
      setModalError("MAINHEAD must be selected.");
      return;
    }

    const payload: Record<string, unknown> = {
      teamId: createForm.teamId,
      visitType: createForm.visitType,
      substationId: hasExistingSubstation ? createForm.substationId : undefined,
      pencawangCode: createForm.pencawangCode.trim() || undefined,
      pencawangName: createForm.pencawangName.trim() || undefined,
      functionalLocation: createForm.functionalLocation.trim() || undefined,
      mainheadId: createForm.mainheadId,
      projectId: createForm.projectId || undefined,
      workPackageId: createForm.workPackageId || undefined,
      operationalDomain: createForm.operationalDomain || undefined,
      notes: createForm.notes.trim() || undefined,
    };

    if (!hasExistingSubstation) {
      const missing = [
        ["pencawangCode", "Kod Pencawang"],
        ["pencawangName", "Nama Pencawang"],
        ["functionalLocation", "Functional Location"],
      ].filter(([key]) => !String(payload[key] ?? "").trim());

      if (missing.length > 0) {
        setModalError(`Missing: ${missing.map(([, label]) => label).join(", ")}`);
        return;
      }
    }

    setIsSavingCreate(true);
    setModalError("");
    setError("");

    try {
      const createdVisit = await createSiteVisit(session.token, payload);
      setVisits((currentVisits) => [createdVisit, ...currentVisits]);
      setCreateForm((currentForm) => ({
        ...DEFAULT_SITE_VISIT_CREATE_FORM,
        teamId: currentForm.teamId,
      }));
      closeCreateModal();
      setLastRefreshedAt(new Date());
    } catch (createError) {
      if (createError instanceof ApiError && createError.status === 401) {
        handleLogout();
        return;
      }

      setModalError(createError instanceof Error ? createError.message : "Unable to create visit.");
    } finally {
      setIsSavingCreate(false);
    }
  }

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Operations Control"
            title="Site Visits"
            subtitle={
              <>
                Live visit monitoring across teams, assets, progress, defects, and validation.
                {isReadOnly ? " Read-only session." : " Admin session."}
              </>
            }
            chips={
              <>
                <Chip tone="success" dot>
                  Operations Live
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
                <Chip tone="neutral">{formatRefreshTime(lastRefreshedAt)}</Chip>
                <Chip tone="neutral">{visits.length} visits</Chip>
              </>
            }
            actions={
              <>
                <Tbtn
                  onClick={() => (session?.token ? loadVisits(session.token, false) : undefined)}
                  disabled={(isLoading && visits.length === 0) || isRefreshing || !session?.token}
                >
                  <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
                <Tbtn variant="primary" onClick={openCreateModal} disabled={isReadOnly}>
                  <Plus size={16} />
                  Create Visit
                </Tbtn>
              </>
            }
          />

          <div className="mt-6">
            {isLoading && visits.length === 0 ? (
              <SiteVisitsLoading />
            ) : error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-5 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  <KpiCard
                    label="Active"
                    value={activeVisitCount}
                    icon={Activity}
                    tone="brand"
                    context={`of ${visits.length} tracked`}
                  />
                  <KpiCard
                    label="Completion"
                    value={`${averageCompletion}%`}
                    icon={CalendarDays}
                    context={<ProgressBar value={averageCompletion} showLabel={false} />}
                  />
                  <KpiCard
                    label="Completed"
                    value={completedVisitCount}
                    icon={ShieldCheck}
                    tone="success"
                    context={`of ${visits.length} tracked`}
                  />
                </div>

                <Card padded={false}>
                  <div className="border-b border-[var(--line2)] p-[18px]">
                    <FilterBar>
                      <SearchField
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search visits, teams, users"
                        aria-label="Search site visits"
                      />

                      <select
                        aria-label="Status"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                        className={filterSelectClass}
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Visit type"
                        value={visitTypeFilter}
                        onChange={(event) =>
                          setVisitTypeFilter(event.target.value as VisitTypeFilter)
                        }
                        className={filterSelectClass}
                      >
                        {VISIT_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Operational domain"
                        value={operationalDomainFilter}
                        onChange={(event) =>
                          setOperationalDomainFilter(
                            event.target.value as OperationalDomainFilter,
                          )
                        }
                        className={filterSelectClass}
                      >
                        {OPERATIONAL_DOMAIN_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Asset type"
                        value={assetTypeFilter}
                        onChange={(event) =>
                          setAssetTypeFilter(event.target.value as AssetTypeFilter)
                        }
                        className={filterSelectClass}
                      >
                        {ASSET_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Team"
                        value={teamFilter}
                        onChange={(event) => setTeamFilter(event.target.value)}
                        className={filterSelectClass}
                      >
                        <option value="ALL">All teams</option>
                        {teamOptions.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        aria-label="Team member"
                        value={memberFilter}
                        onChange={(event) => setMemberFilter(event.target.value)}
                        placeholder="Team member"
                        className={`${filterControlClass} w-[150px]`}
                      />

                      <select
                        aria-label="MAINHEAD"
                        value={mainheadFilter}
                        onChange={(event) => setMainheadFilter(event.target.value)}
                        className={filterSelectClass}
                      >
                        <option value="ALL">All MAINHEAD</option>
                        {mainheadOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Pencawang"
                        value={pencawangFilter}
                        onChange={(event) => setPencawangFilter(event.target.value)}
                        className={filterSelectClass}
                      >
                        <option value="ALL">All Pencawang</option>
                        {pencawangOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>

                      <input
                        type="date"
                        aria-label="Start date"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                        className={filterSelectClass}
                      />

                      <input
                        type="date"
                        aria-label="End date"
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                        className={filterSelectClass}
                      />

                      <Tbtn variant="ghost" onClick={resetFilters}>
                        <X size={16} />
                        Reset
                      </Tbtn>
                    </FilterBar>
                  </div>

                  {canBatchReport && selectedIds.size > 0 ? (
                    <div className="flex flex-wrap items-center gap-2.5 border-t border-[var(--line2)] bg-[var(--brand-tint)] px-5 py-2.5">
                      <span className="text-[12.5px] font-semibold text-[var(--foreground)]">
                        {selectedIds.size} selected
                        {selectedIds.size > DEFECT_ZIP_MAX
                          ? ` — max ${DEFECT_ZIP_MAX} per batch`
                          : selectedIds.size > BATCH_REPORT_MAX
                            ? ` — compiled-report batch max ${BATCH_REPORT_MAX}; Laporan Kejanggalan up to ${DEFECT_ZIP_MAX}`
                            : ""}
                      </span>
                      <Tbtn
                        onClick={() => void handleBatchGenerate()}
                        disabled={
                          batchBusy ||
                          batchRunning ||
                          selectedIds.size > BATCH_REPORT_MAX
                        }
                        title="Compile the report of every selected survey, one at a time"
                      >
                        {isStartingBatch ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <FileText size={15} />
                        )}
                        Generate reports
                      </Tbtn>
                      <Tbtn
                        onClick={() => void handleBatchDownload()}
                        disabled={batchBusy || selectedIds.size > BATCH_REPORT_MAX}
                        title="Download the latest compiled report of every selected survey as one ZIP"
                      >
                        {isDownloadingZip ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Download size={15} />
                        )}
                        Download ZIP
                      </Tbtn>
                      <Tbtn
                        onClick={() => void handleDefectZipDownload()}
                        disabled={batchBusy || selectedIds.size > DEFECT_ZIP_MAX}
                        title={`Generate the Laporan Kejanggalan of every selected survey (max ${DEFECT_ZIP_MAX}) as one ZIP — built in the background, downloads when ready`}
                      >
                        {defectZipProgress ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Download size={15} />
                        )}
                        {defectZipProgress
                          ? `Menjana… ${defectZipProgress.processed}/${defectZipProgress.total}`
                          : "Laporan Kejanggalan (ZIP)"}
                      </Tbtn>
                      <Tbtn variant="ghost" onClick={() => setSelectedIds(new Set())}>
                        Clear
                      </Tbtn>
                      {batchError ? (
                        <span className="text-[12px] font-medium text-[var(--critical-text)]">
                          {batchError}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {batchItems ? (
                    <div className="border-t border-[var(--line2)] px-5 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--foreground)]">
                          {batchRunning ? (
                            <Loader2 size={14} className="animate-spin text-[var(--brand-strong)]" />
                          ) : (
                            <CheckCircle2 size={14} className="text-[var(--success-text)]" />
                          )}
                          Batch report generation —{" "}
                          {batchItems.filter((item) => isTerminalBatchPhase(item.phase)).length}
                          /{batchItems.length} finished
                        </div>
                        <Tbtn
                          variant="ghost"
                          onClick={() => setBatchItems(null)}
                          disabled={batchRunning}
                          title={
                            batchRunning
                              ? "The batch is still running on the server"
                              : undefined
                          }
                        >
                          <X size={14} />
                          Close
                        </Tbtn>
                      </div>
                      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {batchItems.map((item) => (
                          <li
                            key={item.siteVisitId}
                            className="flex min-w-0 items-center gap-2 text-[12.5px]"
                          >
                            <Chip tone={batchPhaseTone(item.phase)} dot>
                              {BATCH_PHASE_LABELS[item.phase]}
                            </Chip>
                            <span
                              className="truncate font-medium text-[var(--foreground)]"
                              title={item.label}
                            >
                              {item.label}
                            </span>
                            <span className="shrink-0 text-[var(--muted-2)]">{item.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1120px] table-fixed text-left">
                      <colgroup>
                        {canBatchReport ? <col className="w-[4%]" /> : null}
                        <col className="w-[11%]" />
                        <col className="w-[18%]" />
                        <col className="w-[12%]" />
                        <col className="w-[11%]" />
                        <col className="w-[18%]" />
                        <col className="w-[12%]" />
                        <col className="w-[14%]" />
                      </colgroup>
                      <thead>
                        <tr className={`border-b border-[var(--line)] ${tableHeadClass}`}>
                          {canBatchReport ? (
                            <th className={tableHeadCellClass}>
                              <input
                                type="checkbox"
                                aria-label="Select every report-ready survey on this page"
                                checked={allPageSelected}
                                disabled={eligiblePageIds.length === 0}
                                onChange={() =>
                                  setSelectedIds((current) => {
                                    const next = new Set(current);
                                    if (allPageSelected) {
                                      for (const id of eligiblePageIds) next.delete(id);
                                    } else {
                                      for (const id of eligiblePageIds) next.add(id);
                                    }
                                    return next;
                                  })
                                }
                                className="h-4 w-4 cursor-pointer accent-[var(--brand-strong)]"
                              />
                            </th>
                          ) : null}
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Status"
                              sortKey="status"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Pencawang"
                              sortKey="pencawang"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Mainhead"
                              sortKey="mainhead"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Team"
                              sortKey="team"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Progress"
                              sortKey="progress"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Defects"
                              sortKey="defects"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className={tableHeadCellClass}>
                            <SortButton
                              label="Last Activity"
                              sortKey="lastActivity"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedVisits.map((visit) => (
                          <tr
                            key={visit.id}
                            tabIndex={0}
                            onClick={() => openVisit(visit.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openVisit(visit.id);
                              }
                            }}
                            className={`${tableRowClass} cursor-pointer outline-none last:border-b-0 focus-visible:bg-[var(--brand-tint)]`}
                            aria-label={`Open site visit ${displayPencawang(visit)}`}
                          >
                            {canBatchReport ? (
                              <td
                                className={tableCellClass}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                {isReportEligible(visit) ? (
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${displayPencawang(visit)} for batch reports`}
                                    checked={selectedIds.has(visit.id)}
                                    onChange={() => toggleSelected(visit.id)}
                                    className="h-4 w-4 cursor-pointer accent-[var(--brand-strong)]"
                                  />
                                ) : null}
                              </td>
                            ) : null}
                            <td className={tableCellClass}>
                              <StatusBadge
                                displayStatus={visit.displayStatus}
                                label={visit.displayStatusLabel}
                              />
                            </td>
                            <td className={tableCellClass}>
                              <div className="min-w-0">
                                <div
                                  className="truncate font-semibold text-[var(--foreground)]"
                                  title={displayPencawang(visit)}
                                >
                                  {displayPencawang(visit)}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11.5px] text-[var(--muted-2)]">
                                  <span>
                                    {formatEnum(visit.visitType)} / Cycle{" "}
                                    {visit.cycleNumber ?? "N/A"}
                                  </span>
                                  {visit.operationalDomain !== "UNSPECIFIED" ? (
                                    <span>{formatEnum(visit.operationalDomain)}</span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className={tableCellClass}>
                              <div className="truncate" title={displayMainhead(visit)}>
                                {displayMainhead(visit)}
                              </div>
                            </td>
                            <td className={tableCellClass}>
                              <div
                                className="truncate font-medium text-[var(--foreground)]"
                                title={displayTeam(visit)}
                              >
                                {displayTeam(visit)}
                              </div>
                              <div className={tableSublineClass}>
                                {visit.teamMembers.length} members
                              </div>
                            </td>
                            <td className={tableCellClass}>
                              <ProgressBar value={visit.completionPercentage} width={130} />
                              <div className={`${tableSublineClass} font-mono`}>
                                {visit.inspectedAssets}/{visit.totalAssets} assets
                              </div>
                            </td>
                            <td className={tableCellClass}>
                              <DefectChip count={visit.defectsFound} />
                            </td>
                            <td className={tableCellClass}>
                              <ActivityStatus date={visit.lastActivityAt} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {paginatedVisits.length === 0 ? (
                    <div className="border-t border-[var(--line2)] px-5 py-12 text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[9px] border border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]">
                        <SlidersHorizontal size={20} />
                      </div>
                      <p className="mt-4 text-[13px] font-semibold text-[var(--foreground)]">
                        No site visits found
                      </p>
                    </div>
                  ) : null}

                  <TableFooter
                    summary={`Showing ${firstItemIndex}-${lastItemIndex} of ${sortedVisits.length}`}
                    page={currentPage}
                    pageCount={totalPages}
                    onPageChange={setPage}
                  >
                    <label className="inline-flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
                      Rows
                      <select
                        aria-label="Rows per page"
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value))}
                        className={`${filterSelectClass} !h-[34px]`}
                      >
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </TableFooter>
                </Card>
              </div>
            )}
          </div>
        </div>
      </main>

      {isCreateModalOpen ? (
        <SiteVisitCreateModal
          values={createForm}
          teams={teams}
          substations={substations}
          enterpriseOptions={enterpriseOptions}
          error={modalError}
          isSaving={isSavingCreate}
          onChange={updateCreateForm}
          onClose={closeCreateModal}
          onSubmit={handleCreateSiteVisit}
        />
      ) : null}
    </AppShell>
  );
}

export function SiteVisitsClient() {
  return (
    <AuthGuard>
      <SiteVisitsContent />
    </AuthGuard>
  );
}
