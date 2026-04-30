import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  tone: "neutral" | "success" | "warning" | "danger";
}

const toneClasses = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
};

export function MetricCard({ title, value, detail, icon: Icon, tone }: MetricCardProps) {
  return (
    <article className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{title}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">
            {value.toLocaleString()}
          </p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${toneClasses[tone]}`}>
          <Icon size={20} />
        </div>
      </div>
      <p className="mt-4 text-sm text-[var(--muted)]">{detail}</p>
    </article>
  );
}
