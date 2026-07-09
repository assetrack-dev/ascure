import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  /** Tables and grouped lists manage their own insets. */
  padded?: boolean;
  className?: string;
}

export function Card({ children, padded = true, className = "" }: CardProps) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)] ${
        padded ? "p-[18px]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

interface CardHeadProps {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function CardHead({ title, hint, actions, className = "" }: CardHeadProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h2
          className="text-[14.5px] font-semibold leading-tight text-[var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        {/* <div>, not <p>: `hint` is a ReactNode and callers pass chips/bars. */}
        {hint ? <div className="mt-1 text-[12px] text-[var(--muted)]">{hint}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
