"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  Link2Off,
  MapPin,
  Zap,
} from "lucide-react";
import {
  EvidenceImageGrid,
  buildEvidenceEntries,
} from "@/components/inspection-evidence-grid";
import { ApiError } from "@/lib/api";
import { fetchSharedPole, type SharedPole } from "@/lib/share";

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "Not recorded";
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function isPassFailResult(result: string | null | undefined) {
  const normalized = result?.toUpperCase();
  return normalized === "PASS" || normalized === "FAIL";
}

function resultBadgeClassName(result: string | null | undefined) {
  const normalized = result?.toUpperCase();
  if (normalized === "PASS") {
    return "border-green-200 bg-green-50 text-green-700";
  }
  if (normalized === "FAIL") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function severityBadgeClassName(severity: string | null | undefined) {
  const normalized = severity?.toUpperCase();
  if (normalized === "CRITICAL") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (normalized === "HIGH") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (normalized === "MEDIUM") {
    return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }
  if (normalized === "LOW") {
    return "border-green-200 bg-green-50 text-green-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1.5 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

/**
 * Public read-only view of one shared pole. Deliberately standalone — no app
 * shell, no auth, nothing to navigate to — and mobile-first, because share
 * links travel by WhatsApp and open on phones.
 */
export function SharedPoleClient({ token }: { token: string }) {
  const [pole, setPole] = useState<SharedPole | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchSharedPole(token)
      .then((result) => {
        if (!cancelled) {
          setPole(result);
        }
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setError(
          fetchError instanceof ApiError && fetchError.status === 404
            ? "This share link is invalid or has expired."
            : fetchError instanceof Error
              ? fetchError.message
              : "Unable to load this pole.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const images = useMemo(
    () => buildEvidenceEntries(pole?.latestInspection?.images ?? []),
    [pole],
  );
  const items = pole?.latestInspection?.items ?? [];
  // Same curation as the internal page: keep rows that carry meaning.
  const visibleItems = items.filter(
    (item) =>
      item.isDefect ||
      isPassFailResult(item.result) ||
      (item.remark?.trim().length ?? 0) > 0,
  );
  const defectCount = pole?.latestInspection?.totalDefects ?? 0;
  const hasGps = pole?.latitude != null && pole?.longitude != null;

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2 text-sm font-bold tracking-wide text-[var(--brand)]">
          <Zap size={16} />
          ASCURE
          <span className="font-normal text-[var(--muted)]">
            · shared pole record
          </span>
        </div>

        {isLoading ? (
          <div className="mt-6 space-y-4">
            <div className="h-10 w-48 animate-pulse rounded-md bg-slate-200/60" />
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-xl bg-slate-200/60"
                />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white p-10 text-center">
            <Link2Off size={28} className="text-slate-400" />
            <p className="text-sm font-semibold text-slate-900">{error}</p>
            <p className="text-sm text-[var(--muted)]">
              Ask the person who sent it for a new link.
            </p>
          </div>
        ) : pole ? (
          <div className="mt-4 space-y-5">
            <div>
              <h1 className="text-3xl font-bold text-[var(--foreground)]">
                {pole.assetCode}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {pole.assetType ? (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                    {pole.assetType}
                  </span>
                ) : null}
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    defectCount > 0
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-green-200 bg-green-50 text-green-700"
                  }`}
                >
                  {defectCount > 0
                    ? `${defectCount} defect${defectCount === 1 ? "" : "s"} recorded`
                    : "No defects recorded"}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                  <CalendarDays size={13} />
                  Inspected {formatDate(pole.latestInspection?.submittedAt)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Pencawang" value={pole.pencawangName || "Not recorded"} />
              <Fact label="Location" value={pole.location || "Not recorded"} />
              {pole.noTiangRondaan ? (
                <Fact label="No Tiang Rondaan" value={pole.noTiangRondaan} />
              ) : null}
              {hasGps ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase text-[var(--muted)]">
                    GPS
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-slate-900">
                    {pole.latitude!.toFixed(6)}, {pole.longitude!.toFixed(6)}
                    <a
                      href={`https://www.google.com/maps?q=${pole.latitude},${pole.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline"
                    >
                      <MapPin size={12} />
                      Open in Google Maps
                      <ExternalLink size={11} />
                    </a>
                  </div>
                </div>
              ) : null}
            </div>

            {pole.latestInspection ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <ClipboardList size={17} className="text-[var(--brand)]" />
                    Inspection Result
                  </div>
                  <span className="text-sm text-[var(--muted)]">
                    {visibleItems.length}{" "}
                    {visibleItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  {visibleItems.length > 0 ? (
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                          <th className="px-3 py-2.5">Checklist Item</th>
                          <th className="px-3 py-2.5">Result</th>
                          <th className="px-3 py-2.5">Severity</th>
                          <th className="px-3 py-2.5">Remark</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleItems.map((item) => (
                          <tr
                            key={item.id}
                            className={item.isDefect ? "bg-red-50/40" : undefined}
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-900">
                              {item.label}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              {isPassFailResult(item.result) ? (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${resultBadgeClassName(item.result)}`}
                                >
                                  {item.result?.toUpperCase()}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5">
                              {item.isDefect && item.severity ? (
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${severityBadgeClassName(item.severity)}`}
                                >
                                  {item.severity}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {item.remark || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-[var(--muted)]">
                      No pass/fail results or remarks recorded.
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-[var(--muted)]">
                This pole has not been inspected yet.
              </section>
            )}

            {pole.latestInspection ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3 pb-4">
                  <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                    <Camera size={17} className="text-[var(--brand)]" />
                    Photos
                  </div>
                  <span className="text-sm text-[var(--muted)]">
                    {images.length} {images.length === 1 ? "photo" : "photos"}
                  </span>
                </div>
                <EvidenceImageGrid
                  entries={images}
                  emptyText="No photos captured for this inspection."
                  titlePrefix="Photo"
                />
              </section>
            ) : null}

            <p className="pb-4 text-center text-xs text-[var(--muted)]">
              Shared via ASCURE · read-only · link valid until{" "}
              {formatDate(pole.shareExpiresAt)}
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
