"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileSpreadsheet,
  Hourglass,
  Users,
  List,
  Map as MapIcon,
  MapPinOff,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  SquareDashedMousePointer,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { PackageMapPoint } from "@/components/maintenance-packages-map";
import { AddFindingDialog } from "@/components/maintenance-add-finding-dialog";
import { PoleSplitDialog } from "@/components/maintenance-pole-split-dialog";
import { RepairReportDialog } from "@/components/maintenance-repair-report-dialog";
import { MaterialsSummaryDialog } from "@/components/materials-summary-dialog";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DestinationSelect,
  DialogFrame,
  ErrorBanner,
  LegendDot,
  checkboxClass,
  decodeDestination,
  encodeDestination,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
  routingMessage,
  routingParts,
} from "@/components/maintenance-packages-shared";
import {
  Card,
  Chip,
  Eyebrow,
  FilterBar,
  IconBtn,
  KpiCard,
  PageHeader,
  SearchField,
  Seg,
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
import {
  assignEmergency,
  assignMaintenancePackage,
  assignMaintenancePackagesBulk,
  fetchMaintenancePackageBoard,
  withdrawMaintenancePackage,
} from "@/lib/maintenance-packages";
import type { AuthSession } from "@/types/auth";
import type {
  BulkAssignResult,
  MaintenanceCategory,
  MaintenancePackageBoard,
  MaintenancePackageRecord,
  PackageActorKind,
  PackageCompany,
  PackageDestination,
  PackagePencawang,
  PackageProgress,
  PackageTeam,
  RoutingResult,
} from "@/types/maintenance-packages";

// Client-side only — Google Maps cannot render during SSR.
const MaintenancePackagesMap = dynamic(() => import("@/components/maintenance-packages-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
      Loading map…
    </div>
  ),
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";



type StatusFilter = "ALL" | "AWAITING" | "ASSIGNED" | "NO_TEAM" | "OVERDUE";
/** "ALL" = every work type; otherwise every number on the page counts that one only. */
type WorkTypeFilter = "ALL" | MaintenanceCategory;
type ViewMode = "LIST" | "MAP";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "AWAITING", label: "Awaiting company" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "NO_TEAM", label: "No team" },
  { value: "OVERDUE", label: "Overdue" },
];
/** A company's own board has nothing "awaiting company" (plan §15). */
const COMPANY_STATUS_OPTIONS = STATUS_OPTIONS.filter(
  (option) => option.value !== "AWAITING" && option.value !== "ASSIGNED",
);

const VIEW_OPTIONS = [
  { value: "LIST", label: "List" },
  { value: "MAP", label: "Map" },
] as const;

/**
 * Repair state of a Pencawang (plan §15, J32) — marker fill + list bar colours.
 * Fixed hex: they paint on the satellite map, not the theme.
 */
type PeState = "NEEDS_COMPANY" | "NOT_STARTED" | "IN_PROGRESS" | "AWAITING" | "CLOSED";
const STATE_COLOR: Record<PeState, string> = {
  NEEDS_COMPANY: "#64748b",
  NOT_STARTED: "#dc2626",
  IN_PROGRESS: "#f59e0b",
  AWAITING: "#2563eb",
  CLOSED: "#16a34a",
};
const STATE_LABEL: Record<PeState, string> = {
  NEEDS_COMPANY: "Needs a company",
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  AWAITING: "Awaiting verification",
  CLOSED: "All closed",
};
/** Stacked progress bar segments, in order. */
const PROGRESS_PARTS: Array<{ key: keyof PackageProgress; label: string; color: string }> = [
  { key: "closed", label: "Closed", color: STATE_COLOR.CLOSED },
  { key: "awaiting", label: "Awaiting verification", color: STATE_COLOR.AWAITING },
  { key: "inProgress", label: "In progress", color: STATE_COLOR.IN_PROGRESS },
  { key: "todo", label: "To do", color: "#e2e8f0" },
];

/** Progress of a PE / lane; older APIs only had open / finished. */
function progressOf(item: {
  progress?: PackageProgress;
  totals?: { open: number; finished: number };
  open?: number;
  finished?: number;
}): PackageProgress {
  if (item.progress) return item.progress;
  const open = item.totals?.open ?? item.open ?? 0;
  const finished = item.totals?.finished ?? item.finished ?? 0;
  return { todo: open, inProgress: 0, awaiting: 0, closed: finished };
}

function peState(row: PackagePencawang): PeState {
  if (row.totals.unrouted > 0) return "NEEDS_COMPANY";
  const p = progressOf(row);
  if (p.todo + p.inProgress + p.awaiting === 0) return "CLOSED";
  if (p.todo + p.inProgress === 0) return "AWAITING";
  if (p.inProgress + p.awaiting + p.closed === 0) return "NOT_STARTED";
  return "IN_PROGRESS";
}

/**
 * The PE narrowed to one work type: progress, poles, no-team and owners count
 * that lane only — a Rentis crew sees whether ITS Rentis is done, not the
 * whole Pencawang. null = the PE has no work of that type.
 */
function scopeRow(row: PackagePencawang, category: MaintenanceCategory): PackagePencawang | null {
  const lane = row.lanes.find((candidate) => candidate.category === category);
  if (!lane || lane.total === 0) return null;
  return {
    ...row,
    poleCount: lane.poles ?? row.poleCount,
    totals: {
      total: lane.total,
      open: lane.open,
      finished: lane.finished,
      unrouted: lane.unrouted ?? 0,
      noTeam: lane.noTeam ?? 0,
    },
    progress: progressOf(lane),
    lanes: [lane],
    packages: row.packages.filter((pkg) => pkg.category === category || pkg.category === null),
    poleSplits: row.poleSplits.filter(
      (split) => split.category === category || split.category === null,
    ),
  };
}

/** Lane chip: done/total of that work type, green once all of it is done. */
function laneChip(lane: PackagePencawang["lanes"][number]) {
  const p = progressOf(lane);
  const done = p.closed + p.awaiting;
  const owner = lane.organization
    ? lane.team
      ? `${lane.organization.name} · ${lane.team.name}`
      : lane.organization.name
    : "No company yet";
  return {
    text: `${CATEGORY_LABEL[lane.category]} ${done}/${lane.total}`,
    title: `${owner} — ${done} of ${lane.total} done${p.awaiting > 0 ? ` (${p.awaiting} to verify)` : ""}${
      (lane.poles ?? 0) > 0 ? ` · ${lane.poles} pole${lane.poles === 1 ? "" : "s"}` : ""
    }`,
    tone: (done === lane.total ? "success" : lane.organization ? "neutral" : "warning") as Tone,
  };
}

/** The packages that are the actor's own work (a company sees other lanes too). */
function ownPackages(row: PackagePencawang, board: MaintenancePackageBoard) {
  if (board.actorKind !== "COMPANY") return row.packages;
  const own = new Set(board.companies.map((company) => company.id));
  return row.packages.filter((pkg) => own.has(pkg.organization.id));
}

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/** Earliest target date of the PE's (own) packages; overdue while work is open. */
function dueInfo(row: PackagePencawang, board: MaintenancePackageBoard) {
  const dates = [
    ...new Set(ownPackages(row, board).map((pkg) => pkg.dueDate).filter(Boolean)),
  ] as string[];
  const earliest = dates.sort()[0] ?? null;
  const overdue =
    earliest !== null && row.totals.open > 0 && new Date(earliest).getTime() < startOfToday();
  return { earliest, varies: dates.length > 1, overdue };
}

