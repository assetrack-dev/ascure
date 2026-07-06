import type { DailyTrendPoint } from "@/types/dashboard";

interface DailyTrendChartProps {
  title: string;
  data: DailyTrendPoint[];
  emptyLabel: string;
  /** Unit label for the summary line (e.g. "assets inspected"). */
  unitLabel?: string;
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-MY", { weekday: "short" });

function parseLocalDate(date: string): Date | null {
  // Parse "YYYY-MM-DD" as a LOCAL midnight so the weekday label doesn't shift a
  // day under the browser's time zone (new Date("YYYY-MM-DD") is UTC midnight).
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function weekdayLabel(date: string): string {
  const parsed = parseLocalDate(date);
  return parsed ? WEEKDAY_FORMAT.format(parsed) : date.slice(5);
}

function dayLabel(date: string): string {
  const parsed = parseLocalDate(date);
  return parsed ? String(parsed.getDate()) : "";
}

/**
 * A compact vertical bar chart of the daily inspection-throughput trend
 * (distinct assets submitted per reporting-day). Bars scale to the busiest day;
 * today (the last point) is highlighted.
 */
export function DailyTrendChart({
  title,
  data,
  emptyLabel,
  unitLabel = "inspected",
}: DailyTrendChartProps) {
  const maxValue = Math.max(...data.map((point) => point.value), 0);
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const hasData = data.length > 0;
  const todayValue = data.length > 0 ? data[data.length - 1].value : 0;

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>
        {hasData ? (
          <span className="text-sm text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">
              {todayValue.toLocaleString()}
            </span>{" "}
            today · {total.toLocaleString()} over {data.length} days
          </span>
        ) : null}
      </div>

      {hasData ? (
        <div className="mt-6 flex items-end justify-between gap-2" style={{ height: 148 }}>
          {data.map((point, index) => {
            const isToday = index === data.length - 1;
            const heightPct =
              maxValue > 0 ? Math.max((point.value / maxValue) * 100, point.value > 0 ? 6 : 0) : 0;
            return (
              <div
                key={point.date}
                className="flex flex-1 flex-col items-center justify-end gap-1.5"
                title={`${point.date}: ${point.value} ${unitLabel}`}
              >
                <span className="text-xs font-semibold text-[var(--foreground)]">
                  {point.value}
                </span>
                <div className="flex w-full items-end justify-center" style={{ height: 96 }}>
                  <div
                    className={`w-full max-w-[38px] rounded-t-md transition-all ${
                      isToday ? "bg-[var(--brand)]" : "bg-[var(--brand-soft)]"
                    }`}
                    style={{
                      height: `${heightPct}%`,
                      minHeight: point.value > 0 ? 4 : 0,
                    }}
                  />
                </div>
                <div className="flex flex-col items-center leading-tight">
                  <span
                    className={`text-xs ${
                      isToday
                        ? "font-semibold text-[var(--brand)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {weekdayLabel(point.date)}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {dayLabel(point.date)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}
