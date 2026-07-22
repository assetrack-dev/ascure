"use client";

import { useCallback, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";

/**
 * Shared hover plumbing for the SVG charts.
 *
 * The charts draw into a fixed 640-wide viewBox with `preserveAspectRatio="none"`,
 * so the horizontal scale is whatever the container happens to be. Pointer x
 * therefore has to be resolved against the RENDERED box, not the viewBox — which
 * is what this does: it turns a pointer position into the index of the nearest
 * data point, and hands back that point's position as a percentage so an HTML
 * overlay (crisp text, unlike stretched SVG <text>) can sit over it.
 */
export function useChartHover(pointCount: number) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const resolve = useCallback(
    (clientX: number) => {
      const frame = frameRef.current;
      if (!frame || pointCount < 2) {
        return;
      }
      const rect = frame.getBoundingClientRect();
      if (rect.width === 0) {
        return;
      }
      const fraction = (clientX - rect.left) / rect.width;
      const index = Math.round(fraction * (pointCount - 1));
      setActiveIndex(Math.min(pointCount - 1, Math.max(0, index)));
    },
    [pointCount],
  );

  const handlers = {
    onMouseMove: (event: ReactMouseEvent) => resolve(event.clientX),
    onMouseLeave: () => setActiveIndex(null),
    // Touch: dragging along the chart scrubs it, same as a mouse.
    onTouchStart: (event: ReactTouchEvent) => {
      const touch = event.touches[0];
      if (touch) resolve(touch.clientX);
    },
    onTouchMove: (event: ReactTouchEvent) => {
      const touch = event.touches[0];
      if (touch) resolve(touch.clientX);
    },
    onTouchEnd: () => setActiveIndex(null),
  };

  /** Horizontal position of a point as a percentage of the plot width. */
  const percentFor = useCallback(
    (index: number) => (pointCount < 2 ? 0 : (index / (pointCount - 1)) * 100),
    [pointCount],
  );

  return { frameRef, activeIndex, handlers, percentFor };
}

/**
 * The value to scale a chart's y-axis to: the next EVEN integer at or above the
 * peak. Keeps the midpoint gridline a whole number (a peak of 1 would otherwise
 * label its ticks "1 / 1 / 0", rounding 0.5 up to a duplicate) and leaves a
 * little headroom so a peak isn't glued to the top edge.
 */
export function niceAxisMax(peak: number): number {
  const safe = Math.max(1, Math.ceil(peak));
  return safe % 2 === 0 ? safe : safe + 1;
}

/** "12 Jul" — compact enough for an axis, unambiguous enough for a tooltip. */
export function formatChartDate(date: string, withYear = false): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(parsed);
}

/**
 * Tooltip placement that never overflows the chart: it tracks the point until
 * the point nears an edge, then pins so the bubble stays fully visible.
 */
export function tooltipAnchor(percent: number): {
  left: string;
  transform: string;
} {
  if (percent < 12) {
    return { left: "0%", transform: "translateX(0)" };
  }
  if (percent > 88) {
    return { left: "100%", transform: "translateX(-100%)" };
  }
  return { left: `${percent}%`, transform: "translateX(-50%)" };
}
