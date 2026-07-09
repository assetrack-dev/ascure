import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TONE_TEXT, type Tone } from "./tones";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  /** Colours the value, not the card. */
  tone?: Tone;
  /** Sub-line under the value. A node, not just text — callers pass bars/chips. */
  context?: ReactNode;
  /** Red-tinted card — reserved for emergency / overdue. */
  alarm?: boolean;
}

export function KpiCard({ label, value, icon: Icon, tone = "neutral", context, alarm = false }: KpiCardProps) {
  return (
    <article
      className={`rounded-[var(--radius-card)] border p-[18px] shadow-[var(--shadow-card)] ${
        alarm
          ? "border-[var(--critical-border)] bg-gradient-to-b from-[var(--panel)] to-[var(--danger-tint)]"
          : "border-[var(--line)] bg-[var(--panel)]"
      }`}
    >
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon size={15} className="shrink-0" />
        <p className="truncate text-[12.5px] font-medium">{label}</p>
      </div>
      <p
        className={`mt-2.5 text-[29px] font-bold leading-none tracking-[-0.02em] tabular-nums ${
          alarm ? "text-[var(--critical)]" : TONE_TEXT[tone]
        }`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {/* A <div>, not a <p>: callers pass block-level nodes (e.g. a ProgressBar),
          and a <div> inside a <p> is invalid HTML that React reports as a
          hydration error. */}
      {context ? (
        <div className="mt-2.5 text-[12px] leading-snug text-[var(--muted)]">{context}</div>
      ) : null}
    </article>
  );
}
