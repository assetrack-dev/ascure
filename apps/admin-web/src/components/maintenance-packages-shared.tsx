"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Eyebrow, IconBtn, filterControlClass, filterSelectClass } from "@/components/ui";
import type {
  MaintenanceCategory,
  PackageCompany,
  PackageDestination,
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
