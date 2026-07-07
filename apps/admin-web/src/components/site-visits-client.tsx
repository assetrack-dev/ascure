"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseOptions } from "@/lib/enterprise";
import { fetchTeams } from "@/lib/users";
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
  SiteVisitValidationStatus,
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
type ValidationFilter = "ALL" | SiteVisitValidationStatus;
type VisitTypeFilter = "ALL" | SiteVisitType;
type OperationalDomainFilter = "ALL" | OperationalDomain;

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
const VALIDATION_OPTIONS: Array<{ label: string; value: ValidationFilter }> = [
  { label: "All validation", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Validated", value: "VALIDATED" },
  { label: "Warning", value: "WARNING" },
  { label: "Failed", value: "FAILED" },
];
const VISIT_TYPE_OPTIONS: Array<{ label: string; value: VisitTypeFilter }> = [
  { label: "All types", value: "ALL" },
  { label: "Discovery", value: "DISCOVERY" },
  { label: "Reinspection", value: "REINSPECTION" },
  { label: "Special", value: "SPECIAL" },
  { label: "Audit", value: "AUDIT" },
  { label: "Unspecified", value: "UNSPECIFIED" },
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
const filterControlClassName =
  "h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const searchControlClassName =
  "h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)]";
const primaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300";
const paginationButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const filterLabelClassName =
  "mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500";
const filterFieldClassName = "block min-w-0";

function SiteVisitsLoading() {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
      <div className="mt-5 h-10 w-full animate-pulse rounded-md bg-slate-100" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
        ))}
      </div>
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
  return (
    [visit.pencawangCode, visit.pencawangName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" - ") || "Not recorded"
  );
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

