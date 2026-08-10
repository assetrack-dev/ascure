"use client";

import type { ReactNode } from "react";
import { Camera, CalendarDays, ClipboardList, ExternalLink, MapPin } from "lucide-react";

import {
  EvidenceImageGrid,
  buildEvidenceEntries,
  type EvidenceLikeImage,
} from "@/components/inspection-evidence-grid";

/**
 * ONE pole's condition, presented for someone OUTSIDE the crew: big code, what
 * was found, the photos that prove it. No operational controls, nothing to edit.
 *
 * ⚠ SHARED ON PURPOSE by the public share link (`/s/[token]`) and the client
 * (TNB) asset detail. The owner asked for the client's pole page to look "just
 * like the page we can share" — keeping ONE component is what makes that stay
 * true. If you restyle this, you restyle both; if you need one to differ, add a
 * prop rather than forking the markup.
 */

export interface PoleRecordItem {
  id: string;
  label: string;
  result: string | null;
  remark: string | null;
  isDefect: boolean;
  severity: string | null;
}

export interface PoleRecordInspection {
  submittedAt: string | null;
  totalDefects: number;
  items: PoleRecordItem[];
  images: EvidenceLikeImage[];
}

export interface PoleRecordViewProps {
  assetCode: string;
  assetType: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Fact cards shown above the inspection. The GPS card is added automatically. */
  facts: { label: string; value: string | null }[];
  inspection: PoleRecordInspection | null;
  /** Extra chips on the header row (e.g. the survey's lifecycle stage). */
  chips?: ReactNode;
  /** Rendered under the record — the share page's expiry note, for instance. */
  footer?: ReactNode;
  /** Shown when there is no inspection yet. */
  emptyText?: string;
}

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

export function PoleRecordView({
  assetCode,
  assetType,
  latitude,
  longitude,
  facts,
  inspection,
  chips,
  footer,
  emptyText = "This pole has not been inspected yet.",
}: PoleRecordViewProps) {
  const images = buildEvidenceEntries(inspection?.images ?? []);
  const items = inspection?.items ?? [];
  // Keep the rows that carry meaning: a real pass/fail, a flagged defect, or a
  // written remark. Informational items that recorded N/A with nothing else are
  // noise to an outside reader.
  const visibleItems = items.filter(
    (item) =>
      item.isDefect ||
      isPassFailResult(item.result) ||
      (item.remark?.trim().length ?? 0) > 0,
  );
  const defectCount = inspection?.totalDefects ?? 0;
  const hasGps = latitude != null && longitude != null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-[var(--foreground)]">
          {assetCode}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {assetType ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
              {assetType}
            </span>
          ) : null}
          {/* ⚠ Only claim "no defects" when someone actually looked. On a pole
              nobody has surveyed yet, a green "No defects recorded" reads as a
              clean bill of health for an inspection that never happened. */}
          {inspection ? (
            <>
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
                Inspected {formatDate(inspection.submittedAt)}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              Not surveyed
            </span>
          )}
          {chips}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {facts
          .filter((fact) => (fact.value ?? "").trim().length > 0)
          .map((fact) => (
            <Fact key={fact.label} label={fact.label} value={fact.value as string} />
          ))}
        {hasGps ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase text-[var(--muted)]">
              GPS
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-slate-900">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
              <a
                href={`https://www.google.com/maps?q=${latitude},${longitude}`}
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

      {inspection ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ClipboardList size={17} className="text-[var(--brand)]" />
              Inspection Result
            </div>
            <span className="text-sm text-[var(--muted)]">
              {visibleItems.length} {visibleItems.length === 1 ? "item" : "items"}
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
          {emptyText}
        </section>
      )}

      {inspection ? (
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

      {footer}
    </div>
  );
}
