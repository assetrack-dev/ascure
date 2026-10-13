"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Tbtn } from "@/components/ui";

/**
 * One red bar for open emergencies (docs/PLAN-maintenance-flow.md §19, N51):
 * folded by default so it no longer pushes the page down, but impossible to
 * miss — count + oldest item, and "Show" opens the list (assign controls live
 * inside on Maintenance Packages). Renders nothing when there is none.
 */
export function EmergencyBar({
  count,
  title,
  detail,
  action,
  children,
  defaultOpen = false,
}: {
  count: number;
  /** e.g. "3 emergencies waiting for a company". */
  title: string;
  /** One line under the title, e.g. the oldest item. */
  detail?: ReactNode;
  /** Extra control next to Show / Hide (e.g. a link to where they are assigned). */
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  if (count === 0) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--critical-border)] bg-gradient-to-r from-[var(--danger-tint)] to-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-[var(--critical-border)] bg-[var(--panel)] text-[var(--critical-text)]">
          <AlertTriangle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            className="text-[14px] font-semibold leading-tight text-[var(--critical-text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h2>
          {detail ? <p className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{detail}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          <Tbtn variant="danger" aria-expanded={isOpen} onClick={() => setIsOpen((current) => !current)}>
            <ChevronDown size={15} className={isOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            {isOpen ? "Hide" : `Show ${count}`}
          </Tbtn>
        </div>
      </div>
      {isOpen ? <div className="border-t border-[var(--critical-border)] bg-[var(--panel)]">{children}</div> : null}
    </section>
  );
}
