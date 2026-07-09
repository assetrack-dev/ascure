"use client";

import { Search } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * Exported as class strings, not components, so existing `<select>` / `<input>`
 * elements keep their handlers, `value`, and `aria-*` — a restyle, not a rewrite.
 */
export const filterControlClass =
  "h-[38px] rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 text-[13px] text-[var(--foreground)] shadow-[var(--shadow-soft)] transition placeholder:text-[var(--muted-2)] hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-50";

export const filterSelectClass = `${filterControlClass} cursor-pointer pr-8`;

export const filterLabelClass =
  "font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)]";

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Let the search field absorb the free space in the bar. */
  grow?: boolean;
}

export function SearchField({ grow = true, className = "", ...rest }: SearchFieldProps) {
  return (
    <div className={`relative ${grow ? "min-w-[220px] flex-1" : ""} ${className}`}>
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-2)]"
      />
      <input type="search" className={`${filterControlClass} w-full pl-9`} {...rest} />
    </div>
  );
}
