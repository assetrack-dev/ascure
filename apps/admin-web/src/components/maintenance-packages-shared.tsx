"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { Eyebrow, IconBtn, filterControlClass, filterSelectClass } from "@/components/ui";
import type {
  MaintenanceCategory,
  PackageCompany,
  PackageDestination,
  PackageProgress,
  PackageTeam,
  RoutingResult,
} from "@/types/maintenance-packages";

/** Shared pieces of the Maintenance Packages page and its pole-split dialog. */

export const CATEGORY_ORDER: MaintenanceCategory[] = ["RENTIS", "CAT_TIANG", "SELENGGARAAN"];

export const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  RENTIS: "Rentis",
  CAT_TIANG: "Cat tiang",
  SELENGGARAAN: "Selenggaraan",
};

export const modalInputClass = `${filterControlClass} mt-1.5 w-full`;
export const modalSelectClass = `${filterSelectClass} mt-1.5 w-full`;
export const modalLabelClass = "text-[12.5px] font-semibold text-[var(--foreground-soft)]";
export const checkboxClass =
  "h-4 w-4 cursor-pointer rounded border-[var(--line-strong)] accent-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40";

// ── Progress helpers (plan §15 J32; shared with the §17 grid) ──────────────

/**
 * Repair state of a Pencawang — marker fill + bar colours.
 * Fixed hex: they paint on the satellite map, not the theme.
 */
export type PeState = "NEEDS_COMPANY" | "NOT_STARTED" | "IN_PROGRESS" | "AWAITING" | "CLOSED";
export const STATE_COLOR: Record<PeState, string> = {
  NEEDS_COMPANY: "#64748b",
  NOT_STARTED: "#dc2626",
  IN_PROGRESS: "#f59e0b",
  AWAITING: "#2563eb",
  CLOSED: "#16a34a",
};

/** Stacked progress bar segments, in order. */
export const PROGRESS_PARTS: Array<{ key: keyof PackageProgress; label: string; color: string }> = [
  { key: "closed", label: "Closed", color: STATE_COLOR.CLOSED },
  { key: "awaiting", label: "Awaiting verification", color: STATE_COLOR.AWAITING },
  { key: "inProgress", label: "In progress", color: STATE_COLOR.IN_PROGRESS },
  { key: "todo", label: "To do", color: "#e2e8f0" },
];

/** Progress of a PE / lane; older APIs only had open / finished. */
export function progressOf(item: {
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

export function formatDate(value: string | null | undefined) {
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

export function pencawangLabel(row: { pencawangName: string | null; pencawangCode: string | null }) {
  return row.pencawangName || row.pencawangCode || "Unnamed Pencawang";
}

export const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

export function routingParts(result: RoutingResult) {
  const parts = [];
  if (result.routed) parts.push(`${result.routed} routed`);
  if (result.moved) parts.push(`${result.moved} moved`);
  if (result.teamAssigned) parts.push(`${result.teamAssigned} handed to the team`);
  if (result.teamCleared) parts.push(`${result.teamCleared} taken off the team (no team yet)`);
  if (result.kept) parts.push(`${result.kept} kept with the previous crew (work already started)`);
  return parts;
}

export function routingMessage(result: RoutingResult) {
  const parts = routingParts(result);
  return parts.length > 0 ? `Saved — ${parts.join(", ")}.` : "Saved — no Kejanggalan changed hands.";
}

export function companyLabel(company: PackageCompany) {
  return company.code ? `${company.name} (${company.code})` : company.name;
}

// ── Destination: "company (its Manager picks the team)" or "a team" ─────────
// Encoded in one <select> value as org:<id> / team:<id>.

export function encodeDestination(organizationId: string | null | undefined, teamId: string | null | undefined) {
  if (teamId) return `team:${teamId}`;
  if (organizationId) return `org:${organizationId}`;
  return "";
}

export function decodeDestination(value: string, teams: PackageTeam[]): PackageDestination | null {
  if (value.startsWith("org:")) {
    return { maintenanceOrganizationId: value.slice(4), assignedTeamId: null };
  }
  if (value.startsWith("team:")) {
    const team = teams.find((candidate) => candidate.id === value.slice(5));
    return team ? { maintenanceOrganizationId: team.organizationId, assignedTeamId: team.id } : null;
  }
  return null;
}

export function DestinationSelect({
  companies,
  teams,
  value,
  onChange,
  suggestedOrganizationId,
  className,
  ariaLabel,
  teamsOnly = false,
}: {
  companies: PackageCompany[];
  teams: PackageTeam[];
  value: string;
  onChange: (value: string) => void;
  suggestedOrganizationId?: string | null;
  className: string;
  ariaLabel?: string;
  /** A contractor Manager only re-teams its own work (plan §15) — no "company picks" option. */
  teamsOnly?: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      required
    >
      <option value="">{teamsOnly ? "Choose a team…" : "Choose a company or team…"}</option>
      {companies.map((company) => (
        <optgroup key={company.id} label={companyLabel(company)}>
          {/* "org:" = the company with NO team: a Manager uses it to take a
              wrongly assigned team off the work (TNB feedback #4). */}
          <option value={`org:${company.id}`}>
            {teamsOnly
              ? "No team — unassigned"
              : `${company.name} — no team yet (company picks)`}
            {!teamsOnly && company.id === suggestedOrganizationId ? " (Mainhead default)" : ""}
          </option>
          {teams
            .filter((team) => team.organizationId === company.id)
            .map((team) => (
              <option key={team.id} value={`team:${team.id}`}>
                Team: {team.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function DialogFrame({
  eyebrow,
  title,
  subtitle,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4 py-6">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-4">
          <div className="min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h2
              className="mt-1 truncate text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
            <p className="mt-1 text-[12.5px] text-[var(--muted)]">{subtitle}</p>
          </div>
          <IconBtn onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: string }) {
  return error ? (
    <div className="rounded-[var(--radius-control)] border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[13px] text-[var(--critical-text)]">
      {error}
    </div>
  ) : null;
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-[var(--foreground-soft)]">
      <span className="h-3 w-3 rounded-full border border-white" style={{ background: color }} />
      {label}
    </span>
  );
}

// ── Row actions (plan §19, N50) ────────────────────────────────────────────

/**
 * The action column stays pinned to the right edge while a wide table scrolls,
 * so Manage / Assign is always on screen. The row needs `group`.
 */
export const pinnedHeadClass =
  "sticky right-0 z-[1] bg-[var(--panel-muted)] shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.28)]";
export const pinnedCellClass =
  "sticky right-0 z-[1] bg-[var(--panel)] shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.28)] transition group-hover:bg-[var(--panel-muted)]";

export type RowMenuItem = { label: string; icon?: ReactNode; onClick: () => void; title?: string };

/**
 * "⋯" menu for the less-used row actions. Positioned against the viewport so a
 * scrolling table (overflow-x) cannot clip it; closes on outside click, Esc,
 * scroll or resize.
 */
export function RowMenu({ items, label = "More actions" }: { items: RowMenuItem[]; label?: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  if (items.length === 0) return null;

  const toggle = () => {
    if (position) {
      setPosition(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={toggle}
        className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] text-[var(--foreground-soft)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--panel-muted)]"
      >
        <MoreHorizontal size={16} />
      </button>
      {position ? (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: position.top, right: position.right }}
          className="z-50 min-w-[200px] overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] py-1 shadow-[var(--shadow-card)]"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={() => {
                setPosition(null);
                item.onClick();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
