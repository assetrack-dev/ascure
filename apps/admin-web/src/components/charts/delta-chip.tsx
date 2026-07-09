import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface DeltaChipProps {
  current: number;
  previous: number;
  /** Suffix on the value, e.g. "%" for a percentage-point delta. */
  suffix?: string;
  /**
   * When true, a DECREASE is good (open defects, overdue, emergencies) — the
   * colour follows meaning, not sign. Default: an increase is good.
   */
  invert?: boolean;
}

/**
 * Period-over-period delta. Colour follows *meaning* (good = success, bad =
 * critical), arrow follows *sign*. A zero delta or an absent previous reads
 * neutral rather than inventing a trend.
 */
export function DeltaChip({ current, previous, suffix = "", invert = false }: DeltaChipProps) {
  const delta = current - previous;
  const rounded = Math.round(delta * 10) / 10;
  const isFlat = rounded === 0 || !Number.isFinite(previous);

  const isGood = invert ? rounded < 0 : rounded > 0;
  const tone = isFlat
    ? "text-[var(--muted)]"
    : isGood
      ? "text-[var(--success-text)]"
      : "text-[var(--critical-text)]";

  const Icon = isFlat ? Minus : rounded > 0 ? ArrowUpRight : ArrowDownRight;
  const magnitude = Math.abs(rounded).toLocaleString();

  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-semibold tabular-nums ${tone}`}>
      <Icon size={13} className="shrink-0" />
      {isFlat ? "0" : magnitude}
      {suffix}
    </span>
  );
}
