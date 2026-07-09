/**
 * The status vocabulary shared by every chip, dot, bar and KPI in the console.
 *
 * Note on text colour: the design handoff paints chip text with the *base*
 * status colour (e.g. OK = #16A34A on #E9F4EA). At 11px/600 that is 3.1:1 —
 * below WCAG AA. We use the `--*-text` tokens instead, which exist for exactly
 * this and which also invert correctly in dark mode. Dots and bars keep the
 * base colour, where contrast isn't a text concern.
 */
export type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "high"
  | "critical"
  | "monitor"
  | "brand";

/** Bordered pill fills — chips and tags. */
export const TONE_CHIP: Record<Tone, string> = {
  neutral: "border-[var(--neutral-border)] bg-[var(--neutral-bg)] text-[var(--neutral-text)]",
  info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]",
  warning: "border-[var(--medium-border)] bg-[var(--medium-bg)] text-[var(--medium-text)]",
  high: "border-[var(--high-border)] bg-[var(--high-bg)] text-[var(--high-text)]",
  critical: "border-[var(--critical-border)] bg-[var(--critical-bg)] text-[var(--critical-text)]",
  monitor: "border-[var(--monitor-border)] bg-[var(--monitor-bg)] text-[var(--monitor-text)]",
  brand: "border-[var(--brand-soft)] bg-[var(--brand-tint)] text-[var(--brand-strong)]",
};

/** Solid fills — legend dots, lane dots, progress fills. */
export const TONE_SOLID: Record<Tone, string> = {
  neutral: "bg-[var(--neutral)]",
  info: "bg-[var(--info)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--medium)]",
  high: "bg-[var(--high)]",
  critical: "bg-[var(--critical)]",
  monitor: "bg-[var(--monitor)]",
  brand: "bg-[var(--brand)]",
};

/** Foreground-only — KPI values that carry a status meaning. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-[var(--foreground)]",
  info: "text-[var(--info)]",
  success: "text-[var(--success)]",
  warning: "text-[var(--medium)]",
  high: "text-[var(--high)]",
  critical: "text-[var(--critical)]",
  monitor: "text-[var(--monitor)]",
  brand: "text-[var(--brand)]",
};
