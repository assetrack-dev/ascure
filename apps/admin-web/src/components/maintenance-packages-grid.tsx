"use client";

import { CheckCircle2, FileText, MapPinned } from "lucide-react";
import {
  CATEGORY_LABEL,
  PROGRESS_PARTS,
  checkboxClass,
  formatDate,
  pencawangLabel,
  pinnedCellClass,
  pinnedHeadClass,
  progressOf,
  startOfToday,
} from "@/components/maintenance-packages-shared";
import { Tbtn, tableCellClass, tableHeadCellClass, tableHeadClass, tableRowClass } from "@/components/ui";
import type {
  MaintenanceCategory,
  MaintenancePackageBoard,
  PackagePencawang,
  PackageProgress,
} from "@/types/maintenance-packages";

/**
 * Plan §17.2 — the Grid: one row per Pencawang, one cell per work type showing
 * who has it (team), how far it is (closed / waiting for TNB) and its target
 * date. Click a cell to give that work type to a team.
 */

export interface LaneCellInfo {
  category: MaintenanceCategory;
  /** "Team A", "No team", "No company yet" (+ company for TNB / MC / Admin). */
  owner: string;
  ownerTone: "team" | "noTeam" | "noCompany";
  progress: PackageProgress;
  total: number;
  closed: number;
  awaiting: number;
  noTeam: number;
  dueDate: string | null;
  overdue: boolean;
  /** Poles of this work type handed to other crews (§12.6). */
  splits: Array<{ label: string; poles: number }>;
  canAssign: boolean;
}

/** The work-type cell of a Pencawang, or null when it has no work of that type. */
export function laneCell(
  row: PackagePencawang,
  category: MaintenanceCategory,
  board: MaintenancePackageBoard,
): LaneCellInfo | null {
  const lane = row.lanes.find((candidate) => candidate.category === category);
  if (!lane || lane.total === 0) return null;
  const isCompany = board.actorKind === "COMPANY";
  const own = new Set(board.companies.map((company) => company.id));

  // A company sees a lane another company holds only for its own split poles
  // or work its crew had already started before the move (plan §19, N52).
  const ownSplits = row.poleSplits.filter(
    (split) =>
      (split.category === category || split.category === null) && own.has(split.organization.id),
  );
  const foreignLane = isCompany && lane.organization !== null && !own.has(lane.organization.id);
  const owner = foreignLane
    ? {
        owner:
          ownSplits.length > 0
            ? `Your poles: ${ownSplits
                .map((split) => `${split.team?.name ?? "no team"} ${split.poles}`)
                .join(", ")}`
            : "Started by your crew",
        ownerTone: "team" as const,
      }
    : !lane.organization
    ? { owner: "No company yet", ownerTone: "noCompany" as const }
    : lane.team
      ? {
          owner: isCompany ? lane.team.name : `${lane.organization.name} · ${lane.team.name}`,
          ownerTone: "team" as const,
        }
      : {
          owner: isCompany ? "No team" : `${lane.organization.name} · no team`,
          ownerTone: "noTeam" as const,
        };

  const pkg =
    row.packages.find((candidate) => candidate.category === category) ??
    row.packages.find((candidate) => candidate.category === null) ??
    null;
  const dueDate = pkg?.dueDate ?? null;
  const progress = progressOf(lane);

  return {
    category,
    ...owner,
    progress,
    total: lane.total,
    closed: progress.closed,
    awaiting: progress.awaiting,
    noTeam: lane.noTeam ?? 0,
    dueDate,
    overdue: dueDate !== null && lane.open > 0 && new Date(dueDate).getTime() < startOfToday(),
    splits: (foreignLane ? [] : row.poleSplits)
      .filter((split) => split.category === category || split.category === null)
      .filter((split) => !isCompany || own.has(split.organization.id))
      .map((split) => ({
        label: split.team
          ? isCompany
            ? split.team.name
            : `${split.organization.name} · ${split.team.name}`
          : isCompany
            ? "No team"
            : split.organization.name,
        poles: split.poles,
      })),
    canAssign: board.canAssign && lane.canAssign,
  };
}