/** To do · in progress · awaiting verification · closed — one stacked bar. */
function ProgressBar({ progress, compact = false }: { progress: PackageProgress; compact?: boolean }) {
  const total = progress.todo + progress.inProgress + progress.awaiting + progress.closed;
  const closedPct = total === 0 ? 0 : Math.round((progress.closed / total) * 100);
  const done = progress.closed + progress.awaiting;
  const title = PROGRESS_PARTS.map((part) => `${part.label}: ${progress[part.key]}`).join(" · ");
  return (
    <div title={title} className={compact ? "min-w-[120px]" : "min-w-[160px]"}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--line2)]">
        {total > 0
          ? PROGRESS_PARTS.map((part) =>
              progress[part.key] > 0 ? (
                <span
                  key={part.key}
                  style={{ width: `${(progress[part.key] / total) * 100}%`, background: part.color }}
                />
              ) : null,
            )
          : null}
      </div>
      <div className="mt-1 text-[12px] text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">{done}</span>/{total} done
        {progress.awaiting > 0 ? ` · ${progress.awaiting} to verify` : ""}
        {compact ? "" : ` · ${closedPct}% closed`}
      </div>
    </div>
  );
}


function formatDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function pencawangLabel(row: { pencawangName: string | null; pencawangCode: string | null }) {
  return row.pencawangName || row.pencawangCode || "Unnamed Pencawang";
}

function severityTone(severity: string): Tone {
  const normalized = severity.toUpperCase();
  if (normalized === "CRITICAL") return "critical";
  if (normalized === "HIGH") return "high";
  if (normalized === "MEDIUM") return "warning";
  return "neutral";
}

function ownerLabel(pkg: Pick<MaintenancePackageRecord, "organization" | "team">) {
  return pkg.team ? `${pkg.organization.name} · ${pkg.team.name}` : pkg.organization.name;
}

/** One line describing who owns the PE: whole company/team, split, or nobody yet. */
function assignmentSummary(
  row: PackagePencawang,
  board?: MaintenancePackageBoard,
): { text: string; tone: Tone } {
  // A company: only its own work — which of its teams has it (plan §15).
  if (board?.actorKind === "COMPANY") {
    const own = ownPackages(row, board);
    const teams = [...new Set(own.map((pkg) => pkg.team?.name).filter(Boolean))] as string[];
    const ownSplits = row.poleSplits.filter((split) =>
      board.companies.some((company) => company.id === split.organization.id),
    );
    const splitTeams = ownSplits.map((split) => split.team?.name).filter(Boolean) as string[];
    const all = [...new Set([...teams, ...splitTeams])];
    if (all.length === 0) return { text: "No team yet", tone: "warning" };
    const missing = own.some((pkg) => !pkg.team);
    return {
      text: all.join(", ") + (missing ? " · part has no team" : ""),
      tone: missing ? "warning" : "brand",
    };
  }
  const splitPoles = row.poleSplits.reduce((sum, split) => sum + split.poles, 0);
  const poleNote = splitPoles > 0 ? ` + ${splitPoles} pole${splitPoles === 1 ? "" : "s"} split` : "";
  if (row.packages.length === 0) {
    return splitPoles > 0
      ? { text: `${splitPoles} pole${splitPoles === 1 ? "" : "s"} split · rest awaiting company`, tone: "warning" }
      : { text: "Awaiting company", tone: "warning" };
  }
  const whole = row.packages.find((pkg) => pkg.category === null);
  if (whole) {
    return { text: ownerLabel(whole) + poleNote, tone: "brand" };
  }
  const owners = new Set(row.packages.map((pkg) => ownerLabel(pkg)));
  return {
    text: (owners.size === 1 ? ownerLabel(row.packages[0]) : `Split · ${owners.size} owners`) + poleNote,
    tone: "brand",
  };
}




