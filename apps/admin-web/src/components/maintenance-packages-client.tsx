"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
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
  PackageCompany,
  PackageDestination,
  PackagePencawang,
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



type StatusFilter = "ALL" | "AWAITING" | "ASSIGNED";
type ViewMode = "LIST" | "MAP";

const STATUS_OPTIONS = [
  { value: "ALL", label: "All" },
  { value: "AWAITING", label: "Awaiting company" },
  { value: "ASSIGNED", label: "Assigned" },
] as const;

const VIEW_OPTIONS = [
  { value: "LIST", label: "List" },
  { value: "MAP", label: "Map" },
] as const;

/** Marker fills — fixed hex (they paint on the satellite map, not the theme). */
const MAP_COLORS = {
  awaiting: "#f59e0b",
  focus: "#2563eb",
  assigned: "#64748b",
  done: "#16a34a",
} as const;


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
function assignmentSummary(row: PackagePencawang): { text: string; tone: Tone } {
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
}: AssignDialogProps) {
  const lanesWithWork = row.lanes.filter((lane) => lane.total > 0);
  const assignableLanes = lanesWithWork.filter((lane) => lane.canAssign);
  const whole = row.packages.find((pkg) => pkg.category === null) ?? null;
  const [scope, setScope] = useState<"WHOLE" | "LANE">(
    !row.canAssign || (row.packages.length > 0 && !whole) ? "LANE" : "WHOLE",
  );
  const [category, setCategory] = useState<MaintenanceCategory>(
    (assignableLanes[0] ?? lanesWithWork[0])?.category ?? "SELENGGARAAN",
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
                  {lane.canAssign ? "" : " (TNB only)"}
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
          <span className={modalLabelClass}>Company or team</span>
          <DestinationSelect
            companies={companies}
            teams={teams}
            value={destination}
            onChange={setDestination}
            suggestedOrganizationId={row.suggestedOrganizationId}
            className={modalSelectClass}
          />
          <span className="mt-1.5 block text-[12px] text-[var(--muted)]">
            {decoded?.assignedTeamId
              ? "The team sees this work in the app straight away."
              : "The company's Manager picks the team (Maintenance page)."}
            {changesOwner
              ? " Kejanggalan the current crew has already photographed stay with them; the rest move."
              : ""}
          </span>
        </label>

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
                  <button
                    type="button"
                    onClick={() => onWithdraw(pkg)}
                    disabled={busy}
                    className="shrink-0 text-[12px] font-semibold text-[var(--critical-text)] hover:underline disabled:opacity-50"
                  >
                    Withdraw
                  </button>
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
}) {
  const [scope, setScope] = useState<"WHOLE" | "LANE">("WHOLE");
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
          <span className={modalLabelClass}>Company or team</span>
          <DestinationSelect
            companies={companies}
            teams={teams}
            value={destination}
            onChange={setDestination}
            className={modalSelectClass}
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
}: {
  count: number;
  onAssign: () => void;
  onClear: () => void;
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

  const pointColor = useCallback(
    (row: PackagePencawang) => {
      if (row.totals.open === 0) return MAP_COLORS.done;
      if (row.totals.unrouted > 0) return MAP_COLORS.awaiting;
      if (focusTeamId && row.packages.some((pkg) => pkg.team?.id === focusTeamId)) {
        return MAP_COLORS.focus;
      }
      return MAP_COLORS.assigned;
    },
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
      located.map((row) => ({
        id: row.siteVisitId,
        latitude: row.latitude,
        longitude: row.longitude,
        openCount: row.totals.open,
        color: pointColor(row),
        selected: selected.has(row.siteVisitId),
        highlighted: matchIds.has(row.siteVisitId),
        title:
          `${pencawangLabel(row)} — ${row.totals.open} open · ${assignmentSummary(row).text}` +
          (isSelectable(row) ? "" : " (assigned outside your group)"),
      })),
    [located, matchIds, pointColor, selected],
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
          <div className="ml-auto flex flex-wrap gap-3">
            <LegendDot color={MAP_COLORS.awaiting} label="Needs assigning" />
            {focusTeamId ? <LegendDot color={MAP_COLORS.focus} label="Focus team" /> : null}
            <LegendDot color={MAP_COLORS.assigned} label="Assigned" />
            <LegendDot color={MAP_COLORS.done} label="All done" />
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
                    {row.totals.open} open · {assignmentSummary(row).text}
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
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
  const filteredRows = useMemo(
    () =>
      (board?.pencawangs ?? []).filter((row) => {
        if (statusFilter === "AWAITING" && row.packages.length > 0) return false;
        if (statusFilter === "ASSIGNED" && row.packages.length === 0) return false;
        if (mainheadFilter !== "ALL" && row.mainhead?.id !== mainheadFilter) return false;
        return true;
      }),
    [board, mainheadFilter, statusFilter],
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
    const pencawangs = board?.pencawangs ?? [];
    return {
      awaiting: pencawangs.filter((row) => row.packages.length === 0).length,
      assigned: pencawangs.filter((row) => row.packages.length > 0).length,
      open: pencawangs.reduce((sum, row) => sum + row.totals.open, 0),
      unrouted: pencawangs.reduce((sum, row) => sum + row.totals.unrouted, 0),
    };
  }, [board]);

  const openBulk = () => {
    setDialogError("");
    setBulkOpen(true);
  };

  const subtitle =
    board?.actorKind === "MAIN_CONTRACTOR"
      ? "Hand your Pencawang to your own teams or your subcontractors — whole, or split by work type. Use the Map to group nearby Pencawang for one team."
      : "Hand each surveyed Pencawang to a maintenance company, or straight to one of its teams, once its report is complete — whole, or split by work type. Use the Map to group nearby Pencawang for one team.";

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
              <Tbtn
                onClick={() => (session?.token ? loadBoard(session.token) : undefined)}
                disabled={isLoading || !session?.token}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </Tbtn>
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

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard
                    label="Awaiting company"
                    value={kpis.awaiting.toLocaleString()}
                    icon={PackageOpen}
                    tone={kpis.awaiting > 0 ? "high" : "neutral"}
                    context="Report complete, no package yet"
                  />
                  <KpiCard
                    label="Assigned"
                    value={kpis.assigned.toLocaleString()}
                    icon={PackageCheck}
                    context="Pencawang with a company"
                  />
                  <KpiCard
                    label="Open Kejanggalan"
                    value={kpis.open.toLocaleString()}
                    icon={Building2}
                    context="Not yet repaired"
                  />
                  <KpiCard
                    label="Without a company"
                    value={kpis.unrouted.toLocaleString()}
                    icon={CalendarClock}
                    tone={kpis.unrouted > 0 ? "warning" : "neutral"}
                    context="Open Kejanggalan not routed"
                  />
                </div>

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
                  <Seg
                    aria-label="Assignment status"
                    options={STATUS_OPTIONS}
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
                    onOpenPoles={setPoleRow}
                  />
                ) : (
                  <>
                    {board.canAssign ? (
                      <SelectionBar
                        count={selected.size}
                        onAssign={openBulk}
                        onClear={() => setSelected(new Set())}
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
                              <th className={tableHeadCellClass}>Kejanggalan</th>
                              <th className={tableHeadCellClass}>Work types</th>
                              <th className={tableHeadCellClass}>Company / team</th>
                              <th className={tableHeadCellClass}>Target</th>
                              <th className={tableHeadCellClass} aria-label="Actions" />
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => {
                              const summary = assignmentSummary(row);
                              const selectable = isSelectable(row);
                              const dueDates = [
                                ...new Set(row.packages.map((pkg) => pkg.dueDate).filter(Boolean)),
                              ] as string[];
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
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    <span className="font-semibold text-[var(--foreground)]">
                                      {row.totals.open}
                                    </span>{" "}
                                    open / {row.totals.total}
                                    <div className="text-[12px] text-[var(--muted)]">
                                      {row.poleCount} pole{row.poleCount === 1 ? "" : "s"}
                                    </div>
                                  </td>
                                  <td className={tableCellClass}>
                                    <div className="flex flex-wrap gap-1.5">
                                      {row.lanes
                                        .filter((lane) => lane.total > 0)
                                        .map((lane) => (
                                          <Chip
                                            key={lane.category}
                                            tone={lane.organization ? "neutral" : "warning"}
                                            title={
                                              lane.organization
                                                ? lane.team
                                                  ? `${lane.organization.name} · ${lane.team.name}`
                                                  : lane.organization.name
                                                : "No company yet"
                                            }
                                          >
                                            {CATEGORY_LABEL[lane.category]} {lane.open}
                                          </Chip>
                                        ))}
                                    </div>
                                  </td>
                                  <td className={tableCellClass}>
                                    <Chip tone={summary.tone}>{summary.text}</Chip>
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap`}>
                                    {dueDates.length === 0
                                      ? "—"
                                      : dueDates.length === 1
                                        ? formatDate(dueDates[0])
                                        : "Varies"}
                                  </td>
                                  <td className={`${tableCellClass} whitespace-nowrap text-right`}>
                                    <Tbtn variant="ghost" onClick={() => setPoleRow(row)} className="mr-1">
                                      Poles
                                    </Tbtn>
                                    {board.canAssign ? (
                                      <Tbtn
                                        variant="ghost"
                                        onClick={() => setFindingRow(row)}
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
                                          setDialogRow(row);
                                        }}
                                      >
                                        {row.packages.length === 0 ? "Assign" : "Manage"}
                                      </Tbtn>
                                    ) : board.canAssign ? (
                                      <span className="text-[12px] text-[var(--muted)]">TNB only</span>
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
      };
    },
    { routed: 0, moved: 0, kept: 0, teamAssigned: 0 },
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