/** Closed · waiting for TNB · in progress · to do — thin bar, closed counts to 100% (L40). */
function LaneBar({ progress }: { progress: PackageProgress }) {
  const total = progress.todo + progress.inProgress + progress.awaiting + progress.closed;
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--line2)]"
      title={PROGRESS_PARTS.map((part) => `${part.label}: ${progress[part.key]}`).join(" · ")}
    >
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
  );
}

const OWNER_CLASS: Record<LaneCellInfo["ownerTone"], string> = {
  team: "text-[var(--foreground)]",
  noTeam: "text-[var(--high-text)]",
  noCompany: "text-[var(--muted)]",
};

/** One work-type cell; a button when the viewer may (re)assign it. */
export function WorkTypeCell({
  info,
  onAssign,
  showLabel = false,
}: {
  info: LaneCellInfo | null;
  onAssign?: (category: MaintenanceCategory) => void;
  /** Prefix the work-type name (map side panel; the grid has column headers). */
  showLabel?: boolean;
}) {
  if (!info) {
    return <span className="text-[12px] text-[var(--muted)]">—</span>;
  }
  const done = info.closed === info.total;
  const body = (
    <>
      <div className="flex items-center gap-1.5">
        {done ? <CheckCircle2 size={13} className="shrink-0 text-[#16a34a]" /> : null}
        <span className={`truncate text-[12.5px] font-semibold ${OWNER_CLASS[info.ownerTone]}`}>
          {showLabel ? `${CATEGORY_LABEL[info.category]} · ` : ""}
          {info.owner}
        </span>
      </div>
      <div className="mt-1">
        <LaneBar progress={info.progress} />
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">{info.closed}</span>/{info.total} closed
        {info.awaiting > 0 ? ` · ${info.awaiting} waiting TNB` : ""}
        {info.noTeam > 0 && info.ownerTone === "team" ? (
          <span className="font-semibold text-[var(--high-text)]"> · {info.noTeam} no team</span>
        ) : null}
      </div>
      {info.dueDate ? (
        <div
          className={`text-[11.5px] ${
            info.overdue ? "font-semibold text-[var(--critical-text)]" : "text-[var(--muted)]"
          }`}
        >
          Target {formatDate(info.dueDate)}
          {info.overdue ? " · overdue" : ""}
        </div>
      ) : null}
      {info.splits.length > 0 ? (
        <div className="truncate text-[11.5px] text-[var(--muted)]" title="Poles given to other crews">
          Split: {info.splits.map((split) => `${split.label} ${split.poles}`).join(" · ")}
        </div>
      ) : null}
    </>
  );

  if (info.canAssign && onAssign) {
    return (
      <button
        type="button"
        onClick={() => onAssign(info.category)}
        title={`Give ${CATEGORY_LABEL[info.category]} to a team`}
        className="block w-full min-w-0 rounded-[var(--radius-control)] border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--panel-muted)]"
      >
        {body}
      </button>
    );
  }
  return <div className="min-w-0 px-2 py-1.5">{body}</div>;
}

function rowProgress(row: PackagePencawang, categories: MaintenanceCategory[], board: MaintenancePackageBoard) {
  const cells = categories.map((category) => laneCell(row, category, board)).filter(Boolean) as LaneCellInfo[];
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  const closed = cells.reduce((sum, cell) => sum + cell.closed, 0);
  const awaiting = cells.reduce((sum, cell) => sum + cell.awaiting, 0);
  return { total, closed, awaiting, pct: total === 0 ? 0 : Math.round((closed / total) * 100) };
}