/** Name, code or Mainhead contains the search text. */
function matchesSearch(row: PackagePencawang, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [row.pencawangName, row.pencawangCode, row.mainhead?.name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

/** Can the actor act on this PE at all (whole, or at least one lane with work)? */
function isSelectable(row: PackagePencawang) {
  return row.canAssign || row.lanes.some((lane) => lane.canAssign && lane.total > 0);
}

function hasLocation(row: PackagePencawang): row is PackagePencawang & { latitude: number; longitude: number } {
  return row.latitude !== null && row.longitude !== null;
}

/** Great-circle distance in km. */
function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}







interface AssignDialogProps {
  row: PackagePencawang;
  companies: PackageCompany[];
  teams: PackageTeam[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: PackageDestination & {
    category: MaintenanceCategory | null;
    dueDate: string | null;
    notes: string | null;
  }) => void;
  onWithdraw: (pkg: MaintenancePackageRecord) => void;
  onSplitPoles: () => void;
  actorKind: PackageActorKind;
  /** The page's work-type filter: open on that lane. */
  initialCategory?: MaintenanceCategory | null;
}

function AssignDialog({
  row,
  companies,
  teams,
  busy,
  error,
  onClose,
  onSubmit,
  onWithdraw,
  onSplitPoles,
  actorKind,
  initialCategory = null,
}: AssignDialogProps) {
  // A contractor Manager only re-teams its own work (plan §15, J30).
  const isCompany = actorKind === "COMPANY";
  const lanesWithWork = row.lanes.filter((lane) => lane.total > 0);
  const assignableLanes = lanesWithWork.filter((lane) => lane.canAssign);
  const whole = row.packages.find((pkg) => pkg.category === null) ?? null;
  const filteredLane = initialCategory
    ? assignableLanes.find((lane) => lane.category === initialCategory)
    : undefined;
  const [scope, setScope] = useState<"WHOLE" | "LANE">(
    filteredLane || !row.canAssign || (row.packages.length > 0 && !whole) ? "LANE" : "WHOLE",
  );
  const [category, setCategory] = useState<MaintenanceCategory>(
    (filteredLane ?? assignableLanes[0] ?? lanesWithWork[0])?.category ?? "SELENGGARAAN",
  );
  const existing =
    scope === "WHOLE" ? whole : row.packages.find((pkg) => pkg.category === category) ?? null;
  // A lane split off a whole package starts from the whole package's values.
  const defaults = existing ?? whole;
  const initialDestination = encodeDestination(
    defaults?.organization.id ?? row.suggestedOrganizationId,
    defaults?.team?.id,
  );
  const [destination, setDestination] = useState(initialDestination);
  const [dueDate, setDueDate] = useState(defaults?.dueDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(defaults?.notes ?? "");

  // Switching whole ↔ lane (or lane) reloads that package's current values.
  useEffect(() => {
    setDestination(initialDestination);
    setDueDate(defaults?.dueDate?.slice(0, 10) ?? "");
    setNotes(defaults?.notes ?? "");
  }, [defaults, initialDestination]);

  const decoded = decodeDestination(destination, teams);
  const laneAllowed = scope === "WHOLE" ? row.canAssign : assignableLanes.some((lane) => lane.category === category);
  const changesOwner =
    existing &&
    decoded &&
    (decoded.maintenanceOrganizationId !== existing.organization.id ||
      (decoded.assignedTeamId !== null && decoded.assignedTeamId !== existing.team?.id));

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!decoded || !laneAllowed) {
      return;
    }
    onSubmit({
      category: scope === "WHOLE" ? null : category,
      ...decoded,
      dueDate: dueDate || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <DialogFrame
      eyebrow={row.mainhead?.name ?? "No Mainhead"}
      title={pencawangLabel(row)}
      subtitle={`${row.totals.open} open Kejanggalan on ${row.poleCount} pole${row.poleCount === 1 ? "" : "s"}`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4 px-[18px] py-5">
        <ErrorBanner error={error} />

        <div>
          <span className={modalLabelClass}>Assign</span>
          <div className="mt-1.5">
            <Seg
              aria-label="Package scope"
              options={[
                { value: "WHOLE", label: "Whole Pencawang" },
                { value: "LANE", label: "One work type" },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
          {scope === "WHOLE" && !row.canAssign ? (
            <span className="mt-1.5 block text-[12px] text-[var(--high-text)]">
              Part of this Pencawang is with a company outside your group — only TNB can reassign it
              whole. Pick one work type instead.
            </span>
          ) : null}
        </div>

        {scope === "LANE" ? (
          <label className="block">
            <span className={modalLabelClass}>Work type</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as MaintenanceCategory)}
              className={modalSelectClass}
            >
              {lanesWithWork.map((lane) => (
                <option key={lane.category} value={lane.category} disabled={!lane.canAssign}>
                  {CATEGORY_LABEL[lane.category]} — {lane.open} open
                  {lane.canAssign ? "" : isCompany ? " (another company)" : " (TNB only)"}
                </option>
              ))}
            </select>
            {whole ? (
              <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
                The other work types stay with {ownerLabel(whole)}.
              </span>
            ) : null}
          </label>
        ) : row.packages.length > 0 && !whole ? (
          <p className="text-[12px] text-[var(--muted)]">
            This replaces the current per-work-type split with one owner for the whole Pencawang.
          </p>
        ) : null}

        <label className="block">
          <span className={modalLabelClass}>{isCompany ? "Team" : "Company or team"}</span>
          <DestinationSelect
            companies={companies}
            teams={teams}
            value={destination}
            onChange={setDestination}
            suggestedOrganizationId={row.suggestedOrganizationId}
            className={modalSelectClass}
            teamsOnly={isCompany}
          />
          <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
            {decoded?.assignedTeamId
              ? "The team sees this work in the app straight away."
              : existing?.team
                ? `${existing.team.name} comes off this work — it waits for a team. Work the crew already started stays with them.`
                : isCompany
                  ? "No team yet — pick one of your teams to start the work."
                  : "The company's Manager picks the team (Maintenance page)."}
            {changesOwner
              ? " Kejanggalan the current crew has already photographed stay with them; the rest move."
              : ""}
          </span>
        </label>

        {isCompany ? (
          <p className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2 text-[12.5px] text-[var(--foreground-soft)]">
            Target date {defaults?.dueDate ? formatDate(defaults.dueDate) : "— not set"}
            {defaults?.notes ? ` · ${defaults.notes}` : ""}
            <span className="block text-[11.5px] text-[var(--muted)]">
              Set by TNB / the main contractor — it stays when you change the team.
            </span>
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={modalLabelClass}>Target date</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={modalInputClass}
                />
              </label>
            </div>

            <label className="block">
              <span className={modalLabelClass}>Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={`${modalInputClass} min-h-[72px] py-2`}
                maxLength={1000}
              />
            </label>
          </>
        )}

        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--line)] px-3 py-2.5">
          <span className="text-[12.5px] text-[var(--muted)]">
            Need several crews here? Give some poles to another team.
          </span>
          <Tbtn type="button" onClick={onSplitPoles} disabled={busy}>
            Split by poles…
          </Tbtn>
        </div>

        {row.packages.length > 0 ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
            <p className="text-[12px] font-semibold text-[var(--foreground-soft)]">Current packages</p>
            <ul className="mt-2 space-y-1.5">
              {row.packages.map((pkg) => (
                <li key={pkg.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-[var(--foreground-soft)]">
                    <span className="font-semibold">
                      {pkg.category ? CATEGORY_LABEL[pkg.category] : "Whole Pencawang"}
                    </span>{" "}
                    → {ownerLabel(pkg)}
                    {pkg.dueDate ? ` · by ${formatDate(pkg.dueDate)}` : ""}
                  </span>
                  {isCompany ? null : (
                    <button
                      type="button"
                      onClick={() => onWithdraw(pkg)}
                      disabled={busy}
                      className="shrink-0 text-[12px] font-semibold text-[var(--critical-text)] hover:underline disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
          <Tbtn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Tbtn>
          <Tbtn type="submit" variant="primary" disabled={busy || !decoded || !laneAllowed}>
            {busy ? "Saving…" : existing ? "Save assignment" : "Assign"}
          </Tbtn>
        </div>
      </form>
    </DialogFrame>
  );
}

/** One destination for every selected Pencawang (list multi-select or the Map). */
function BulkAssignDialog({
  rows,
  companies,
  teams,
  busy,
  error,
  onClose,
  onSubmit,
  actorKind,
}: {
  rows: PackagePencawang[];
  companies: PackageCompany[];
  teams: PackageTeam[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: PackageDestination & {
    category: MaintenanceCategory | null;
    dueDate: string | null;
    notes: string | null;
  }) => void;
  actorKind: PackageActorKind;
}) {
  const isCompany = actorKind === "COMPANY";
  // A company's own work usually comes per work type — start there.
  const [scope, setScope] = useState<"WHOLE" | "LANE">(isCompany ? "LANE" : "WHOLE");
  const openByLane = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        open: rows.reduce(
          (sum, row) => sum + (row.lanes.find((lane) => lane.category === category)?.open ?? 0),
          0,
        ),
      })),
    [rows],
  );
  const [category, setCategory] = useState<MaintenanceCategory>(
    openByLane.find((lane) => lane.open > 0)?.category ?? "SELENGGARAAN",
  );
  const [destination, setDestination] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const decoded = decodeDestination(destination, teams);
  const poles = rows.reduce((sum, row) => sum + row.poleCount, 0);
  const open = rows.reduce((sum, row) => sum + row.totals.open, 0);
  const alreadyAssigned = rows.filter((row) => row.packages.length > 0).length;

  return (
    <DialogFrame
      eyebrow="Assign together"
      title={`${rows.length} Pencawang`}
      subtitle={`${open} open Kejanggalan on ${poles} pole${poles === 1 ? "" : "s"}`}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!decoded) return;
          onSubmit({
            category: scope === "WHOLE" ? null : category,
            ...decoded,
            dueDate: dueDate || null,
            notes: notes.trim() || null,
          });
        }}
        className="space-y-4 px-[18px] py-5"
      >
        <ErrorBanner error={error} />

        <div>
          <span className={modalLabelClass}>Assign</span>
          <div className="mt-1.5">
            <Seg
              aria-label="Package scope"
              options={[
                { value: "WHOLE", label: "Whole Pencawang" },
                { value: "LANE", label: "One work type" },
              ]}
              value={scope}
              onChange={setScope}
            />
          </div>
        </div>

        {scope === "LANE" ? (
          <label className="block">
            <span className={modalLabelClass}>Work type</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as MaintenanceCategory)}
              className={modalSelectClass}
            >
              {openByLane.map((lane) => (
                <option key={lane.category} value={lane.category}>
                  {CATEGORY_LABEL[lane.category]} — {lane.open} open
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block">
          <span className={modalLabelClass}>{isCompany ? "Team" : "Company or team"}</span>
          <DestinationSelect
            companies={companies}
            teams={teams}
            value={destination}
            onChange={setDestination}
            className={modalSelectClass}
            teamsOnly={isCompany}
          />
          <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
            {decoded?.assignedTeamId
              ? "The team sees this work in the app straight away."
              : "The company's Manager picks the team (Maintenance page)."}
            {alreadyAssigned > 0
              ? ` ${
                  rows.length === 1
                    ? "This Pencawang already has an owner — it is"
                    : `${alreadyAssigned} of these already have an owner — they are`
                } reassigned; work already photographed stays with the current crew.`
              : ""}
          </span>
        </label>

        {isCompany ? (
          <p className="text-[12px] text-[var(--muted)]">
            Target dates set by TNB / the main contractor stay as they are.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={modalLabelClass}>Target date</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className={modalInputClass}
                />
              </label>
            </div>

            <label className="block">
              <span className={modalLabelClass}>Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={`${modalInputClass} min-h-[72px] py-2`}
                maxLength={1000}
              />
            </label>
          </>
        )}

        <div className="max-h-40 overflow-y-auto rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
          <ul className="space-y-1 text-[12.5px] text-[var(--foreground-soft)]">
            {rows.map((row) => (
              <li key={row.siteVisitId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">{pencawangLabel(row)}</span>
                <span className="shrink-0 text-[var(--muted)]">{row.totals.open} open</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
          <Tbtn type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Tbtn>
          <Tbtn type="submit" variant="primary" disabled={busy || !decoded}>
            {busy ? "Saving…" : `Assign ${rows.length}`}
          </Tbtn>
        </div>
      </form>
    </DialogFrame>
  );
}

function EmergencyQueue({
  board,
  busy,
  onAssign,
}: {
  board: MaintenancePackageBoard;
  busy: boolean;
  onAssign: (defectId: string, destination: PackageDestination) => void;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  if (board.emergencies.length === 0) {
    return null;
  }

  return (
    <Card padded={false} className="border-[var(--critical-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--line2)] px-4 py-3">
        <AlertTriangle size={16} className="text-[var(--critical-text)]" />
        <p className="text-[13px] font-semibold text-[var(--foreground)]">
          Emergencies without a company ({board.emergencies.length})
        </p>
      </div>
      <ul className="divide-y divide-[var(--line2)]">
        {board.emergencies.map((emergency) => {
          const destination = decodeDestination(picked[emergency.defectId] ?? "", board.teams);
          return (
            <li key={emergency.defectId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={severityTone(emergency.severity)}>{emergency.severity}</Chip>
                  <span className="text-[13px] font-semibold text-[var(--foreground)]">
                    {emergency.remark || emergency.label}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {emergency.asset.assetCode} · {pencawangLabel(emergency)} ·{" "}
                  {emergency.mainhead?.name ?? "No Mainhead"} · {formatDate(emergency.createdAt)}
                </p>
              </div>
              {board.canAssign ? (
                <div className="flex flex-wrap items-center gap-2">
                  <DestinationSelect
                    ariaLabel="Company or team for this emergency"
                    companies={board.companies}
                    teams={board.teams}
                    value={picked[emergency.defectId] ?? ""}
                    onChange={(value) =>
                      setPicked((current) => ({ ...current, [emergency.defectId]: value }))
                    }
                    className={`${filterSelectClass} max-w-[280px]`}
                  />
                  <Tbtn
                    variant="danger"
                    disabled={busy || !destination}
                    onClick={() => destination && onAssign(emergency.defectId, destination)}
                  >
                    Assign
                  </Tbtn>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function SelectionBar({
  count,
  onAssign,
  onClear,
  onReports,
}: {
  count: number;
  onAssign: () => void;
  onClear: () => void;
  onReports: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-2.5">
      <span className="text-[13px] font-semibold text-[var(--foreground)]">
        {count} Pencawang selected
      </span>
      <div className="flex gap-2">
        <Tbtn variant="ghost" onClick={onClear}>
          Clear
        </Tbtn>
        <Tbtn onClick={onReports} title="Laporan Pembaikan Kejanggalan — one PDF per Pencawang, in a ZIP">
          Repair reports (ZIP)…
        </Tbtn>
        <Tbtn variant="primary" onClick={onAssign}>
          Assign selected…
        </Tbtn>
      </div>
    </div>
  );
}


/** Map view: pick nearby Pencawang so one crew's route stays short (plan §12.4). */
function MapView({
  board,
  rows,
  search,
  selected,
  onToggle,
  onAdd,
  onAssign,
  onClear,
  onOpenPoles,
  onReports,
}: {
  board: MaintenancePackageBoard;
  rows: PackagePencawang[];
  /** Highlights + flies to matches; never hides the other Pencawang. */
  search: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAdd: (ids: string[]) => void;
  onAssign: () => void;
  onClear: () => void;
  onOpenPoles: (row: PackagePencawang) => void;
  onReports: (rows: PackagePencawang[]) => void;
}) {
  const [boxMode, setBoxMode] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [focusTeamId, setFocusTeamId] = useState("");
  const [radiusKm, setRadiusKm] = useState("3");
  const [showNoLocation, setShowNoLocation] = useState(false);

  const located = useMemo(() => rows.filter(hasLocation), [rows]);
  const unlocated = useMemo(() => rows.filter((row) => !hasLocation(row)), [rows]);
  const selectedRows = useMemo(
    () => (board.pencawangs ?? []).filter((row) => selected.has(row.siteVisitId)),
    [board.pencawangs, selected],
  );

  const inFocus = useCallback(
    (row: PackagePencawang) =>
      !focusTeamId ||
      row.packages.some((pkg) => pkg.team?.id === focusTeamId) ||
      row.lanes.some((lane) => lane.team?.id === focusTeamId) ||
      row.poleSplits.some((split) => split.team?.id === focusTeamId),
    [focusTeamId],
  );

  const matches = useMemo(
    () => (search.trim() ? rows.filter((row) => matchesSearch(row, search)) : []),
    [rows, search],
  );
  const matchIds = useMemo(() => new Set(matches.map((row) => row.siteVisitId)), [matches]);
  const focusIds = useMemo(
    () => matches.filter(hasLocation).map((row) => row.siteVisitId),
    [matches],
  );

  const points: PackageMapPoint[] = useMemo(
    () =>
      located.map((row) => {
        const state = peState(row);
        const progress = progressOf(row);
        const due = dueInfo(row, board);
        return {
          id: row.siteVisitId,
          latitude: row.latitude,
          longitude: row.longitude,
          openCount: row.totals.open,
          label: `${row.totals.finished}/${row.totals.total}`,
          color: STATE_COLOR[state],
          hollow: state !== "NEEDS_COMPANY" && state !== "CLOSED" && (row.totals.noTeam ?? 0) > 0,
          dimmed: !inFocus(row),
          progress: row.totals.total > 0 ? progress.closed / row.totals.total : 0,
          selected: selected.has(row.siteVisitId),
          highlighted: matchIds.has(row.siteVisitId),
          title:
            `${pencawangLabel(row)} — ${STATE_LABEL[state]} · ${row.totals.finished}/${row.totals.total} done` +
            (progress.awaiting > 0 ? ` (${progress.awaiting} to verify)` : "") +
            ` · ${assignmentSummary(row, board).text}` +
            ((row.totals.noTeam ?? 0) > 0 ? ` · ${row.totals.noTeam} without a team` : "") +
            (due.overdue ? " · OVERDUE" : "") +
            (isSelectable(row) ? "" : board.actorKind === "COMPANY" ? " (view only)" : " (assigned outside your group)"),
        };
      }),
    [board, inFocus, located, matchIds, selected],
  );

  const selectableIds = useMemo(
    () => new Set(rows.filter(isSelectable).map((row) => row.siteVisitId)),
    [rows],
  );

  const summary = useMemo(() => {
    const withCoords = selectedRows.filter(hasLocation);
    let spread = 0;
    for (let i = 0; i < withCoords.length; i += 1) {
      for (let j = i + 1; j < withCoords.length; j += 1) {
        spread = Math.max(spread, distanceKm(withCoords[i], withCoords[j]));
      }
    }
    return {
      poles: selectedRows.reduce((sum, row) => sum + row.poleCount, 0),
      open: selectedRows.reduce((sum, row) => sum + row.totals.open, 0),
      lanes: CATEGORY_ORDER.map((category) => ({
        category,
        open: selectedRows.reduce(
          (sum, row) => sum + (row.lanes.find((lane) => lane.category === category)?.open ?? 0),
          0,
        ),
      })),
      spread,
      withCoords,
    };
  }, [selectedRows]);

  const focusCount = useMemo(
    () =>
      focusTeamId
        ? (board.pencawangs ?? []).filter((row) =>
            row.packages.some((pkg) => pkg.team?.id === focusTeamId),
          ).length
        : 0,
    [board.pencawangs, focusTeamId],
  );

  const addNearby = () => {
    const radius = Number(radiusKm);
    if (!Number.isFinite(radius) || radius <= 0 || summary.withCoords.length === 0) return;
    onAdd(
      located
        .filter(
          (row) =>
            !selected.has(row.siteVisitId) &&
            selectableIds.has(row.siteVisitId) &&
            row.totals.open > 0 &&
            summary.withCoords.some((anchor) => distanceKm(anchor, row) <= radius),
        )
        .map((row) => row.siteVisitId),
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line2)] px-3 py-2.5">
          {board.canAssign ? (
            <Tbtn
              variant={boxMode ? "primary" : "secondary"}
              onClick={() => setBoxMode((current) => !current)}
              title="Drag on the map to select every Pencawang inside the box"
            >
              <SquareDashedMousePointer size={16} />
              {boxMode ? "Box select on — drag on map" : "Box select"}
            </Tbtn>
          ) : null}
          <select
            aria-label="Focus team"
            value={focusTeamId}
            onChange={(event) => setFocusTeamId(event.target.value)}
            className={`${filterSelectClass} max-w-[240px]`}
          >
            <option value="">Focus team: none</option>
            {board.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} · {board.companies.find((c) => c.id === team.organizationId)?.name ?? ""}
              </option>
            ))}
          </select>
          {focusTeamId ? (
            <span className="text-[12px] text-[var(--muted)]">
              {focusCount} Pencawang with this team
            </span>
          ) : null}
          {search.trim() ? (
            <span className="text-[12px] font-semibold text-[var(--brand)]">
              {matches.length === 0
                ? "No Pencawang match the search"
                : focusIds.length === matches.length
                  ? `${matches.length} found — highlighted`
                  : `${matches.length} found, ${matches.length - focusIds.length} without a location`}
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {(Object.keys(STATE_LABEL) as PeState[])
              .filter((state) => board.actorKind !== "COMPANY" || state !== "NEEDS_COMPANY")
              .map((state) => (
                <LegendDot key={state} color={STATE_COLOR[state]} label={STATE_LABEL[state]} />
              ))}
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#dc2626] bg-white" />
              Hollow = no team · green ring = % closed · label done/total
            </span>
          </div>
        </div>
        <div className="h-[420px] lg:h-[620px]">
          {GOOGLE_MAPS_API_KEY && !mapError ? (
            <MaintenancePackagesMap
              apiKey={GOOGLE_MAPS_API_KEY}
              points={points}
              boxMode={boxMode}
              onToggle={(id) => {
                if (selectableIds.has(id)) onToggle(id);
              }}
              onBoxSelect={(ids) => onAdd(ids.filter((id) => selectableIds.has(id)))}
              focusIds={focusIds}
              onLoadError={() => setMapError(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--muted)]">
              The map is unavailable right now — use the List view to select Pencawang.
            </div>
          )}
        </div>
        {unlocated.length > 0 ? (
          <div className="border-t border-[var(--line2)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => setShowNoLocation((current) => !current)}
              className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[var(--foreground-soft)] hover:underline"
            >
              <MapPinOff size={14} />
              {unlocated.length} Pencawang {unlocated.length === 1 ? "has" : "have"} no location —{" "}
              {showNoLocation ? "hide" : "show"}
            </button>
            {showNoLocation ? (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {unlocated.map((row) => (
                  <li key={row.siteVisitId}>
                    <label className="flex items-center gap-2 text-[12.5px] text-[var(--foreground-soft)]">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        checked={selected.has(row.siteVisitId)}
                        disabled={!board.canAssign || !isSelectable(row)}
                        onChange={() => onToggle(row.siteVisitId)}
                      />
                      <span className="min-w-0 truncate">
                        {pencawangLabel(row)} · {row.totals.open} open
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <Eyebrow>Selection</Eyebrow>
          <p
            className="mt-1 text-[22px] font-bold leading-tight text-[var(--foreground)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {selectedRows.length} Pencawang
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            {summary.open} open Kejanggalan · {summary.poles} poles
            {summary.withCoords.length > 1 ? ` · ${summary.spread.toFixed(1)} km apart at most` : ""}
          </p>
        </div>

        {selectedRows.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {summary.lanes
              .filter((lane) => lane.open > 0)
              .map((lane) => (
                <Chip key={lane.category} tone="neutral">
                  {CATEGORY_LABEL[lane.category]} {lane.open}
                </Chip>
              ))}
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--muted)]">
            Click Pencawang on the map, or switch on Box select and drag around a group. Pick a
            focus team to see where that crew already has work.
          </p>
        )}

        {board.canAssign ? (
          <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] p-3">
            <p className="text-[12px] font-semibold text-[var(--foreground-soft)]">Add nearby</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                aria-label="Radius in km"
                className={`${filterControlClass} w-20`}
              />
              <span className="text-[12.5px] text-[var(--muted)]">km</span>
              <Tbtn
                onClick={addNearby}
                disabled={summary.withCoords.length === 0}
                className="ml-auto"
              >
                Add
              </Tbtn>
            </div>
            <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">
              Adds every open Pencawang within this distance of the selection.
            </p>
          </div>
        ) : null}

        {selectedRows.length > 0 ? (
          <ul className="max-h-[260px] space-y-1 overflow-y-auto">
            {selectedRows.map((row) => (
              <li
                key={row.siteVisitId}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-[12.5px] hover:bg-[var(--panel-muted)]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[var(--foreground)]">
                    {pencawangLabel(row)}
                  </span>
                  <span className="block truncate text-[11.5px] text-[var(--muted)]">
                    {row.totals.finished}/{row.totals.total} done · {assignmentSummary(row, board).text}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenPoles(row)}
                    className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--brand)] hover:underline"
                  >
                    Poles
                  </button>
                  <button
                    type="button"
                    onClick={() => onReports([row])}
                    className="rounded px-1.5 py-0.5 text-[11.5px] font-semibold text-[var(--brand)] hover:underline"
                  >
                    Report
                  </button>
                  <IconBtn onClick={() => onToggle(row.siteVisitId)} aria-label="Remove from selection">
                    <X size={14} />
                  </IconBtn>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {board.canAssign ? (
          <div className="mt-auto flex gap-2">
            <Tbtn variant="ghost" onClick={onClear} disabled={selectedRows.length === 0}>
              Clear
            </Tbtn>
            <Tbtn
              onClick={() => onReports(selectedRows)}
              disabled={selectedRows.length === 0}
              title="Laporan Pembaikan Kejanggalan for the selection (ZIP)"
            >
              Reports
            </Tbtn>
            <Tbtn
              variant="primary"
              onClick={onAssign}
              disabled={selectedRows.length === 0}
              className="flex-1"
            >
              Assign selected…
            </Tbtn>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function MaintenancePackagesContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [board, setBoard] = useState<MaintenancePackageBoard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogRow, setDialogRow] = useState<PackagePencawang | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<MaintenancePackageRecord | null>(null);
  const [poleRow, setPoleRow] = useState<PackagePencawang | null>(null);
  const [findingRow, setFindingRow] = useState<PackagePencawang | null>(null);
  // Plan §16: repair report for one Pencawang (PDF) or a selection (ZIP).
  const [reportRows, setReportRows] = useState<PackagePencawang[] | null>(null);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [workType, setWorkType] = useState<WorkTypeFilter>("ALL");
  const [mainheadFilter, setMainheadFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>("LIST");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadBoard = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        const next = await fetchMaintenancePackageBoard(token);
        setBoard(next);
        // Drop selections that vanished or are no longer the actor's to change.
        const allowed = new Set(next.pencawangs.filter(isSelectable).map((row) => row.siteVisitId));
        setSelected((current) => new Set([...current].filter((id) => allowed.has(id))));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load packages.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);
    if (storedSession?.token) {
      void loadBoard(storedSession.token);
    }
  }, [loadBoard]);

  /** Runs a write, then reloads the board; errors land in the dialog when open. */
  const runWrite = useCallback(
    async (write: (token: string) => Promise<string>) => {
      const token = session?.token;
      if (!token) {
        return false;
      }
      setIsSaving(true);
      setDialogError("");
      setError("");
      try {
        setNotice(await write(token));
        await loadBoard(token);
        return true;
      } catch (writeError) {
        if (writeError instanceof ApiError && writeError.status === 401) {
          handleLogout();
          return false;
        }
        const message = writeError instanceof Error ? writeError.message : "Unable to save.";
        if (dialogRow || bulkOpen) {
          setDialogError(message);
        } else {
          setError(message);
        }
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [bulkOpen, dialogRow, handleLogout, loadBoard, session?.token],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addSelected = useCallback((ids: string[]) => {
    setSelected((current) => new Set([...current, ...ids]));
  }, []);

  const mainheads = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of board?.pencawangs ?? []) {
      if (row.mainhead) {
        byId.set(row.mainhead.id, row.mainhead.name);
      }
    }
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [board]);

  // Status + Mainhead filters. The Map view stops here: there the search box
  // flies to a Pencawang instead of hiding its neighbours.
  // Work-type filter: each PE narrowed to that lane (PEs without it drop out).
  const scopedRows = useMemo(() => {
    const all = board?.pencawangs ?? [];
    if (workType === "ALL") return all;
    return all
      .map((row) => scopeRow(row, workType))
      .filter((row): row is PackagePencawang => row !== null);
  }, [board, workType]);
  // Dialogs always get the full PE, never the work-type slice.
  const originalById = useMemo(
    () => new Map((board?.pencawangs ?? []).map((row) => [row.siteVisitId, row])),
    [board],
  );
  const original = useCallback(
    (row: PackagePencawang) => originalById.get(row.siteVisitId) ?? row,
    [originalById],
  );

  const filteredRows = useMemo(
    () =>
      scopedRows.filter((row) => {
        if (statusFilter === "AWAITING" && row.packages.length > 0) return false;
        if (statusFilter === "ASSIGNED" && row.packages.length === 0) return false;
        if (statusFilter === "NO_TEAM" && (row.totals.noTeam ?? 0) === 0) return false;
        if (statusFilter === "OVERDUE" && board && !dueInfo(row, board).overdue) return false;
        if (mainheadFilter !== "ALL" && row.mainhead?.id !== mainheadFilter) return false;
        return true;
      }),
    [board, mainheadFilter, scopedRows, statusFilter],
  );

  // The List view also narrows by the search box.
  const rows = useMemo(
    () => filteredRows.filter((row) => matchesSearch(row, search)),
    [filteredRows, search],
  );

  const selectableRows = useMemo(() => rows.filter(isSelectable), [rows]);
  const allVisibleSelected =
    selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.siteVisitId));
  const selectedRows = useMemo(
    () => (board?.pencawangs ?? []).filter((row) => selected.has(row.siteVisitId)),
    [board, selected],
  );

  const kpis = useMemo(() => {
    const pencawangs = scopedRows;
    const progress = pencawangs.map(progressOf).reduce(
      (sum, p) => ({
        todo: sum.todo + p.todo,
        inProgress: sum.inProgress + p.inProgress,
        awaiting: sum.awaiting + p.awaiting,
        closed: sum.closed + p.closed,
      }),
      { todo: 0, inProgress: 0, awaiting: 0, closed: 0 },
    );
    const total = pencawangs.reduce((sum, row) => sum + row.totals.total, 0);
    return {
      pencawangs: pencawangs.length,
      awaiting: pencawangs.filter((row) => row.packages.length === 0).length,
      assigned: pencawangs.filter((row) => row.packages.length > 0).length,
      open: pencawangs.reduce((sum, row) => sum + row.totals.open, 0),
      unrouted: pencawangs.reduce((sum, row) => sum + row.totals.unrouted, 0),
      noTeam: pencawangs.reduce((sum, row) => sum + (row.totals.noTeam ?? 0), 0),
      overdue: board ? pencawangs.filter((row) => dueInfo(row, board).overdue).length : 0,
      total,
      progress,
      closedPct: total === 0 ? 0 : Math.round((progress.closed / total) * 100),
      // Always every work type (the cards double as the work-type filter).
      byType: CATEGORY_ORDER.map((category) => {
        const lanes = (board?.pencawangs ?? [])
          .map((row) => row.lanes.find((lane) => lane.category === category))
          .filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
        return {
          category,
          total: lanes.reduce((sum, lane) => sum + lane.total, 0),
          progress: lanes.map(progressOf).reduce(
            (sum, p) => ({
              todo: sum.todo + p.todo,
              inProgress: sum.inProgress + p.inProgress,
              awaiting: sum.awaiting + p.awaiting,
              closed: sum.closed + p.closed,
            }),
            { todo: 0, inProgress: 0, awaiting: 0, closed: 0 },
          ),
        };
      }),
    };
  }, [board, scopedRows]);

  const openBulk = () => {
    setDialogError("");
    setBulkOpen(true);
  };

  const subtitle =
    board?.actorKind === "COMPANY"
      ? board.canAssign
        ? "The Pencawang TNB or your main contractor gave your company. Give them to your teams — whole, by work type, or split by poles — and follow the repairs. Use the Map to group nearby Pencawang for one team."
        : "The Pencawang your company is repairing, and how far each one is."
      : board?.actorKind === "MAIN_CONTRACTOR"
        ? "Hand your Pencawang to your own teams or your subcontractors — whole, or split by work type. Use the Map to group nearby Pencawang for one team."
        : "Hand each surveyed Pencawang to a maintenance company, or straight to one of its teams, once its report is complete — whole, or split by work type. Use the Map to group nearby Pencawang for one team.";
  const isCompany = board?.actorKind === "COMPANY";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-[30px]">
        <div className="mx-auto max-w-7xl">
          <PageHeader
            eyebrow="Maintenance"
            title="Maintenance packages"
            subtitle={subtitle}
            chips={
              board ? (
                <Chip tone={board.canAssign ? "brand" : "neutral"}>
                  {board.canAssign ? "Can assign" : "View only"}
                </Chip>
              ) : null
            }
            actions={
              <div className="flex items-center gap-2">
                <Tbtn
                  variant="secondary"
                  onClick={() => setMaterialsOpen(true)}
                  disabled={!board || !session?.token}
                  title="Materials used, for the TNB claim (Excel)"
                >
                  <FileSpreadsheet size={16} />
                  Materials summary
                </Tbtn>
                <Tbtn
                  onClick={() => (session?.token ? loadBoard(session.token) : undefined)}
                  disabled={isLoading || !session?.token}
                >
                  <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                  Refresh
                </Tbtn>
              </div>
            }
          />

          <div className="mt-6 space-y-6">
            {notice ? (
              <div className="rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-[13px] text-[var(--foreground-soft)]">
                {notice}
              </div>
            ) : null}
            {error ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-[var(--critical-bg)] p-4 text-[13px] text-[var(--critical-text)]">
                {error}
              </div>
            ) : null}

            {board ? (
              <>
                <EmergencyQueue
                  board={board}
                  busy={isSaving}
                  onAssign={(defectId, destination) =>
                    void runWrite(async (token) => {
                      await assignEmergency(token, defectId, destination);
                      return "Emergency routed.";
                    })
                  }
                />

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <KpiCard
                    label="Closed"
                    value={`${kpis.closedPct}%`}
                    icon={CheckCircle2}
                    tone={kpis.closedPct === 100 && kpis.total > 0 ? "success" : "neutral"}
                    context={`${kpis.progress.closed.toLocaleString()} of ${kpis.total.toLocaleString()} Kejanggalan verified`}
                  />
                  <KpiCard
                    label="Awaiting verification"
                    value={kpis.progress.awaiting.toLocaleString()}
                    icon={Hourglass}
                    tone={kpis.progress.awaiting > 0 ? "warning" : "neutral"}
                    context="Repaired, waiting for TNB / main contractor"
                  />
                  <KpiCard
                    label="Still to repair"
                    value={kpis.open.toLocaleString()}
                    icon={Building2}
                    context={`${kpis.progress.inProgress.toLocaleString()} in progress · ${kpis.progress.todo.toLocaleString()} not started`}
                  />
                  <KpiCard
                    label="Overdue Pencawang"
                    value={kpis.overdue.toLocaleString()}
                    icon={AlertTriangle}
                    tone={kpis.overdue > 0 ? "critical" : "neutral"}
                    context="Past the target date with work open"
                  />
                  <KpiCard
                    label="No team yet"
                    value={kpis.noTeam.toLocaleString()}
                    icon={Users}
                    tone={kpis.noTeam > 0 ? "high" : "neutral"}
                    context="Open Kejanggalan with a company but no crew"
                  />
                  {isCompany ? (
                    <KpiCard
                      label="Pencawang"
                      value={kpis.pencawangs.toLocaleString()}
                      icon={PackageCheck}
                      context="Given to your company"
                    />
                  ) : (
                    <KpiCard
                      label="Awaiting company"
                      value={kpis.awaiting.toLocaleString()}
                      icon={PackageOpen}
                      tone={kpis.awaiting > 0 ? "high" : "neutral"}
                      context={`${kpis.unrouted.toLocaleString()} open Kejanggalan not routed · ${kpis.assigned.toLocaleString()} Pencawang assigned`}
                    />
                  )}
                </div>

                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Eyebrow>Progress by work type</Eyebrow>
                    <span className="text-[12px] text-[var(--muted)]">
                      {workType === "ALL"
                        ? "Pick a work type to count only that work on every row"
                        : `Showing ${CATEGORY_LABEL[workType]} only`}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {kpis.byType.map((type) => {
                      const active = workType === type.category;
                      return (
                        <button
                          key={type.category}
                          type="button"
                          aria-pressed={active}
                          disabled={type.total === 0 && !active}
                          onClick={() => setWorkType(active ? "ALL" : type.category)}
                          title={active ? "Show every work type" : `Count ${CATEGORY_LABEL[type.category]} only`}
                          className={`rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                            active
                              ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                              : "border-[var(--line)] hover:border-[var(--line-strong)] disabled:hover:border-[var(--line)]"
                          }`}
                        >
                          <p className="mb-1.5 text-[13px] font-semibold text-[var(--foreground)]">
                            {CATEGORY_LABEL[type.category]}
                          </p>
                          {type.total > 0 ? (
                            <ProgressBar progress={type.progress} />
                          ) : (
                            <p className="text-[12px] text-[var(--muted)]">No Kejanggalan</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {PROGRESS_PARTS.map((part) => (
                      <LegendDot key={part.key} color={part.color} label={part.label} />
                    ))}
                  </div>
                </Card>

                <FilterBar>
                  <span className="inline-flex items-center gap-1.5">
                    {view === "LIST" ? (
                      <List size={16} className="text-[var(--muted)]" />
                    ) : (
                      <MapIcon size={16} className="text-[var(--muted)]" />
                    )}
                    <Seg aria-label="View" options={VIEW_OPTIONS} value={view} onChange={setView} />
                  </span>
                  <SearchField
                    placeholder="Search Pencawang or Mainhead"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <select
                    aria-label="Mainhead"
                    value={mainheadFilter}
                    onChange={(event) => setMainheadFilter(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="ALL">All Mainheads</option>
                    {mainheads.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Work type"
                    value={workType}
                    onChange={(event) => setWorkType(event.target.value as WorkTypeFilter)}
                    className={filterSelectClass}
                  >
                    <option value="ALL">All work types</option>
                    {CATEGORY_ORDER.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABEL[category]} only
                      </option>
                    ))}
                  </select>
                  <Seg
                    aria-label="Assignment status"
                    options={isCompany ? COMPANY_STATUS_OPTIONS : STATUS_OPTIONS}
                    value={statusFilter}
                    onChange={setStatusFilter}
                  />
                </FilterBar>

                {view === "MAP" ? (
                  <MapView
                    board={board}
                    rows={filteredRows}
                    search={search}
                    selected={selected}
                    onToggle={toggleSelected}
                    onAdd={addSelected}
                    onAssign={openBulk}
                    onClear={() => setSelected(new Set())}
                    onOpenPoles={(row) => setPoleRow(original(row))}
                    onReports={(picked) => setReportRows(picked.map(original))}
                  />
                ) : (
                  <>
                    {board.canAssign ? (
                      <SelectionBar
                        count={selected.size}
                        onAssign={openBulk}
                        onClear={() => setSelected(new Set())}
                        onReports={() => setReportRows(selectedRows)}
                      />
                    ) : null}
                    <Card padded={false}>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] border-collapse">
                          <thead className={tableHeadClass}>
                            <tr>
                              {board.canAssign ? (
                                <th className="w-10 px-3.5 py-2.5">
                                  <input
                                    type="checkbox"
                                    aria-label="Select all shown"
                                    className={checkboxClass}
                                    checked={allVisibleSelected}
                                    disabled={selectableRows.length === 0}
                                    onChange={() =>
                                      setSelected((current) => {
                                        const next = new Set(current);
                                        for (const row of selectableRows) {
                                          if (allVisibleSelected) next.delete(row.siteVisitId);
                                          else next.add(row.siteVisitId);
                                        }
                                        return next;
                                      })
                                    }
                                  />
                                </th>
                              ) : null}
                              <th className={tableHeadCellClass}>Pencawang</th>
                              <th className={tableHeadCellClass}>Report</th>
                              <th className={tableHeadCellClass}>Progress</th>
                              <th className={tableHeadCellClass}>Work types</th>
                              <th className={tableHeadCellClass}>Company / team</th>
                              <th className={tableHeadCellClass}>Target</th>
                              <th className={tableHeadCellClass} aria-label="Actions" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => {
                              const summary = assignmentSummary(row, board);
                              const selectable = isSelectable(row);
                              const due = dueInfo(row, board);
                              return (
                                <tr key={row.siteVisitId} className={tableRowClass}>
                                  {board.canAssign ? (
                                    <td className="w-10 px-3.5">
                                      <input
                                        type="checkbox"
                                        aria-label={`Select ${pencawangLabel(row)}`}
                                        className={checkboxClass}
                                        checked={selected.has(row.siteVisitId)}
                                        disabled={!selectable}
                                        onChange={() => toggleSelected(row.siteVisitId)}
                                      />
                                    </td>
                                  ) : null}
                                  <td className={tableCellClass}>
                                    <div className="font-semibold text-[var(--foreground)]">
                                      {pencawangLabel(row)}
                                    </div>
                                    <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                                      {row.mainhead?.name ?? "No Mainhead"}
                                      {row.cycleNumber ? ` · Cycle ${row.cycleNumber}` : ""}
                                      {row.operationalScope ? ` · ${row.operationalScope}` : ""}
                                    </div>
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {formatDate(row.laporanSelesaiAt)}
                                  </td>
                                  <td className={tableCellClass}>
                                    <ProgressBar progress={progressOf(row)} compact />
                                    <div className="text-[11.5px] text-[var(--muted)]">
                                      {row.poleCount} pole{row.poleCount === 1 ? "" : "s"}
                                      {(row.totals.noTeam ?? 0) > 0 ? (
                                        <span className="font-semibold text-[var(--high-text)]">
                                          {" "}
                                          · {row.totals.noTeam} no team
                                        </span>
                                      ) : null}
                                    </div>
                                  </td>
                                  <td className={tableCellClass}>
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.lanes
                                        .filter((lane) => lane.total > 0)
                                        .map((lane) => {
                                          const chip = laneChip(lane);
                                          return (
                                            <Chip key={lane.category} tone={chip.tone} title={chip.title}>
                                              {chip.text}
                                            </Chip>
                                          );
                                        })}
                                    </div>
                                  </td>
                                  <td className={tableCellClass}>
                                    <Chip tone={summary.tone}>{summary.text}</Chip>
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {due.earliest ? (
                                      <span
                                        className={
                                          due.overdue ? "font-semibold text-[var(--critical-text)]" : undefined
                                        }
                                        title={due.varies ? "Earliest of several target dates" : undefined}
                                      >
                                        {formatDate(due.earliest)}
                                        {due.varies ? " +" : ""}
                                        {due.overdue ? " · overdue" : ""}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap text-right`}>
                                    <Tbtn variant="ghost" onClick={() => setPoleRow(original(row))} className="mr-1">
                                      Poles
                                    </Tbtn>
                                    <Tbtn
                                      variant="ghost"
                                      onClick={() => setReportRows([original(row)])}
                                      className="mr-1"
                                      title="Laporan Pembaikan Kejanggalan (PDF)"
                                    >
                                      Report
                                    </Tbtn>
                                    {board.canAssign ? (
                                      <Tbtn
                                        variant="ghost"
                                        onClick={() => setFindingRow(original(row))}
                                        className="mr-1"
                                        title="Add a Kejanggalan found after the survey"
                                      >
                                        + Kejanggalan
                                      </Tbtn>
                                    ) : null}
                                    {board.canAssign && selectable ? (
                                      <Tbtn
                                        variant={row.packages.length === 0 ? "primary" : "secondary"}
                                        onClick={() => {
                                          setDialogError("");
                                          setDialogRow(original(row));
                                        }}
                                      >
                                        {row.packages.length === 0 ? "Assign" : "Manage"}
                                      </Tbtn>
                                    ) : board.canAssign ? (
                                      <span className="text-[12px] text-[var(--muted)]">
                                        {isCompany ? "Another company" : "TNB only"}
                                      </span>
                                    ) : null}
                                  </td>
                                </tr>
                              );
                            })}
                            {rows.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={board.canAssign ? 8 : 7}
                                  className="px-4 py-12 text-center text-[13px] text-[var(--muted)]"
                                >
                                  {board.pencawangs.length === 0
                                    ? "No Pencawang has a completed survey report with Kejanggalan yet."
                                    : "No Pencawang match these filters."}
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  </>
                )}
              </>
            ) : isLoading ? (
              <Card className="px-5 py-12 text-center text-[13px] text-[var(--muted)]">
                Loading packages…
              </Card>
            ) : null}
          </div>
        </div>
      </main>

      {dialogRow && board ? (
        <AssignDialog
          key={dialogRow.siteVisitId}
          row={board.pencawangs.find((row) => row.siteVisitId === dialogRow.siteVisitId) ?? dialogRow}
          companies={board.companies}
          teams={board.teams}
          busy={isSaving}
          error={dialogError}
          onClose={() => (isSaving ? undefined : setDialogRow(null))}
          onWithdraw={setWithdrawTarget}
          actorKind={board.actorKind}
          initialCategory={workType === "ALL" ? null : workType}
          onSplitPoles={() => {
            setPoleRow(dialogRow);
            setDialogRow(null);
          }}
          onSubmit={(input) =>
            void runWrite(async (token) => {
              const result = await assignMaintenancePackage(token, {
                siteVisitId: dialogRow.siteVisitId,
                ...input,
              });
              return routingMessage(result.routing);
            }).then((ok) => {
              if (ok) setDialogRow(null);
            })
          }
        />
      ) : null}

      {bulkOpen && board ? (
        <BulkAssignDialog
          rows={selectedRows}
          companies={board.companies}
          teams={board.teams}
          actorKind={board.actorKind}
          busy={isSaving}
          error={dialogError}
          onClose={() => (isSaving ? undefined : setBulkOpen(false))}
          onSubmit={(input) => {
            let result: BulkAssignResult | null = null;
            void runWrite(async (token) => {
              result = await assignMaintenancePackagesBulk(token, {
                siteVisitIds: selectedRows.map((row) => row.siteVisitId),
                ...input,
              });
              return bulkMessage(result, board.pencawangs);
            }).then((ok) => {
              if (!ok || !result) return;
              const assigned = new Set(
                (result as BulkAssignResult).results
                  .filter((row) => row.status === "ASSIGNED")
                  .map((row) => row.siteVisitId),
              );
              // Keep only the skipped ones selected, so they can be retried.
              setSelected((current) => new Set([...current].filter((id) => !assigned.has(id))));
              setBulkOpen(false);
            });
          }}
        />
      ) : null}

      {findingRow && session?.token ? (
        <AddFindingDialog
          token={session.token}
          siteVisitId={findingRow.siteVisitId}
          title={pencawangLabel(findingRow)}
          onClose={() => setFindingRow(null)}
          onAdded={(message) => {
            setNotice(message);
            void loadBoard(session.token);
          }}
          onUnauthorized={handleLogout}
        />
      ) : null}

      {reportRows && board && session?.token ? (
        <RepairReportDialog
          token={session.token}
          rows={reportRows}
          board={board}
          initialCategory={workType === "ALL" ? null : workType}
          onClose={() => setReportRows(null)}
          onUnauthorized={handleLogout}
        />
      ) : null}

      {materialsOpen && board && session?.token ? (
        <MaterialsSummaryDialog
          token={session.token}
          companies={board.companies}
          fixedCompany={board.actorKind === "COMPANY"}
          onClose={() => setMaterialsOpen(false)}
          onUnauthorized={handleLogout}
        />
      ) : null}

      {poleRow && board && session?.token ? (
        <PoleSplitDialog
          token={session.token}
          siteVisitId={poleRow.siteVisitId}
          title={pencawangLabel(poleRow)}
          board={board}
          onClose={() => setPoleRow(null)}
          onChanged={(message) => {
            setNotice(message);
            void loadBoard(session.token);
          }}
          onUnauthorized={handleLogout}
        />
      ) : null}

      <ConfirmDialog
        open={withdrawTarget !== null}
        title="Withdraw package?"
        message={
          withdrawTarget
            ? `Kejanggalan ${ownerLabel(withdrawTarget)} has not started return to the unassigned list. Work already photographed stays with them.`
            : ""
        }
        confirmLabel="Withdraw"
        tone="danger"
        isBusy={isSaving}
        onCancel={() => setWithdrawTarget(null)}
        onConfirm={() => {
          const target = withdrawTarget;
          if (!target) return;
          void runWrite(async (token) => {
            const result = await withdrawMaintenancePackage(token, target.id);
            return routingMessage(result.routing);
          }).then(() => setWithdrawTarget(null));
        }}
      />
    </AppShell>
  );
}

function bulkMessage(result: BulkAssignResult, pencawangs: PackagePencawang[]) {
  const names = new Map(pencawangs.map((row) => [row.siteVisitId, pencawangLabel(row)]));
  const totals = result.results.reduce(
    (sum, row) => {
      if (row.status !== "ASSIGNED") return sum;
      return {
        routed: sum.routed + row.routing.routed,
        moved: sum.moved + row.routing.moved,
        kept: sum.kept + row.routing.kept,
        teamAssigned: sum.teamAssigned + row.routing.teamAssigned,
        teamCleared: (sum.teamCleared ?? 0) + (row.routing.teamCleared ?? 0),
      };
    },
    { routed: 0, moved: 0, kept: 0, teamAssigned: 0, teamCleared: 0 },
  );
  const parts = routingParts(totals);
  let message = `Assigned ${result.assigned} Pencawang${parts.length ? ` — ${parts.join(", ")}` : ""}.`;
  const skipped = result.results.filter((row) => row.status === "SKIPPED");
  if (skipped.length > 0) {
    message += ` Skipped ${skipped.length}: ${skipped
      .map((row) => `${names.get(row.siteVisitId) ?? "Pencawang"} (${row.status === "SKIPPED" ? row.reason : ""})`)
      .join("; ")}`;
  }
  return message;
}

export function MaintenancePackagesClient() {
  return (
    <AuthGuard>
      <MaintenancePackagesContent />
    </AuthGuard>
  );
}
