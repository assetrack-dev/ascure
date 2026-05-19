"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  FolderKanban,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import { fetchEnterpriseDetail } from "@/lib/enterprise";
import type { AuthSession } from "@/types/auth";
import type {
  EnterpriseDetail,
  EnterpriseEntityKind,
  EnterpriseTone,
} from "@/types/enterprise";

const PAGE_CONFIG: Record<
  EnterpriseEntityKind,
  {
    label: string;
    basePath: string;
    icon: typeof Building2;
  }
> = {
  organizations: {
    label: "Organizations",
    basePath: "/organizations",
    icon: Building2,
  },
  projects: {
    label: "Projects",
    basePath: "/projects",
    icon: FolderKanban,
  },
  "work-packages": {
    label: "Work Packages",
    basePath: "/work-packages",
    icon: PackageCheck,
  },
};

const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function toneClassName(tone: EnterpriseTone) {
  if (tone === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (tone === "danger") {
    return "border-red-200 bg-red-50 text-red-700";
  }

  if (tone === "info") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-50 text-slate-600";
}

function Chip({ label, tone }: { label: string | null; tone: EnterpriseTone }) {
  if (!label) {
    return null;
  }

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClassName(tone)}`}>
      {label}
    </span>
  );
}

function formatDateTime(date: string | null) {
  if (!date) {
    return "Not recorded";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function formatNullable(value: string | null) {
  return value?.trim() || "Not recorded";
}

function EnterpriseDetailContent({
  kind,
  id,
}: {
  kind: EnterpriseEntityKind;
  id: string;
}) {
  const router = useRouter();
  const config = PAGE_CONFIG[kind];
  const Icon = config.icon;
  const [session, setSession] = useState<AuthSession | null>(null);
  const [detail, setDetail] = useState<EnterpriseDetail | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadDetail = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextDetail = await fetchEnterpriseDetail(token, kind, id);
        setDetail(nextDetail);
      } catch (detailError) {
        if (detailError instanceof ApiError && detailError.status === 401) {
          handleLogout();
          return;
        }

        setError(
          detailError instanceof Error ? detailError.message : "Unable to load enterprise detail.",
        );
        setDetail(null);
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout, id, kind],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadDetail(storedSession.token);
    } else {
      setIsLoading(false);
    }
  }, [loadDetail]);

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push(config.basePath)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                {config.label}
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Enterprise Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {detail?.name ?? config.label}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  Read-only
                </span>
                {detail ? <Chip label={detail.primaryChip} tone={detail.primaryTone} /> : null}
                {detail ? <Chip label={detail.secondaryChip} tone={detail.secondaryTone} /> : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadDetail(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className={secondaryButtonClassName}
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !detail ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-72 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : detail ? (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {detail.metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-xl border border-[var(--line)] bg-white p-4 shadow-[var(--shadow-soft)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                            {metric.label}
                          </p>
                          <p className="mt-2 text-2xl font-bold text-slate-950">
                            {metric.value}
                          </p>
                        </div>
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                          <Icon size={17} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
                    <Icon size={17} className="text-[var(--brand)]" />
                    Enterprise Record
                  </div>
                  <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {detail.fields.map((field) => (
                      <div
                        key={field.label}
                        className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]"
                      >
                        <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
                          {field.label}
                        </dt>
                        <dd className="mt-2 text-sm font-semibold text-slate-900">
                          {formatNullable(field.value)}
                        </dd>
                      </div>
                    ))}
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]">
                      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Created
                      </dt>
                      <dd className="mt-2 text-sm font-semibold text-slate-900">
                        {formatDateTime(detail.createdAt)}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]">
                      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Updated
                      </dt>
                      <dd className="mt-2 text-sm font-semibold text-slate-900">
                        {formatDateTime(detail.updatedAt)}
                      </dd>
                    </div>
                  </dl>
                  {detail.description ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      {detail.description}
                    </div>
                  ) : null}
                </section>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)] shadow-[var(--shadow-card)]">
                Record not found.
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function EnterpriseDetailClient({
  kind,
  id,
}: {
  kind: EnterpriseEntityKind;
  id: string;
}) {
  return (
    <AuthGuard>
      <EnterpriseDetailContent kind={kind} id={id} />
    </AuthGuard>
  );
}
