"use client";

import { useId } from "react";

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

/**
 * Single-series area chart — brand line over a gradient fill, three gridlines,
 * an end dot. Pure SVG scaled to the container via a fixed viewBox width; the
 * height is fixed in px so the aspect stays sane across ranges (7…365 points).
 */
export function AreaChart({
  data,
  height = 170,
  unitLabel = "",
  emptyLabel = "No data in this range.",
}: AreaChartProps) {
  const gradientId = useId();

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center rounded-[9px] border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 text-center text-[13px] text-[var(--muted)]" style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = Math.max(...data.map((point) => point.value), 1);
  const step = plotW / (data.length - 1);

  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;

  const line = data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  const last = data[data.length - 1];
  const gridYs = [0, 0.5, 1].map((fraction) => PAD.top + plotH - fraction * plotH);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend of ${unitLabel || "values"} over ${data.length} points`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridYs.map((gy, index) => (
        <line
          key={index}
          x1={PAD.left}
          x2={VIEW_W - PAD.right}
          y1={gy}
          y2={gy}
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
      <circle cx={x(data.length - 1)} cy={y(last.value)} r={3.5} fill="var(--brand)" stroke="var(--panel)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
