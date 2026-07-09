import { TONE_SOLID, type Tone } from "./tones";

interface ProgressBarProps {
  /** 0–100. Clamped. */
  value: number;
  tone?: Tone;
  /** Track width in px; the design's table bar is 130. */
  width?: number;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  tone = "brand",
  width,
  showLabel = true,
  className = "",
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  // Complete work reads as success regardless of the caller's tone.
  const fillTone: Tone = tone === "brand" && pct >= 100 ? "success" : tone;

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[7px] flex-1 overflow-hidden rounded-full bg-[var(--panel-muted)]"
        style={width ? { width, flex: "none" } : undefined}
      >
        <i className={`block h-full rounded-full transition-[width] ${TONE_SOLID[fillTone]}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? (
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--muted)]">
          {Math.round(pct)}%
        </span>
      ) : null}
    </div>
  );
}
