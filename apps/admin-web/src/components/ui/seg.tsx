"use client";

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

interface SegProps<T extends string> {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  className?: string;
}

/** Inline segmented control. Active segment = solid brand. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  className = "",
  ...rest
}: SegProps<T>) {
  return (
    <div
      role="group"
      aria-label={rest["aria-label"]}
      className={`inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] p-1 ${className}`}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`h-[30px] rounded-[7px] px-3 text-[12.5px] font-semibold transition ${
              isActive
                ? "bg-[var(--brand)] text-[var(--on-brand)]"
                : "text-[var(--muted)] hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
