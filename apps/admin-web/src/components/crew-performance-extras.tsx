"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Chip, IconBtn, filterControlClass, filterSelectClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  fetchMaintenanceScopes,
  fetchSurveyScopes,
  type MaintenanceDayRow,
  type MaintenanceScopeTotals,
  type MaintenanceScopes,
  type SurveyDayRow,
  type SurveyScopes,
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
const BAR = [
  { key: "closed", label: "Closed", color: "#16a34a" },
  { key: "awaiting", label: "Waiting verification", color: "#2563eb" },
  { key: "inProgress", label: "In progress", color: "#f59e0b" },
  { key: "todo", label: "To do", color: "#cbd5e1" },
] as const;

function ProgressLine({ totals }: { totals: MaintenanceScopeTotals }) {
  const pct = totals.total === 0 ? 0 : Math.round((totals.closed / totals.total) * 100);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-[var(--line2)]">
        {totals.total > 0
          ? BAR.map((part) =>
              totals[part.key] > 0 ? (
                <span
                  key={part.key}
                  title={`${part.label}: ${totals[part.key]}`}
                  style={{ width: `${(totals[part.key] / totals.total) * 100}%`, background: part.color }}
                />
              ) : null,
            )
          : null}
      </div>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        <span className="font-semibold text-[var(--foreground)]">{totals.closed}</span>/{totals.total} closed ({pct}%)
        {totals.awaiting > 0 ? ` · ${totals.awaiting} waiting verification` : ""}
        {totals.inProgress > 0 ? ` · ${totals.inProgress} in progress` : ""}
        {` · in period: ${totals.repaired} repaired, ${totals.verified} verified`}
      </p>
    </div>
  );
}

export function ScopePanel({
  token,
  kind,
  company,
  period,
  onClose,
  onUnauthorized,
}: {
  token: string;
  kind: "SURVEY" | "MAINTENANCE";
  company: { id: string; name: string };
  period: Period;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [survey, setSurvey] = useState<SurveyScopes | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceScopes | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    const request =
      kind === "SURVEY"
        ? fetchSurveyScopes(token, company.id, period.from, period.to).then((data) => {
            if (!cancelled) setSurvey(data);
          })
        : fetchMaintenanceScopes(token, company.id, period.from, period.to).then((data) => {
            if (!cancelled) setMaintenance(data);
          });
    request.catch((loadError) => {
      if (cancelled) return;
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load the progress.");
    });
    return () => {
      cancelled = true;
    };
  }, [company.id, kind, onUnauthorized, period.from, period.to, token]);

  const loading = !error && (kind === "SURVEY" ? !survey : !maintenance);
  return (
    <Panel
      title={company.name}
      subtitle={
        kind === "SURVEY"
          ? `Survey progress by scope · ${formatDay(period.from)} – ${formatDay(period.to)}`
          : `Maintenance progress by work type · repaired / verified ${formatDay(period.from)} – ${formatDay(period.to)}`
      }
      onClose={onClose}
    >
      {error ? <p className="text-[13px] text-[var(--critical-text)]">{error}</p> : null}
      {loading ? <p className="text-[13px] text-[var(--muted)]">Loading…</p> : null}

      {kind === "SURVEY" && survey ? (
        survey.scopes.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No surveys by this company in the period.</p>
        ) : (
          survey.scopes.map((scope) => (
            <section key={scope.scope} className="rounded-[var(--radius-card)] border border-[var(--line)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                  {SURVEY_SCOPE_LABEL[scope.scope] ?? scope.scope}
                </h3>
                <Chip tone="brand">{scope.assetsInspected.toLocaleString()} poles</Chip>
              </div>
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                {scope.submittedInspections.toLocaleString()} inspections · {scope.surveyors} surveyor
                {scope.surveyors === 1 ? "" : "s"}
              </p>
              <ul className="mt-3 divide-y divide-[var(--line2)] border-t border-[var(--line2)]">
                {scope.teams.map((team) => (
                  <li key={team.teamName} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="font-medium text-[var(--foreground-soft)]">{team.teamName}</span>
                    <span className="font-mono tabular-nums text-[var(--foreground)]">
                      {team.assetsInspected} poles
                      <span className="text-[var(--muted)]"> · {team.surveyors} crew</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )
      ) : null}

      {kind === "MAINTENANCE" && maintenance ? (
        maintenance.scopes.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">No maintenance work routed to this company.</p>
        ) : (
          maintenance.scopes.map((scope) => (
            <section key={scope.scope} className="rounded-[var(--radius-card)] border border-[var(--line)] p-4">
              <h3 className="text-[15px] font-semibold text-[var(--foreground)]">
                {WORK_TYPE_LABEL[scope.scope] ?? scope.scope}
              </h3>
              <div className="mt-2">
                <ProgressLine totals={scope} />
              </div>
              <ul className="mt-3 space-y-3 border-t border-[var(--line2)] pt-3">
                {scope.teams.map((team) => (
                  <li key={team.teamName}>
                    <p className="text-[13px] font-semibold text-[var(--foreground-soft)]">{team.teamName}</p>
                    <ProgressLine totals={team} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )
      ) : null}
    </Panel>
  );
}

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
