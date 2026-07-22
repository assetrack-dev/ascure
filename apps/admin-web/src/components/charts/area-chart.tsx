"use client";

import { useId } from "react";

import {
  formatChartDate,
  niceAxisMax,
  tooltipAnchor,
  useChartHover,
} from "@/components/charts/chart-hover";

export interface AreaPoint {
  date: string;
  value: number;
}

interface AreaChartProps {
  data: AreaPoint[];
  height?: number;
  /** Tooltip unit, e.g. "assets inspected". */
  unitLabel?: string;
  emptyLabel?: string;
}

const VIEW_W = 640;
const PAD = { top: 10, right: 6, bottom: 4, left: 6 };
// Past this many points the per-point dots become noise, so only the line shows.
const DOT_LIMIT = 45;

/**
 * Single-series area chart — brand line over a gradient fill, an end dot, and a
 * value scale. Hovering (or dragging, on touch) scrubs the series: a guide line
 * and dot track the nearest day and a tooltip reads out its date and value.
 *
 * Pure SVG on a fixed viewBox width with `preserveAspectRatio="none"`, so the
 * horizontal axis stretches to the container. That distorts SVG <text>, which is
 * why every label here is an HTML overlay instead — the viewBox height matches
 * the pixel height, so a plot y-coordinate positions an overlay exactly.
 */
export function AreaChart({
  data,
  height = 170,
  unitLabel = "",
  emptyLabel = "No data in this range.",
}: AreaChartProps) {
  const gradientId = useId();
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
  const max = niceAxisMax(Math.max(...data.map((point) => point.value), 1));
  const step = plotW / (data.length - 1);

  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  const line = data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  const last = data[data.length - 1];
  const gridLines = [1, 0.5, 0].map((fraction) => ({
    y: PAD.top + plotH - fraction * plotH,
    label: Math.round(max * fraction).toLocaleString(),
  }));

  const active = activeIndex === null ? null : data[activeIndex];
  const activePercent = activeIndex === null ? 0 : percentFor(activeIndex);

  return (
    <div>
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
          aria-label={`Trend of ${unitLabel || "values"} over ${data.length} points, peak ${max}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((grid, index) => (
            <line
              key={index}
              x1={PAD.left}
              x2={VIEW_W - PAD.right}
              y1={grid.y}
              y2={grid.y}
              stroke="var(--line2)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Per-day dots on a short range — a lone spike among zeroes is
              otherwise a 1px tick that reads as an empty chart. */}
          {data.length <= DOT_LIMIT
            ? data.map((point, index) =>
                point.value > 0 ? (
                  <circle
                    key={index}
                    cx={x(index)}
                    cy={y(point.value)}
                    r={2.5}
                    fill="var(--brand)"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )
            : null}

          {activeIndex !== null && active ? (
            <>
              <line
                x1={x(activeIndex)}
                x2={x(activeIndex)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--brand)"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={x(activeIndex)}
                cy={y(active.value)}
                r={4.5}
                fill="var(--brand)"
                stroke="var(--panel)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <circle cx={x(data.length - 1)} cy={y(last.value)} r={3.5} fill="var(--brand)" stroke="var(--panel)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* Value scale — HTML so the text stays crisp under the stretched SVG. */}
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
            <span className="font-semibold text-[var(--foreground)]">
              {active.value.toLocaleString()}
            </span>
            {unitLabel ? (
              <span className="text-[var(--muted)]"> {unitLabel}</span>
            ) : null}
            <span className="ml-1.5 text-[var(--muted-2)]">
              {formatChartDate(active.date)}
            </span>
          </div>
        ) : null}
      </div>

      {/* Date range under the plot, so the x-axis isn't a mystery. */}
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-[var(--muted-2)]">
        <span>{formatChartDate(data[0].date)}</span>
        <span>{formatChartDate(last.date)}</span>
      </div>
    </div>
  );
}