export function MaintenanceGrid({
  board,
  rows,
  categories,
  selected,
  onToggle,
  onToggleAll,
  onAssignLane,
  onOpenPoles,
  onReport,
}: {
  board: MaintenancePackageBoard;
  /** Full Pencawang rows (never the work-type slice). */
  rows: PackagePencawang[];
  categories: MaintenanceCategory[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onAssignLane: (row: PackagePencawang, category: MaintenanceCategory) => void;
  onOpenPoles: (row: PackagePencawang) => void;
  onReport: (row: PackagePencawang) => void;
}) {
  const selectable = (row: PackagePencawang) =>
    row.canAssign || row.lanes.some((lane) => lane.canAssign && lane.total > 0);
  const selectableRows = rows.filter(selectable);
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.siteVisitId));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 470 + categories.length * 210 }}>
        <thead className={tableHeadClass}>
          <tr>
            {board.canAssign ? (
              <th className="w-10 px-3.5 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all shown"
                  className={checkboxClass}
                  checked={allSelected}
                  disabled={selectableRows.length === 0}
                  onChange={onToggleAll}
                />
              </th>
            ) : null}
            <th className={`${tableHeadCellClass} min-w-[220px]`}>Pencawang</th>
            {categories.map((category) => (
              <th key={category} className={`${tableHeadCellClass} w-[210px]`}>
                {CATEGORY_LABEL[category]}
              </th>
            ))}
            <th className={`${tableHeadCellClass} w-[110px]`}>Total</th>
            <th className={`${tableHeadCellClass} ${pinnedHeadClass}`} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const total = rowProgress(row, categories, board);
            return (
              <tr key={row.siteVisitId} className={`group ${tableRowClass} align-top`}>
                {board.canAssign ? (
                  <td className="w-10 px-3.5 pt-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${pencawangLabel(row)}`}
                      className={checkboxClass}
                      checked={selected.has(row.siteVisitId)}
                      disabled={!selectable(row)}
                      onChange={() => onToggle(row.siteVisitId)}
                    />
                  </td>
                ) : null}
                <td className={`${tableCellClass} min-w-[220px]`}>
                  <div className="font-semibold text-[var(--foreground)]">{pencawangLabel(row)}</div>
                  <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                    {row.mainhead?.name ?? "No Mainhead"} · {row.poleCount} pole
                    {row.poleCount === 1 ? "" : "s"}
                  </div>
                </td>
                {categories.map((category) => (
                  <td key={category} className="px-1.5 py-1.5">
                    <WorkTypeCell
                      info={laneCell(row, category, board)}
                      onAssign={(picked) => onAssignLane(row, picked)}
                    />
                  </td>
                ))}
                <td className={tableCellClass}>
                  <div
                    className={`text-[15px] font-bold ${
                      total.total > 0 && total.pct === 100 ? "text-[#16a34a]" : "text-[var(--foreground)]"
                    }`}
                  >
                    {total.pct}%
                  </div>
                  <div className="text-[11.5px] text-[var(--muted)]">
                    {total.closed}/{total.total} closed
                    {total.awaiting > 0 ? ` · ${total.awaiting} waiting` : ""}
                  </div>
                </td>
                <td className={`${tableCellClass} ${pinnedCellClass} whitespace-nowrap`}>
                  <div className="flex items-center justify-end gap-1.5">
                    <Tbtn onClick={() => onOpenPoles(row)} title="Poles of this Pencawang">
                      <MapPinned size={15} />
                      Poles
                    </Tbtn>
                    <Tbtn onClick={() => onReport(row)} title="Laporan Pembaikan Kejanggalan (PDF)">
                      <FileText size={15} />
                      Report
                    </Tbtn>
                  </div>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={categories.length + (board.canAssign ? 4 : 3)}
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
  );
}

/** The grid as a CSV (opens in Excel): one row per Pencawang, columns per work type. */
export function downloadGridCsv(
  board: MaintenancePackageBoard,
  rows: PackagePencawang[],
  categories: MaintenanceCategory[],
) {
  const header = ["Pencawang", "Code", "Mainhead", "Poles"];
  for (const category of categories) {
    const name = CATEGORY_LABEL[category];
    header.push(`${name} team`, `${name} closed`, `${name} waiting TNB`, `${name} total`, `${name} target`);
  }
  header.push("Total closed", "Total", "% closed");

  const lines = [header];
  for (const row of rows) {
    const line: Array<string | number> = [
      row.pencawangName ?? "",
      row.pencawangCode ?? "",
      row.mainhead?.name ?? "",
      row.poleCount,
    ];
    for (const category of categories) {
      const cell = laneCell(row, category, board);
      line.push(
        cell ? cell.owner : "",
        cell ? cell.closed : "",
        cell ? cell.awaiting : "",
        cell ? cell.total : "",
        cell?.dueDate ? cell.dueDate.slice(0, 10) : "",
      );
    }
    const total = rowProgress(row, categories, board);
    line.push(total.closed, total.total, total.pct);
    lines.push(line.map(String));
  }

  const csv = lines
    .map((line) => line.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(","))
    .join("\r\n");
  // BOM so Excel reads the UTF-8 names correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pencawang-progress-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
