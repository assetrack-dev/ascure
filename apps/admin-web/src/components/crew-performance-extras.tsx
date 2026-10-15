"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { IconBtn, filterControlClass, filterSelectClass } from "@/components/ui";
import {
  type MaintenanceDayRow,
  type MaintenanceTreeCompany,
  type MaintenanceTreeMetrics,
  type SurveyTreeCompany,
  type SurveyTreeMetrics,
  type SurveyDayRow,
} from "@/lib/reports";

/**
 * Crew Performance additions (docs/PLAN-maintenance-flow.md §19, N58): a
 * calendar period with quick picks, the By-day tables, a company's progress by
 * scope, and a maintenance team's day by day.
 */

// ── Period ──────────────────────────────────────────────────────────────────

export type Period = { from: string; to: string };
type Preset = "TODAY" | "YESTERDAY" | "THIS_WEEK" | "LAST_7" | "THIS_MONTH" | "LAST_MONTH" | "CUSTOM";

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "LAST_7", label: "Last 7 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "CUSTOM", label: "Custom dates" },
];

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The dates a quick pick stands for (browser local day = Malaysia for the crews). */
export function presetPeriod(preset: Exclude<Preset, "CUSTOM">): Period {
  const today = new Date();
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  switch (preset) {
    case "TODAY":
      return { from: ymd(today), to: ymd(today) };
    case "YESTERDAY":
      return { from: ymd(day(-1)), to: ymd(day(-1)) };
    case "THIS_WEEK": {
      // Weeks start on Monday.
      const sinceMonday = (today.getDay() + 6) % 7;
      return { from: ymd(day(-sinceMonday)), to: ymd(today) };
    }
    case "LAST_7":
      return { from: ymd(day(-6)), to: ymd(today) };
    case "LAST_MONTH":
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "THIS_MONTH":
    default:
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
  }
}

function matchPreset(period: Period): Preset {
  for (const option of PRESETS) {
    if (option.value === "CUSTOM") continue;
    const candidate = presetPeriod(option.value);
    if (candidate.from === period.from && candidate.to === period.to) return option.value;
  }
  return "CUSTOM";
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  const preset = matchPreset(value);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Period"
        value={preset}
        onChange={(event) => {
          const next = event.target.value as Preset;
          if (next !== "CUSTOM") onChange(presetPeriod(next));
        }}
        className={filterSelectClass}
      >
        {PRESETS.map((option) => (
          <option key={option.value} value={option.value} disabled={option.value === "CUSTOM"}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        type="date"
        aria-label="From"
        value={value.from}
        max={value.to}
        onChange={(event) => event.target.value && onChange({ from: event.target.value, to: value.to })}
        className={filterControlClass}
      />
      <span className="text-[12.5px] text-[var(--muted)]">to</span>
      <input
        type="date"
        aria-label="To"
        value={value.to}
        min={value.from}
        onChange={(event) => event.target.value && onChange({ from: value.from, to: event.target.value })}
        className={filterControlClass}
      />
    </div>
  );
}

export function formatDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "2-digit", month: "short" }).format(
    new Date(year, month - 1, day),
  );
}

// ── By day ──────────────────────────────────────────────────────────────────

const headClass =
  "bg-[var(--panel-muted)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]";
const thClass = "px-3.5 py-2.5 text-left font-semibold";
const tdClass = "px-3.5 py-2.5 text-[13px] text-[var(--foreground-soft)]";
const numClass = "px-3.5 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-[var(--foreground)]";

/** Groups rows by day: the date shows once, with that day's total. */
function byDate<T extends { date: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.date) ?? [];
    list.push(row);
    groups.set(row.date, list);
  }
  return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0]));
}

