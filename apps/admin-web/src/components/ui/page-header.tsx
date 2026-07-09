import type { ReactNode } from "react";

/** Mono `600 / 11px`, `0.09em`, uppercase. Sits above every page title. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--muted-2)] ${className}`}
    >
      {children}
    </p>
  );
}

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Buttons, right-aligned on the title row. */
  actions?: ReactNode;
  /** Status chips, rendered under the subtitle. */
  chips?: ReactNode;
}

export function PageHeader({ eyebrow, title, subtitle, actions, chips }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1
          className="mt-1.5 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">{subtitle}</p>
        ) : null}
        {chips ? <div className="mt-3 flex flex-wrap items-center gap-2">{chips}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
