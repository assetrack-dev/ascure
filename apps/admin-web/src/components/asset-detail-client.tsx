"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPin, RefreshCw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import { fetchAssetDetail } from "@/lib/assets";
import { clearStoredSession, readStoredSession } from "@/lib/auth";
import type { AssetDetail } from "@/types/assets";
import type { AuthSession } from "@/types/auth";

function formatDate(date: string | null) {
  if (!date) {
    return "No date";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsedDate);
}

function formatNullable(value: string | null) {
  return value?.trim() || "Not recorded";
}

function formatInspectionStatus(status: AssetDetail["inspectionStatus"]) {
  return status === "COMPLETED" ? "Completed" : "Pending";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-soft)]">
      <dt className="text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-2 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function AssetDetailContent({ assetId }: { assetId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadAsset = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");

      try {
        const nextAsset = await fetchAssetDetail(token, assetId);
        setAsset(nextAsset);
      } catch (assetError) {
        if (assetError instanceof ApiError && assetError.status === 401) {
          handleLogout();
          return;
        }

        setError(assetError instanceof Error ? assetError.message : "Unable to load asset.");
      } finally {
        setIsLoading(false);
      }
    },
    [assetId, handleLogout],
  );

  useEffect(() => {
    const storedSession = readStoredSession();
    setSession(storedSession);

    if (storedSession?.token) {
      void loadAsset(storedSession.token);
    }
  }, [loadAsset]);

  const isReadOnly = session?.user?.role !== "ADMIN";

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => router.push("/assets")}
                className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-strong)]"
              >
                <ArrowLeft size={16} />
                Assets
              </button>
              <p className="mt-4 text-sm font-semibold uppercase text-[var(--brand)]">
                Asset Detail
              </p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                {asset?.assetCode ?? "Asset"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                  <ShieldCheck size={14} />
                  {isReadOnly ? "Read-only" : "Full access"}
                </span>
                {asset ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-[var(--shadow-soft)]">
                    {formatInspectionStatus(asset.inspectionStatus)}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => (session?.token ? loadAsset(session.token) : undefined)}
              disabled={isLoading || !session?.token}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="mt-6">
            {isLoading && !asset ? (
              <div className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                <div className="h-8 w-56 animate-pulse rounded-md bg-slate-100" />
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-md bg-slate-100" />
                  ))}
                </div>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                {error}
              </div>
            ) : asset ? (
              <div className="space-y-6">
                <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <DetailField label="Asset Type" value={formatNullable(asset.assetType)} />
                  <DetailField label="Feeder" value={formatNullable(asset.feeder)} />
                  <DetailField label="Pencawang Name" value={formatNullable(asset.pencawangName)} />
                  <DetailField label="Date" value={formatDate(asset.date)} />
                  <DetailField label="Location" value={formatNullable(asset.location)} />
                  <DetailField label="Name" value={formatNullable(asset.name)} />
                  <DetailField
                    label="Latitude"
                    value={asset.latitude === null ? "Not recorded" : String(asset.latitude)}
                  />
                  <DetailField
                    label="Longitude"
                    value={asset.longitude === null ? "Not recorded" : String(asset.longitude)}
                  />
                </dl>

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        Latest Inspection
                      </h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {asset.latestInspection?.remarks || "No inspection remarks recorded."}
                      </p>
                    </div>
                    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                      <CalendarDays size={14} />
                      {formatDate(asset.latestInspection?.submittedAt ?? asset.date)}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Status
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.status ?? formatInspectionStatus(asset.inspectionStatus)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Cycle
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.cycleNumber ?? "Not recorded"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                        Images
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-900">
                        {asset.latestInspection?.images?.length ?? 0}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <MapPin size={17} className="text-[var(--brand)]" />
                    Location
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {formatNullable(asset.location)}
                  </p>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export function AssetDetailClient({ assetId }: { assetId: string }) {
  return (
    <AuthGuard>
      <AssetDetailContent assetId={assetId} />
    </AuthGuard>
  );
}
