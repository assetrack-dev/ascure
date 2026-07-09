import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "secondary" | "primary" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  secondary:
    "border border-[var(--line)] bg-[var(--panel)] text-[var(--foreground-soft)] shadow-[var(--shadow-soft)] hover:bg-[var(--panel-muted)]",
  primary:
    "border border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)] hover:border-[var(--brand-strong)] hover:bg-[var(--brand-strong)]",
  danger:
    "border border-[var(--critical)] bg-[var(--critical)] text-white hover:opacity-90",
  ghost:
    "border border-transparent text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]",
};

const BASE =
  "inline-flex h-[38px] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

interface TbtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Tbtn({ variant = "secondary", className = "", children, ...rest }: TbtnProps) {
  return (
    <button type="button" className={`${BASE} px-3.5 ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Icon-only buttons must carry a label for screen readers. */
  "aria-label": string;
  children: ReactNode;
}

export function IconBtn({ variant = "secondary", className = "", children, ...rest }: IconBtnProps) {
  return (
    <button type="button" className={`${BASE} w-[38px] ${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
