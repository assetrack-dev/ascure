import { TONE_SOLID, type Tone } from "@/components/ui";

interface GaugeProps {
  /** 0–100. Clamped. */
  value: number;
  label?: string;
  caption?: string;
  /** Thresholds flip the arc tone: ≥good → success, ≥warn → warning, else critical. */
  goodAt?: number;
  warnAt?: number;
}

const R = 60;
const CX = 75;
const CY = 72;
const SEMI = Math.PI * R; // length of the semicircle arc
const FULL = 2 * Math.PI * R;

/** Semicircular gauge — a single 0–100 measure (e.g. SLA on-time %). */
export function Gauge({ value, label, caption, goodAt = 90, warnAt = 75 }: GaugeProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const filled = (pct / 100) * SEMI;

  const tone: Tone = pct >= goodAt ? "success" : pct >= warnAt ? "warning" : "critical";
  const colorClass = TONE_SOLID[tone].replace("bg-[", "text-[");

  // Left→right arc over the top (180°).
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 150 84" width="100%" height="auto" className={`max-w-[220px] ${colorClass}`} role="img" aria-label={`${label ?? "Gauge"}: ${Math.round(pct)}%`}>
        <path d={arc} fill="none" stroke="var(--panel-muted)" strokeWidth={12} strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke="currentColor"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${FULL}`}
        />
        <text x={CX} y={CY - 10} textAnchor="middle" className="fill-[var(--foreground)]" style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700 }}>
          {Math.round(pct)}%
        </text>
      </svg>
      {label ? <p className="mt-1 text-[13px] font-semibold text-[var(--foreground)]">{label}</p> : null}
      {caption ? <p className="mt-0.5 text-[12px] text-[var(--muted)]">{caption}</p> : null}
    </div>
  );
}
