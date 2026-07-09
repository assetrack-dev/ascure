"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { IconBtn } from "./button";

/**
 * Class strings rather than wrapper components: the existing tables already own
 * their `<colgroup>`, sortable `<th>` buttons, and row-click handlers. Swapping
 * the class is a restyle; swapping the element would mean reimplementing those.
 */
export const tableHeadClass =
  "bg-[var(--panel-muted)] font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]";

export const tableHeadCellClass = "px-3.5 py-2.5 text-left font-semibold";

export const tableRowClass = "border-b border-[var(--line2)] transition hover:bg-[var(--panel-muted)]";

export const tableCellClass = "px-3.5 py-3 align-middle text-[13px] text-[var(--foreground-soft)]";

/** Asset codes, feeders, coordinates, counts. */
export const tableMonoCellClass = `${tableCellClass} font-mono text-[12.5px]`;

interface TableFooterProps {
  /** Free-text summary, e.g. "Showing 1–20 of 386". */
  summary: ReactNode;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Rows-per-page picker or any other trailing control. */
  children?: ReactNode;
}

export function TableFooter({ summary, page, pageCount, onPageChange, children }: TableFooterProps) {
  const totalPages = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line2)] px-3.5 py-3">
      <p className="text-[12.5px] text-[var(--muted)]">{summary}</p>
      <div className="flex items-center gap-3">
        {children}
        <span className="font-mono text-[12px] tabular-nums text-[var(--muted)]">
          Page {current} of {totalPages}
        </span>
        <div className="flex items-center gap-1.5">
          <IconBtn
            aria-label="Previous page"
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            className="!h-[34px] !w-[34px]"
          >
            <ChevronLeft size={16} />
          </IconBtn>
          <IconBtn
            aria-label="Next page"
            disabled={current >= totalPages}
            onClick={() => onPageChange(current + 1)}
            className="!h-[34px] !w-[34px]"
          >
            <ChevronRight size={16} />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}
