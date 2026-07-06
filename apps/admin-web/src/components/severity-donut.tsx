import type { ChartDatum } from "@/types/dashboard";

interface SeverityDonutProps {
  title: string;
  data: ChartDatum[];
  emptyLabel: string;
  /** Centre caption under the total (e.g. "open defects"). */
  centerCaption?: string;
}

// Severity colours mirror the Defects page severity badges so the donut, the
// list, and the map all read the same.
const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626", // red-600
  high: "#f97316", // orange-500
  medium: "#eab308", // yellow-500
  low: "#22c55e", // green-500
};
const FALLBACK_COLOR = "#94a3b8"; // slate-400

function colorFor(label: string): string {
  return SEVERITY_COLORS[label.trim().toLowerCase()] ?? FALLBACK_COLOR;
}

const RADIUS = 52;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * A donut/ring chart of defects by severity. Pure SVG (no deps): each severity
 * is an arc sized to its share of the total, with the total in the centre and a
 * labelled legend. Falls back to an empty state when nothing is counted.
 */
export function SeverityDonut({
  title,
  data,
  emptyLabel,
  centerCaption = "total",
}: SeverityDonutProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Pre-compute each arc's length + offset around the ring (starting at 12
  // o'clock via the -90° rotation on the group).
  let cursor = 0;
  const segments = data
    .filter((item) => item.value > 0)
    .map((item) => {
      const fraction = item.value / total;
      const length = fraction * CIRCUMFERENCE;
      const segment = {
        label: item.label,
        value: item.value,
        color: colorFor(item.label),
        dashArray: `${length} ${CIRCUMFERENCE - length}`,
        dashOffset: -cursor,
      };
      cursor += length;
      return segment;
    });

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)]">
      <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>

      {total > 0 ? (
        <div className="mt-5 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="relative h-40 w-40 shrink-0">
            <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
              <circle
                cx="70"
                cy="70"
                r={RADIUS}
                fill="none"
                stroke="var(--surface-pressed)"
                strokeWidth={STROKE}
              />
              {segments.map((segment) => (
                <circle
                  key={segment.label}
                  cx="70"
                  cy="70"
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={STROKE}
                  strokeDasharray={segment.dashArray}
                  strokeDashoffset={segment.dashOffset}
                  strokeLinecap="butt"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-[var(--foreground)]">
                {total.toLocaleString()}
              </span>
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {centerCaption}
              </span>
            </div>
          </div>

          <ul className="flex-1 space-y-2 self-stretch">
            {data.map((item) => {
              const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
              return (
                <li
                  key={item.label}
                  className="flex items-center gap-3 text-sm"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: colorFor(item.label) }}
                  />
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className="ml-auto font-semibold text-slate-900">
                    {item.value.toLocaleString()}
                  </span>
                  <span className="w-10 text-right text-xs text-[var(--muted)]">
                    {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-[var(--muted)]">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}