function activityIndicatorClassName(date: string | null | undefined) {
  const timestamp = parseTimestamp(date);

  if (!timestamp) {
    return "bg-slate-300";
  }

  const diffHours = (Date.now() - timestamp) / 3600000;

  if (diffHours <= 1) {
    return "bg-emerald-500";
  }

  if (diffHours <= 24) {
    return "bg-amber-500";
  }

  return "bg-slate-400";
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

function formatValidationLabel(status: SiteVisitValidationStatus) {
  if (status === "PENDING" || status === "UNKNOWN") {
    return "Awaiting Validation";
  }

  return formatEnum(status);
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

const DISPLAY_STATUS_TONE: Record<DisplayStatus, { badge: string; dot: string }> = {
  NOT_STARTED: { badge: "border-slate-200 bg-slate-50 text-slate-600", dot: "bg-slate-400" },
  IN_PROGRESS: { badge: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  NEEDS_AMENDMENT: { badge: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  IN_REVIEW: { badge: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  COMPLETED: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  ARCHIVED: { badge: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-500" },
  CANCELLED: { badge: "border-slate-200 bg-slate-50 text-slate-500", dot: "bg-slate-400" },
};

function StatusBadge({
  displayStatus,
  label,
}: {
  displayStatus: DisplayStatus;
  label: string;
}) {
  const tone = DISPLAY_STATUS_TONE[displayStatus] ?? DISPLAY_STATUS_TONE.IN_PROGRESS;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {label}
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
      {formatValidationLabel(status)}
    </span>
  );
}

function ProgressBar({ percentage }: { percentage: number }) {
  const boundedPercentage = Math.min(Math.max(percentage, 0), 100);

  return (
    <div className="w-full min-w-0">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
        <span>{boundedPercentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${boundedPercentage}%` }}
        />
      </div>
    </div>
  );
}

function DefectChip({ count }: { count: number }) {
  const hasDefects = count > 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${
        hasDefects
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {hasDefects ? <AlertTriangle size={13} /> : null}
      {hasDefects ? `${count.toLocaleString()} defect${count === 1 ? "" : "s"}` : "0 defects"}
    </span>
  );
}

function ActivityStatus({ date }: { date: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${activityIndicatorClassName(date)}`}
        />
        <span className="truncate">{formatRelativeActivity(date)}</span>
      </div>
      {date ? (
        <div className="mt-1 truncate text-xs text-[var(--muted)]">{formatDateTime(date)}</div>
      ) : null}
    </div>
  );
}

function OperationalStat({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  progress,
}: {
  label: string;
  value: number | string;
  icon: typeof Activity;
  tone?: "neutral" | "success" | "warning" | "danger" | "live" | "progress";
  progress?: number;
}) {
  const styles =
    tone === "danger"
      ? {
          card: "border-red-200 bg-red-50/50 shadow-red-100/60",
          icon: "border-red-200 bg-white text-red-700",
          signal: "bg-red-500",
          bar: "bg-red-600",
        }
      : tone === "warning"
        ? {
            card: "border-amber-200 bg-amber-50/60 shadow-amber-100/60",
            icon: "border-amber-200 bg-white text-amber-800",
            signal: "bg-amber-500",
            bar: "bg-amber-500",
          }
        : tone === "success"
          ? {
              card: "border-emerald-200 bg-emerald-50/50 shadow-emerald-100/60",
              icon: "border-emerald-200 bg-white text-emerald-700",
              signal: "bg-emerald-500",
              bar: "bg-emerald-600",
            }
          : tone === "live"
            ? {
                card: "border-teal-200 bg-teal-50/50 shadow-teal-100/60",
                icon: "border-teal-200 bg-white text-teal-700",
                signal: "bg-emerald-500",
                bar: "bg-[var(--brand)]",
              }
            : tone === "progress"
              ? {
                  card: "border-slate-200 bg-white",
                  icon: "border-teal-200 bg-teal-50 text-teal-700",
                  signal: "bg-[var(--brand)]",
                  bar: "bg-[var(--brand)]",
                }
              : {
                  card: "border-[var(--line)] bg-white",
                  icon: "border-slate-200 bg-slate-50 text-slate-700",
                  signal: "bg-slate-400",
                  bar: "bg-slate-500",
                };
  const boundedProgress =
    typeof progress === "number" ? Math.min(Math.max(progress, 0), 100) : null;

  return (
    <div className={`rounded-xl border p-4 shadow-[var(--shadow-soft)] ${styles.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${styles.signal}`} />
          <p className="text-xs font-bold uppercase text-[var(--muted)]">{label}</p>
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${styles.icon}`}>
          <Icon size={17} />
        </div>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-950">{value}</p>
      {boundedProgress !== null ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${styles.bar}`}
            style={{ width: `${boundedProgress}%` }}
          />
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
      className="inline-flex items-center gap-1 text-left font-semibold text-slate-600 transition hover:text-[var(--brand)]"
    >
      {label}
      <ChevronsUpDown size={14} className={isActive ? "text-[var(--brand)]" : "text-slate-400"} />
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
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand)]">
              Site Visit
            </p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">
              Create Site Visit
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
            aria-label="Close site visit modal"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Team</span>
              <select
                value={values.teamId}
                onChange={(event) => onChange("teamId", event.target.value)}
                required
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Visit Type</span>
              <select
                value={values.visitType}
                onChange={(event) =>
                  onChange("visitType", event.target.value as SiteVisitCreateForm["visitType"])
                }
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Existing Pencawang</span>
              <select
                value={values.substationId}
                onChange={(event) => onChange("substationId", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Domain</span>
              <select
                value={values.operationalDomain}
                onChange={(event) => onChange("operationalDomain", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Kod Pencawang</span>
              <input
                type="text"
                value={values.pencawangCode}
                onChange={(event) => onChange("pencawangCode", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Nama Pencawang</span>
              <input
                type="text"
                value={values.pencawangName}
                onChange={(event) => onChange("pencawangName", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Functional Location</span>
              <input
                type="text"
                value={values.functionalLocation}
                onChange={(event) => onChange("functionalLocation", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">MAINHEAD</span>
              <select
                value={values.mainheadId}
                onChange={(event) => onChange("mainheadId", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Project</span>
              <select
                value={values.projectId}
                onChange={(event) => onChange("projectId", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
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
              <span className="text-sm font-semibold text-slate-700">Work Package</span>
              <select
                value={values.workPackageId}
                onChange={(event) => onChange("workPackageId", event.target.value)}
                className={`${filterControlClassName} mt-1.5`}
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
            <span className="text-sm font-semibold text-slate-700">Notes</span>
            <textarea
              value={values.notes}
              onChange={(event) => onChange("notes", event.target.value)}
              rows={3}
              className={`${filterControlClassName} mt-1.5 h-auto resize-none py-2`}
            />
          </label>

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondaryButtonClassName}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={primaryButtonClassName}>
              <CheckCircle2 size={16} />
              {isSaving ? "Saving" : "Create Site Visit"}
            </button>
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
  const [mainheadFilter, setMainheadFilter] = useState("");
  const [pencawangFilter, setPencawangFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [memberFilter, setMemberFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>("ALL");
  const [visitTypeFilter, setVisitTypeFilter] = useState<VisitTypeFilter>("ALL");
  const [operationalDomainFilter, setOperationalDomainFilter] =
    useState<OperationalDomainFilter>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lastActivity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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
    validationFilter,
    visitTypeFilter,
    operationalDomainFilter,
    startDate,
    endDate,
    pageSize,
  ]);

  const teamOptions = useMemo(() => uniqueTeams(visits), [visits]);

  const filteredVisits = useMemo(() => {
    const normalizedSearch = normalizeSearchText(search);
    const normalizedMainhead = normalizeSearchText(mainheadFilter);
    const normalizedPencawang = normalizeSearchText(pencawangFilter);
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
          visit.createdBy?.name,
          visit.createdBy?.email,
          visit.teamMembers.map((member) => `${member.name ?? ""} ${member.email ?? ""}`).join(" "),
        ].some((value) => normalizeSearchText(value).includes(normalizedSearch));
      const matchesMainhead =
        !normalizedMainhead ||
        normalizeSearchText(displayMainhead(visit)).includes(normalizedMainhead);
      const matchesPencawang =
        !normalizedPencawang ||
        normalizeSearchText(displayPencawang(visit)).includes(normalizedPencawang);
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
      const matchesValidation =
        validationFilter === "ALL" || visit.validationStatus === validationFilter;
      const matchesVisitType =
        visitTypeFilter === "ALL" || visit.visitType === visitTypeFilter;
      const matchesOperationalDomain =
        operationalDomainFilter === "ALL" ||
        visit.operationalDomain === operationalDomainFilter;
      const matchesStartDate = !startDate || (visitDate && visitDate >= startDate);
      const matchesEndDate = !endDate || (visitDate && visitDate <= endDate);

      return (
        matchesSearch &&
        matchesMainhead &&
        matchesPencawang &&
        matchesTeam &&
        matchesMember &&
        matchesStatus &&
        matchesValidation &&
        matchesVisitType &&
        matchesOperationalDomain &&
        matchesStartDate &&
        matchesEndDate
      );
    });
  }, [
    endDate,
    mainheadFilter,
    memberFilter,
    operationalDomainFilter,
    pencawangFilter,
    search,
    startDate,
    statusFilter,
    teamFilter,
    validationFilter,
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
  const activeVisitCount = visits.filter((visit) =>
    ["ACTIVE", "OPEN", "IN_PROGRESS"].includes(visit.status),
  ).length;
  const activeTeamCount = new Set(
    visits
      .filter((visit) => ["ACTIVE", "OPEN", "IN_PROGRESS"].includes(visit.status))
      .map((visit) => visit.team?.id ?? visit.team?.code ?? visit.team?.name)
      .filter((teamIdentifier): teamIdentifier is string => Boolean(teamIdentifier)),
  ).size;
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
    setMainheadFilter("");
    setPencawangFilter("");
    setTeamFilter("ALL");
    setMemberFilter("");
    setStatusFilter("ALL");
    setValidationFilter("ALL");
    setVisitTypeFilter("ALL");
    setOperationalDomainFilter("ALL");
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
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-[92rem]">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">
                Operations Control
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Site Visits
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Live visit monitoring across teams, assets, progress, defects, and validation.
                {isReadOnly ? " Read-only session." : " Admin session."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700 shadow-[var(--shadow-soft)]">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Operations Live
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
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {formatRefreshTime(lastRefreshedAt)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  {visits.length} visits
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (session?.token ? loadVisits(session.token, false) : undefined)}
                disabled={(isLoading && visits.length === 0) || isRefreshing || !session?.token}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              >
                <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                disabled={isReadOnly}
                className={primaryButtonClassName}
              >
                <Plus size={16} />
                Create Visit
              </button>
            </div>
          </div>

          <div className="mt-6">
            {isLoading && visits.length === 0 ? (
              <SiteVisitsLoading />
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  <OperationalStat
                    label="Active"
                    value={activeVisitCount}
                    icon={Activity}
                    tone="live"
                  />
                  <OperationalStat
                    label="Completion"
                    value={`${averageCompletion}%`}
                    icon={CalendarDays}
                    tone="progress"
                    progress={averageCompletion}
                  />
                  <OperationalStat
                    label="Completed"
                    value={completedVisitCount}
                    icon={ShieldCheck}
                    tone="success"
                  />
                </div>

                <div className="grid gap-6 2xl:grid-cols-4">
                  <section className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)] 2xl:col-span-3">
                  <div className="border-b border-slate-200 p-5">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))]">
                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Search</span>
                          <span className="relative block">
                            <Search
                              size={17}
                              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                              type="search"
                              value={search}
                              onChange={(event) => setSearch(event.target.value)}
                              placeholder="Search visits, teams, users"
                              className={searchControlClassName}
                            />
                          </span>
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Status</span>
                          <select
                            value={statusFilter}
                            onChange={(event) =>
                              setStatusFilter(event.target.value as StatusFilter)
                            }
                            className={filterControlClassName}
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Validation</span>
                          <select
                            value={validationFilter}
                            onChange={(event) =>
                              setValidationFilter(event.target.value as ValidationFilter)
                            }
                            className={filterControlClassName}
                          >
                            {VALIDATION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Visit Type</span>
                          <select
                            value={visitTypeFilter}
                            onChange={(event) =>
                              setVisitTypeFilter(event.target.value as VisitTypeFilter)
                            }
                            className={filterControlClassName}
                          >
                            {VISIT_TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Domain</span>
                          <select
                            value={operationalDomainFilter}
                            onChange={(event) =>
                              setOperationalDomainFilter(
                                event.target.value as OperationalDomainFilter,
                              )
                            }
                            className={filterControlClassName}
                          >
                            {OPERATIONAL_DOMAIN_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1.7fr)_repeat(5,minmax(0,1fr))]">
                        <div className="min-w-0">
                          <span className={filterLabelClassName}>Team/User</span>
                          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                            <label className={filterFieldClassName}>
                              <span className="sr-only">Team</span>
                              <select
                                value={teamFilter}
                                onChange={(event) => setTeamFilter(event.target.value)}
                                className={filterControlClassName}
                              >
                                <option value="ALL">All teams</option>
                                {teamOptions.map(([id, label]) => (
                                  <option key={id} value={id}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={filterFieldClassName}>
                              <span className="sr-only">Team member</span>
                              <input
                                type="text"
                                value={memberFilter}
                                onChange={(event) => setMemberFilter(event.target.value)}
                                placeholder="User"
                                className={filterControlClassName}
                              />
                            </label>
                          </div>
                        </div>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>MAINHEAD</span>
                          <input
                            type="text"
                            value={mainheadFilter}
                            onChange={(event) => setMainheadFilter(event.target.value)}
                            placeholder="MAINHEAD"
                            className={filterControlClassName}
                          />
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Pencawang</span>
                          <input
                            type="text"
                            value={pencawangFilter}
                            onChange={(event) => setPencawangFilter(event.target.value)}
                            placeholder="Pencawang"
                            className={filterControlClassName}
                          />
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Date From</span>
                          <input
                            type="date"
                            value={startDate}
                            onChange={(event) => setStartDate(event.target.value)}
                            className={filterControlClassName}
                          />
                        </label>

                        <label className={filterFieldClassName}>
                          <span className={filterLabelClassName}>Date To</span>
                          <input
                            type="date"
                            value={endDate}
                            onChange={(event) => setEndDate(event.target.value)}
                            className={filterControlClassName}
                          />
                        </label>

                        <button
                          type="button"
                          onClick={resetFilters}
                          className={`${secondaryButtonClassName} w-full self-end xl:w-auto`}
                        >
                          <X size={16} />
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto xl:overflow-visible">
                    <table className="w-full min-w-[920px] table-fixed text-left text-sm xl:min-w-0">
                      <colgroup>
                        <col className="w-[9%]" />
                        <col className="w-[22%]" />
                        <col className="w-[13%]" />
                        <col className="w-[13%]" />
                        <col className="w-[9%]" />
                        <col className="w-[12%]" />
                        <col className="w-[13%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-600">
                          <th className="px-3 py-3.5">
                            <SortButton
                              label="Status"
                              sortKey="status"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-3.5">
                            <SortButton
                              label="Pencawang"
                              sortKey="pencawang"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-3.5">
                            <SortButton
                              label="Team"
                              sortKey="team"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-3.5">
                            <SortButton
                              label="Progress"
                              sortKey="progress"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-3.5">
                            <SortButton
                              label="Defects"
                              sortKey="defects"
                              activeSortKey={sortKey}
                              direction={sortDirection}
                              onSort={handleSort}
                            />
                          </th>
                          <th className="px-3 py-3.5">Validation</th>
                          <th className="px-3 py-3.5">
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
                      <tbody className="divide-y divide-slate-100">
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
                            className="cursor-pointer outline-none transition hover:bg-teal-50/40 focus-visible:bg-teal-50/40"
                            aria-label={`Open site visit ${displayPencawang(visit)}`}
                          >
                            <td className="px-3 py-4 align-top">
                              <StatusBadge
                                displayStatus={visit.displayStatus}
                                label={visit.displayStatusLabel}
                              />
                            </td>
                            <td className="px-3 py-4 align-top">
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-900">
                                  {displayPencawang(visit)}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                                  <span>{displayMainhead(visit)}</span>
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
                            <td className="px-3 py-4 align-top text-slate-700">
                              <div className="truncate font-medium text-slate-900">
                                {displayTeam(visit)}
                              </div>
                              <div className="mt-1 truncate text-xs text-[var(--muted)]">
                                {visit.teamMembers.length} members
                              </div>
                            </td>
                            <td className="px-3 py-4 align-top">
                              <ProgressBar percentage={visit.completionPercentage} />
                              <div className="mt-1 truncate text-xs text-slate-500">
                                {visit.inspectedAssets}/{visit.totalAssets} assets
                              </div>
                            </td>
                            <td className="px-3 py-4 align-top">
                              <DefectChip count={visit.defectsFound} />
                            </td>
                            <td className="px-3 py-4 align-top">
                              <ValidationBadge status={visit.validationStatus} />
                            </td>
                            <td className="px-3 py-4 align-top text-slate-600">
                              <ActivityStatus date={visit.lastActivityAt} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {paginatedVisits.length === 0 ? (
                      <div className="border-t border-slate-100 px-5 py-12 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500">
                          <SlidersHorizontal size={20} />
                        </div>
                        <p className="mt-4 text-sm font-semibold text-slate-900">
                          No site visits found
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-[var(--muted)]">
                      Showing {firstItemIndex}-{lastItemIndex} of {sortedVisits.length}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                        Rows
                        <select
                          value={pageSize}
                          onChange={(event) => setPageSize(Number(event.target.value))}
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100"
                        >
                          {PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setPage((currentPageNumber) =>
                              Math.max(1, currentPageNumber - 1),
                            )
                          }
                          disabled={currentPage === 1}
                          className={paginationButtonClassName}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={17} />
                        </button>
                        <span className="min-w-20 text-center text-sm font-semibold text-slate-700">
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPage((currentPageNumber) =>
                              Math.min(totalPages, currentPageNumber + 1),
                            )
                          }
                          disabled={currentPage === totalPages}
                          className={paginationButtonClassName}
                          aria-label="Next page"
                        >
                          <ChevronRight size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                  </section>

                  <aside className="hidden 2xl:col-span-1 2xl:block">
                    <div className="sticky top-6 rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase text-[var(--muted)]">
                            GIS Operations Slot
                          </p>
                          <h2 className="mt-1 text-lg font-bold text-slate-950">
                            Map Panel Ready
                          </h2>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-200 bg-teal-50 text-teal-700">
                          <Activity size={17} />
                        </div>
                      </div>

                      <div className="mt-5 h-56 overflow-hidden rounded-lg border border-dashed border-slate-300 bg-[linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:24px_24px]">
                        <div className="flex h-full items-center justify-center bg-white/55 p-5 text-center">
                          <div>
                            <p className="text-sm font-bold text-slate-900">Operational layer</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                              Reserved for visit overlays, field team traces, and validation alerts.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-3">
                        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                            <Users size={14} />
                            Active teams
                          </span>
                          <span className="text-sm font-bold text-slate-950">
                            {activeTeamCount}
                          </span>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="text-xs font-semibold text-slate-600">
                            Visible visits
                          </span>
                          <span className="text-sm font-bold text-slate-950">
                            {sortedVisits.length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
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
