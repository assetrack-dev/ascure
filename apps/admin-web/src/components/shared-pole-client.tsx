"use client";

import { useEffect, useState } from "react";
import { Link2Off, Zap } from "lucide-react";

import { PoleRecordView } from "@/components/pole-record-view";
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

/**
 * Public read-only view of one shared pole. Deliberately standalone — no app
 * shell, no auth, nothing to navigate to — and mobile-first, because share
 * links travel by WhatsApp and open on phones.
 *
 * ⚠ The record itself is {@link PoleRecordView}, shared with the client (TNB)
 * asset detail so the two presentations cannot drift apart. Only the standalone
 * chrome (brand line, expiry footer, invalid-link state) lives here.
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
          <div className="mt-4">
            <PoleRecordView
              assetCode={pole.assetCode}
              assetType={pole.assetType}
              latitude={pole.latitude}
              longitude={pole.longitude}
              facts={[
                { label: "Pencawang", value: pole.pencawangName || "Not recorded" },
                { label: "Location", value: pole.location || "Not recorded" },
                { label: "No Tiang Rondaan", value: pole.noTiangRondaan },
              ]}
              inspection={
                pole.latestInspection
                  ? {
                      submittedAt: pole.latestInspection.submittedAt,
                      totalDefects: pole.latestInspection.totalDefects,
                      items: pole.latestInspection.items,
                      images: pole.latestInspection.images,
                    }
                  : null
              }
              footer={
                <p className="pb-4 text-center text-xs text-[var(--muted)]">
                  Shared via ASCURE · read-only · link valid until{" "}
                  {formatDate(pole.shareExpiresAt)}
                </p>
              }
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
