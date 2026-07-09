import type { ReactNode } from "react";
import { TONE_CHIP, TONE_SOLID, type Tone } from "./tones";

interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  /** Leading status dot, for legends and grouped lists. */
  dot?: boolean;
  title?: string;
  className?: string;
}

/** `600 / 11px`, fully rounded, 3×9 padding. The console's status atom. */
export function Chip({ children, tone = "neutral", dot = false, title, className = "" }: ChipProps) {
  // Only a bare string gets the truncating wrapper. Tailwind's preflight sets
  // `svg { display: block }`, so an icon inside a `truncate` (white-space: nowrap)
  // span breaks onto its own line and doubles the chip's height. Non-string
  // children ride directly on the flex row, where icons blockify harmlessly.
  const body =
    typeof children === "string" ? <span className="min-w-0 truncate">{children}</span> : children;

  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-[9px] py-[3px] text-[11px] font-semibold leading-tight [&>svg]:shrink-0 ${TONE_CHIP[tone]} ${className}`}
    >
      {dot ? <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_SOLID[tone]}`} /> : null}
      {body}
    </span>
  );
}

/** Mono `700 / 10px`, uppercase — SLA states, formats, codes. */
export function Tag({ children, tone = "neutral", title, className = "" }: Omit<ChipProps, "dot">) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-[3px] font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.05em] ${TONE_CHIP[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Bare colored dot — legend rows, lane markers. */
export function Dot({ tone = "neutral", className = "" }: { tone?: Tone; className?: string }) {
  return <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_SOLID[tone]} ${className}`} />;
}
