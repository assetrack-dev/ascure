"use client";

import {
  formatChartDate,
  niceAxisMax,
  tooltipAnchor,
  useChartHover,
} from "@/components/charts/chart-hover";

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
const DOT_LIMIT = 45;

/**
 * Two overlaid lines sharing a y-scale — e.g. defect intake vs. closure. Hover
 * (or drag, on touch) to scrub: a guide line tracks the nearest day and the
 * tooltip reads out BOTH series for it, which is the comparison the chart
 * exists to make. Labels are HTML overlays because the SVG stretches
 * horizontally; see AreaChart for the reasoning.
 */
export function DualLineChart({
  data,
  aLabel = "Opened",
  aColor = "var(--high)",
  bLabel = "Closed",
  bColor = "var(--success)",
  height = 170,
  emptyLabel = "No data in this range.",
}: DualLineChartProps) {
  const { frameRef, activeIndex, handlers, percentFor } = useChartHover(data.length);

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 text-center text-[13px] text-[var(--muted)]" style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = niceAxisMax(Math.max(...data.flatMap((point) => [point.a, point.b]), 1));
  const step = plotW / (data.length - 1);

  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  const pathFor = (key: "a" | "b") =>
    data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(" ");

  const gridLines = [1, 0.5, 0].map((fraction) => ({
    y: PAD.top + plotH - fraction * plotH,
    label: Math.round(max * fraction).toLocaleString(),
  }));

  const series = [
    { key: "a" as const, label: aLabel, color: aColor },
    { key: "b" as const, label: bLabel, color: bColor },
  ];

  const active = activeIndex === null ? null : data[activeIndex];
  const activePercent = activeIndex === null ? 0 : percentFor(activeIndex);

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11.5px] font-medium">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1.5 text-[var(--muted)]">
            <i className="h-0.5 w-3 rounded-full" style={{ background: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>

      <div
        ref={frameRef}
        {...handlers}
        className="relative touch-pan-y"
        style={{ height }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${aLabel} vs ${bLabel} over ${data.length} points, peak ${max}`}
        >
          {gridLines.map((grid, index) => (
            <line key={index} x1={PAD.left} x2={VIEW_W - PAD.right} y1={grid.y} y2={grid.y} stroke="var(--line2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {series.map((entry) => (
            <path
              key={entry.key}
              d={pathFor(entry.key)}
              fill="none"
              stroke={entry.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* A single day's activity among zeroes is otherwise invisible. */}
          {data.length <= DOT_LIMIT
            ? series.flatMap((entry) =>
                data.map((point, index) =>
                  point[entry.key] > 0 ? (
                    <circle
                      key={`${entry.key}-${index}`}
                      cx={x(index)}
                      cy={y(point[entry.key])}
                      r={2.5}
                      fill={entry.color}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null,
                ),
              )
            : null}

          {activeIndex !== null && active ? (
            <>
              <line
                x1={x(activeIndex)}
                x2={x(activeIndex)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--muted-2)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              {series.map((entry) => (
                <circle
                  key={entry.key}
                  cx={x(activeIndex)}
                  cy={y(active[entry.key])}
                  r={4.5}
                  fill={entry.color}
                  stroke="var(--panel)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          ) : null}
        </svg>

        {gridLines.map((grid, index) => (
          <span
            key={index}
            className="pointer-events-none absolute left-0 -translate-y-1/2 bg-[var(--panel)] pr-1 font-mono text-[9.5px] tabular-nums text-[var(--muted-2)]"
            style={{ top: grid.y }}
          >
            {grid.label}
          </span>
        ))}

        {activeIndex !== null && active ? (
          <div
            className="pointer-events-none absolute top-1 z-10 whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px] shadow-[var(--shadow-card)]"
            style={tooltipAnchor(activePercent)}
          >
            <div className="mb-0.5 font-mono text-[10px] text-[var(--muted-2)]">
              {formatChartDate(active.date)}
            </div>
            {series.map((entry) => (
              <div key={entry.key} className="flex items-center gap-1.5">
                <i className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color }} />
                <span className="text-[var(--muted)]">{entry.label}</span>
                <span className="ml-auto font-semibold tabular-nums text-[var(--foreground)]">
                  {active[entry.key].toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-[var(--muted-2)]">
        <span>{formatChartDate(data[0].date)}</span>
        <span>{formatChartDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}
