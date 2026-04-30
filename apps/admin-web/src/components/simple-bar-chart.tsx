import type { ChartDatum } from "@/types/dashboard";

interface SimpleBarChartProps {
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  tone?: "teal" | "amber" | "rose";
}

const toneClasses = {
  teal: "bg-[#0f766e]",
  amber: "bg-[#b45309]",
  rose: "bg-[#be123c]",
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
    <section className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-sm">
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
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className="font-semibold text-slate-900">{item.value.toLocaleString()}</span>
                </div>
                <div className="h-3 overflow-hidden rounded bg-slate-100">
                  <div
                    className={`h-full rounded ${toneClasses[tone]}`}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
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
