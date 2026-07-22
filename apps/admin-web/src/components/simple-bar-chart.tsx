import type { ChartDatum } from "@/types/dashboard";

interface SimpleBarChartProps {
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  tone?: "teal" | "amber" | "rose";
  /** When set and the list is longer, cap the height to ~this many rows and scroll. */
  maxRows?: number;
}

const toneClasses = {
  teal: "bg-[var(--brand)]",
  amber: "bg-[var(--amber)]",
  rose: "bg-[var(--critical)]",
};

export function SimpleBarChart({
  title,
  data,
  emptyLabel,
  tone = "teal",
  maxRows,
}: SimpleBarChartProps) {
  const maxValue = Math.max(...data.map((item) => item.value), 0);
  const hasData = data.some((item) => item.value > 0);
  // Bars are drawn relative to the LARGEST row, so the bar length alone can't
  // tell you what share of the whole a row is. Hovering reveals it.
  const total = data.reduce((sum, item) => sum + item.value, 0);
  // Cap the list to ~maxRows tall and let the rest scroll (a row ≈ 3.4rem incl.
  // the space-y-4 gap), so a long list (substations/mainheads) can't stretch the
  // card. The partial next row hints there's more to scroll.
  const scroll = maxRows != null && data.length > maxRows;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
      </div>

      <div
        className={`mt-5 space-y-4${scroll ? " overflow-y-auto pr-1" : ""}`}
        style={scroll ? { maxHeight: `${(maxRows as number) * 3.4}rem` } : undefined}
      >
        {data.length > 0 ? (
          data.map((item) => {
            const width = maxValue > 0 ? Math.max((item.value / maxValue) * 100, 4) : 0;
            const share = total > 0 ? (item.value / total) * 100 : 0;

            return (
              <div
                key={item.label}
                className="group"
                title={`${item.label}: ${item.value.toLocaleString()} (${share.toFixed(1)}% of ${total.toLocaleString()})`}
              >
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <span className="truncate font-medium text-[var(--foreground-soft)]">{item.label}</span>
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="text-[11px] tabular-nums text-[var(--muted-2)] opacity-0 transition-opacity group-hover:opacity-100">
                      {share.toFixed(1)}%
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--foreground)]">
                      {item.value.toLocaleString()}
                    </span>
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--panel-muted)]">
                  <div
                    className={`h-full rounded-full ${toneClasses[tone]} transition-opacity group-hover:opacity-80`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            {emptyLabel}
          </div>
        )}
      </div>

      {!hasData && data.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{emptyLabel}</p>
      ) : null}
    </section>
  );
}
