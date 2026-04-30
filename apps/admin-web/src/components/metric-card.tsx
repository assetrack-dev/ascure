import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: "neutral" | "success" | "warning" | "danger";
}

const toneClasses = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  success: "border-green-200 bg-green-50 text-green-700",
  warning: "border-orange-200 bg-orange-50 text-orange-700",
  danger: "border-red-200 bg-red-50 text-red-700",
};

export function MetricCard({ title, value, detail, icon: Icon, tone }: MetricCardProps) {
  return (
    <article className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-slate-300">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{title}</p>
          <p className="mt-3 text-3xl font-bold text-[var(--foreground)]">
            {value.toLocaleString()}
          </p>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg border ${toneClasses[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 text-sm text-[var(--muted)]">{detail}</p>
    </article>
  );
}
