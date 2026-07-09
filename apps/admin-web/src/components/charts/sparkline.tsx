import { TONE_SOLID, type Tone } from "@/components/ui";

interface SparklineProps {
  data: number[];
  /** Explicit tone, else coloured by first→last direction. */
  tone?: Tone;
  width?: number;
  height?: number;
}

/**
 * Tiny inline trend line — one series, no axes. Colours by direction (up =
 * success, down = critical) unless a tone is forced. SVG scales via viewBox.
 */
export function Sparkline({ data, tone, width = 84, height = 24 }: SparklineProps) {
  const points = data.filter((value) => Number.isFinite(value));

  if (points.length < 2) {
    return <span className="text-[11px] text-[var(--muted-2)]">—</span>;
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  // Inset 2px so the stroke isn't clipped at the top/bottom edge.
  const pad = 2;
  const usable = height - pad * 2;

  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = pad + usable - ((value - min) / span) * usable;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const direction: Tone = points[points.length - 1] >= points[0] ? "success" : "critical";
  const strokeTone = tone ?? direction;
  // Reuse the solid-fill token classes as a stroke via currentColor.
  const colorClass = TONE_SOLID[strokeTone].replace("bg-[", "text-[");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={colorClass}
      fill="none"
      aria-hidden
    >
      <path d={path} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
