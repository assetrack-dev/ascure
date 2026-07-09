export interface DualLinePoint {
  date: string;
  a: number;
  b: number;
}

interface DualLineChartProps {
  data: DualLinePoint[];
  /** Series A — defaults tuned for "opened" (high/orange). */
  aLabel?: string;
  aColor?: string;
  /** Series B — defaults tuned for "closed" (success/green). */
  bLabel?: string;
  bColor?: string;
  height?: number;
  emptyLabel?: string;
}

const VIEW_W = 640;
const PAD = { top: 10, right: 6, bottom: 4, left: 6 };

/** Two overlaid lines sharing a y-scale — e.g. defect intake vs. closure. */
export function DualLineChart({
  data,
  aLabel = "Opened",
  aColor = "var(--high)",
  bLabel = "Closed",
  bColor = "var(--success)",
  height = 170,
  emptyLabel = "No data in this range.",
}: DualLineChartProps) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 text-center text-[13px] text-[var(--muted)]" style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(...data.flatMap((point) => [point.a, point.b]), 1);
  const step = plotW / (data.length - 1);

  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  const pathFor = (key: "a" | "b") =>
    data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");

  const gridYs = [0, 0.5, 1].map((fraction) => PAD.top + plotH - fraction * plotH);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11.5px] font-medium">
        <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
          <i className="h-0.5 w-3 rounded-full" style={{ background: aColor }} />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
          <i className="h-0.5 w-3 rounded-full" style={{ background: bColor }} />
          {bLabel}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${aLabel} vs ${bLabel} over ${data.length} points`}
      >
        {gridYs.map((gy, index) => (
          <line key={index} x1={PAD.left} x2={VIEW_W - PAD.right} y1={gy} y2={gy} stroke="var(--line2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={pathFor("a")} fill="none" stroke={aColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={pathFor("b")} fill="none" stroke={bColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
