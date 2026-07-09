import type { ChartDatum } from "@/types/dashboard";

interface SimpleBarChartProps {
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  tone?: "teal" | "amber" | "rose";
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
}: SimpleBarChartProps) {
  const maxValue = Math.max(...data.map((item) => item.value), 0);
  const hasData = data.some((item) => item.value > 0);

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
      </div>

      <div className="mt-5 space-y-4">
        {data.length > 0 ? (
          data.map((item) => {
            const width = maxValue > 0 ? Math.max((item.value / maxValue) * 100, 4) : 0;

            return (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium text-[var(--foreground-soft)]">{item.label}</span>
                  <span className="font-semibold text-[var(--foreground)]">{item.value.toLocaleString()}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--panel-muted)]">
                  <div
                    className={`h-full rounded-full ${toneClasses[tone]}`}
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