export function SurveyByDayTable({ rows, showCompany }: { rows: SurveyDayRow[]; showCompany: boolean }) {
  const days = useMemo(() => byDate(rows), [rows]);
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">No surveys in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left">
        <thead>
          <tr className={headClass}>
            <th className={thClass}>Day</th>
            <th className={thClass}>Crew member</th>
            <th className={thClass}>Team</th>
            {showCompany ? <th className={thClass}>Company</th> : null}
            <th className={`${thClass} text-right`}>Poles</th>
            <th className={`${thClass} text-right`}>Inspections</th>
          </tr>
        </thead>
        <tbody>
          {days.map(([date, list]) => (
            <DayGroup
              key={date}
              date={date}
              total={`${list.reduce((sum, row) => sum + row.assetsInspected, 0)} poles`}
              span={showCompany ? 6 : 5}
            >
              {list.map((row) => (
                <tr key={`${date}-${row.userId}`} className="border-b border-[var(--line2)]">
                  <td className={tdClass} />
                  <td className={`${tdClass} font-semibold text-[var(--foreground)]`}>{row.name}</td>
                  <td className={tdClass}>{row.teamName ?? "—"}</td>
                  {showCompany ? <td className={tdClass}>{row.companyName ?? "—"}</td> : null}
                  <td className={`${numClass} font-bold`}>{row.assetsInspected}</td>
                  <td className={numClass}>{row.submittedInspections}</td>
                </tr>
              ))}
            </DayGroup>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MaintenanceByDayTable({
  rows,
  showCompany,
}: {
  rows: MaintenanceDayRow[];
  showCompany: boolean;
}) {
  const days = useMemo(() => byDate(rows), [rows]);
  if (rows.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">No repairs in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left">
        <thead>
          <tr className={headClass}>
            <th className={thClass}>Day</th>
            <th className={thClass}>Team</th>
            {showCompany ? <th className={thClass}>Company</th> : null}
            <th className={`${thClass} text-right`}>Repaired</th>
            <th className={`${thClass} text-right`}>Cannot repair</th>
            <th className={`${thClass} text-right`}>Verified</th>
          </tr>
        </thead>
        <tbody>
          {days.map(([date, list]) => (
            <DayGroup
              key={date}
              date={date}
              total={`${list.reduce((sum, row) => sum + row.repaired, 0)} repaired · ${list.reduce(
                (sum, row) => sum + row.closed,
                0,
              )} verified`}
              span={showCompany ? 6 : 5}
            >
              {list.map((row) => (
                <tr key={`${date}-${row.teamId}`} className="border-b border-[var(--line2)]">
                  <td className={tdClass} />
                  <td className={`${tdClass} font-semibold text-[var(--foreground)]`}>{row.teamName}</td>
                  {showCompany ? <td className={tdClass}>{row.companyName ?? "—"}</td> : null}
                  <td className={`${numClass} font-bold`}>{row.repaired}</td>
                  <td className={numClass}>{row.cannotRepair}</td>
                  <td className={numClass}>{row.closed}</td>
                </tr>
              ))}
            </DayGroup>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayGroup({
  date,
  total,
  span,
  children,
}: {
  date: string;
  total: string;
  span: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="border-b border-[var(--line2)] bg-[var(--panel-muted)]">
        <td colSpan={span} className="px-3.5 py-2 text-[12.5px]">
          <span className="font-semibold text-[var(--foreground)]">{formatDay(date)}</span>
          <span className="text-[var(--muted)]"> · {total}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

// ── Side panel shell ─────────────────────────────────────────────────────────

function Panel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--scrim)]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-[1] flex items-start justify-between gap-3 border-b border-[var(--line2)] bg-[var(--panel)] px-5 py-4">
          <div className="min-w-0">
            <h2
              className="truncate text-[17px] font-bold text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{subtitle}</p>
          </div>
          <IconBtn onClick={onClose} aria-label="Close">
            <X size={16} />
          </IconBtn>
        </div>
        <div className="space-y-4 p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Progress by scope ───────────────────────────────────────────────────────

const SURVEY_SCOPE_LABEL: Record<string, string> = {
  SAVR: "SAVR",
  SAVT: "SAVT",
  PENCAWANG: "Pencawang",
  FEEDER_PILLAR: "Feeder Pillar",
  CABLE_BRIDGE: "Cable Bridge",
  LINK_BOX: "Link Box",
  OTHER: "Other",
};
const WORK_TYPE_LABEL: Record<string, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};
/** One maintenance team's day by day (the Survey tab's per-person drill has its own modal). */
export function TeamDailyPanel({
  team,
  rows,
  period,
  onClose,
}: {
  team: { teamId: string; teamName: string };
  rows: MaintenanceDayRow[] | null;
  period: Period;
  onClose: () => void;
}) {
  const mine = (rows ?? []).filter((row) => row.teamId === team.teamId);
  return (
    <Panel
      title={team.teamName}
      subtitle={`Day by day · ${formatDay(period.from)} – ${formatDay(period.to)}`}
      onClose={onClose}
    >
      {rows === null ? (
        <p className="text-[13px] text-[var(--muted)]">Loading…</p>
      ) : mine.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">Nothing repaired or verified in this period.</p>
      ) : (
        <MaintenanceByDayTable rows={mine} showCompany={false} />
      )}
    </Panel>
  );
}

// ── Drill-down: Company → scope / work type → team (plan §19) ──────────────

function hoursLabel(hours: number | null) {
  if (hours === null) return "—";
  return hours < 24 ? `${Math.round(hours)} h` : `${(hours / 24).toFixed(1)} d`;
}

const LEVEL_PAD = ["pl-3.5", "pl-9", "pl-14"];
const ROW_TONE = ["bg-[var(--panel)]", "bg-[var(--panel-muted)]", "bg-[var(--panel)]"];

function TreeName({
  level,
  label,
  open,
  onToggle,
  onClick,
  hint,
}: {
  level: 0 | 1 | 2;
  label: string;
  open?: boolean;
  /** A level that opens / closes. */
  onToggle?: () => void;
  /** Leaf action (a team's day by day). */
  onClick?: () => void;
  hint?: string;
}) {
  const tone =
    level === 0
      ? "font-bold text-[var(--foreground)]"
      : level === 1
        ? "font-semibold text-[var(--foreground)]"
        : "text-[var(--foreground-soft)]";
  const text = <span className={tone}>{label}</span>;
  return (
    <td className={`${LEVEL_PAD[level]} py-2.5 pr-3.5 text-[13px]`}>
      {onToggle ? (
        <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex items-center gap-1.5 text-left">
          <ChevronRight
            size={15}
            className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-90" : ""}`}
          />
          {text}
        </button>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          title={hint}
          className="ml-[21px] rounded-sm text-left underline decoration-[var(--line)] decoration-dotted underline-offset-4 hover:text-[var(--brand)]"
        >
          {text}
        </button>
      ) : (
        <span className="ml-[21px]">{text}</span>
      )}
    </td>
  );
}

function useExpanded(initial: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initial));
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { open, toggle };
}

function MaintenanceCells({ metrics }: { metrics: MaintenanceTreeMetrics }) {
  return (
    <>
      <td className={`${numClass} font-bold`}>{metrics.repaired}</td>
      <td className={numClass}>{metrics.closed}</td>
      <td className={`${numClass} ${metrics.sentBack > 0 ? "text-[var(--critical-text)]" : ""}`}>{metrics.sentBack}</td>
      <td className={numClass}>{metrics.passRate === null ? "—" : `${Math.round(metrics.passRate)}%`}</td>
      <td className={numClass}>{metrics.cannotRepair}</td>
      <td className={numClass}>{hoursLabel(metrics.avgHoursToDone)}</td>
      <td className={numClass}>{metrics.activeDays}</td>
      <td className={numClass}>{metrics.onHand}</td>
    </>
  );
}

/** Plan §20 (P2): "KAEDAH LAZIM 12 · TEBANG POKOK 3 · not set 2" under a row. */
function MethodsRow({ methods, level }: { methods?: MaintenanceTreeMetrics["methods"]; level: number }) {
  if (!methods || methods.length === 0) return null;
  return (
    <tr className="border-b border-[var(--line2)]">
      <td colSpan={9} className="px-3 pb-2 pt-0" style={{ paddingLeft: `${12 + level * 22}px` }}>
        <div className="flex flex-wrap gap-1.5">
          {methods.map((method) => (
            <span
              key={method.label ?? "unset"}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                method.label
                  ? "border-[var(--line)] bg-[var(--panel-muted)] text-[var(--foreground-soft)]"
                  : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
              }`}
            >
              {method.label ?? "Type not set"} · {method.count}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

/** Maintenance: Company → work type → team; click a team for its day by day. */
export function MaintenanceTree({
  tree,
  onTeam,
}: {
  tree: MaintenanceTreeCompany[];
  onTeam: (team: { teamId: string; teamName: string }) => void;
}) {
  // One company in view → already open.
  const { open, toggle } = useExpanded(tree.length === 1 ? [`c:${tree[0].companyId ?? "none"}`] : []);
  if (tree.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">No maintenance work in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left">
        <thead>
          <tr className={headClass}>
            <th className={thClass}>Company · work type · team</th>
            <th className={`${thClass} text-right`}>Repaired</th>
            <th className={`${thClass} text-right`}>Verified</th>
            <th className={`${thClass} text-right`}>Sent back</th>
            <th className={`${thClass} text-right`} title="Verified ÷ (verified + sent back)">
              Pass
            </th>
            <th className={`${thClass} text-right`}>Can&apos;t repair</th>
            <th className={`${thClass} text-right`} title="Assigned → marked done">
              Avg time
            </th>
            <th className={`${thClass} text-right`}>Days</th>
            <th className={`${thClass} text-right`} title="Assigned / in progress right now">
              On hand
            </th>
          </tr>
        </thead>
        <tbody>
          {tree.map((company) => {
            const companyKey = `c:${company.companyId ?? "none"}`;
            const companyOpen = open.has(companyKey);
            return (
              <Fragment key={companyKey}>
                <tr className={`border-b border-[var(--line2)] ${ROW_TONE[0]}`}>
                  <TreeName level={0} label={company.name} open={companyOpen} onToggle={() => toggle(companyKey)} />
                  <MaintenanceCells metrics={company} />
                </tr>
                {companyOpen
                  ? company.categories.map((category) => {
                      const categoryKey = `${companyKey}|${category.category}`;
                      const categoryOpen = open.has(categoryKey);
                      return (
                        <Fragment key={categoryKey}>
                          <tr className={`border-b border-[var(--line2)] ${ROW_TONE[1]}`}>
                            <TreeName
                              level={1}
                              label={WORK_TYPE_LABEL[category.category] ?? category.category}
                              open={categoryOpen}
                              onToggle={() => toggle(categoryKey)}
                            />
                            <MaintenanceCells metrics={category} />
                          </tr>
                          <MethodsRow methods={category.methods} level={1} />
                          {categoryOpen
                            ? category.teams.map((team) => (
                                <tr
                                  key={`${categoryKey}|${team.teamId}`}
                                  className={`border-b border-[var(--line2)] ${ROW_TONE[2]}`}
                                >
                                  <TreeName
                                    level={2}
                                    label={team.name}
                                    onClick={() => onTeam({ teamId: team.teamId, teamName: team.name })}
                                    hint="Day by day"
                                  />
                                  <MaintenanceCells metrics={team} />
                                </tr>
                              )).flatMap((row, index) => [
                                row,
                                <MethodsRow
                                  key={`${categoryKey}|${category.teams[index].teamId}|methods`}
                                  methods={category.teams[index].methods}
                                  level={2}
                                />,
                              ])
                            : null}
                        </Fragment>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SurveyCells({ metrics }: { metrics: SurveyTreeMetrics }) {
  return (
    <>
      <td className={`${numClass} font-bold`}>{metrics.assetsInspected}</td>
      <td className={numClass}>{metrics.submittedInspections}</td>
      <td className={numClass}>{metrics.surveyors}</td>
      <td className={numClass}>{metrics.activeDays}</td>
    </>
  );
}

/** Survey: Company → scope (SAVR / SAVT / …) → team. */
export function SurveyTree({ tree }: { tree: SurveyTreeCompany[] }) {
  const { open, toggle } = useExpanded(tree.length === 1 ? [`c:${tree[0].companyId ?? "none"}`] : []);
  if (tree.length === 0) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--muted)]">No surveys in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left">
        <thead>
          <tr className={headClass}>
            <th className={thClass}>Company · scope · team</th>
            <th className={`${thClass} text-right`}>Poles</th>
            <th className={`${thClass} text-right`}>Inspections</th>
            <th className={`${thClass} text-right`}>Surveyors</th>
            <th className={`${thClass} text-right`}>Days</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((company) => {
            const companyKey = `c:${company.companyId ?? "none"}`;
            const companyOpen = open.has(companyKey);
            return (
              <Fragment key={companyKey}>
                <tr className={`border-b border-[var(--line2)] ${ROW_TONE[0]}`}>
                  <TreeName level={0} label={company.name} open={companyOpen} onToggle={() => toggle(companyKey)} />
                  <SurveyCells metrics={company} />
                </tr>
                {companyOpen
                  ? company.scopes.map((scope) => {
                      const scopeKey = `${companyKey}|${scope.scope}`;
                      const scopeOpen = open.has(scopeKey);
                      return (
                        <Fragment key={scopeKey}>
                          <tr className={`border-b border-[var(--line2)] ${ROW_TONE[1]}`}>
                            <TreeName
                              level={1}
                              label={SURVEY_SCOPE_LABEL[scope.scope] ?? scope.scope}
                              open={scopeOpen}
                              onToggle={() => toggle(scopeKey)}
                            />
                            <SurveyCells metrics={scope} />
                          </tr>
                          {scopeOpen
                            ? scope.teams.map((team) => (
                                <tr
                                  key={`${scopeKey}|${team.name}`}
                                  className={`border-b border-[var(--line2)] ${ROW_TONE[2]}`}
                                >
                                  <TreeName level={2} label={team.name} />
                                  <SurveyCells metrics={team} />
                                </tr>
                              ))
                            : null}
                        </Fragment>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
