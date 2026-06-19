"use client";

import { API_ORIGIN } from "@/lib/api";

/**
 * The minimal photo shape this grid renders. Both `DefectEvidenceImage`
 * (defect workflow) and the asset-detail inspection image are structurally
 * assignable to it — all fields are optional so either source fits.
 */
export interface EvidenceLikeImage {
  id?: string;
  filename?: string | null;
  url?: string | null;
  path?: string | null;
  storageKey?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timestamp?: string | null;
  uploadedAt?: string | null;
  createdAt?: string | null;
}

export interface EvidenceImageEntry {
  image: EvidenceLikeImage;
  sourceUrl: string;
}

function formatDateTime(date: string | null | undefined) {
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

/**
 * Resolve a stored photo reference (absolute URL, `/uploads/...`, or a
 * storage-relative key) to a browser-loadable URL against the API origin.
 */
export function getImageSourceUrl(image: EvidenceLikeImage) {
  const source = image.url || image.path;

  if (!source) {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:/i.test(source)) {
    return source;
  }

  if (source.startsWith("/")) {
    return `${API_ORIGIN}${source}`;
  }

  if (source.startsWith("uploads/")) {
    return `${API_ORIGIN}/${source}`;
  }

  if (source.startsWith("inspections/")) {
    return `${API_ORIGIN}/uploads/${source}`;
  }

  return source;
}

/** Map raw photos to renderable entries, dropping any that can't resolve a URL. */
export function buildEvidenceEntries(
  images: EvidenceLikeImage[],
): EvidenceImageEntry[] {
  return images
    .map((image) => ({ image, sourceUrl: getImageSourceUrl(image) }))
    .filter((entry): entry is EvidenceImageEntry => Boolean(entry.sourceUrl));
}

function formatEvidenceTimestamp(image: EvidenceLikeImage) {
  return formatDateTime(image.timestamp ?? image.uploadedAt ?? image.createdAt);
}

function formatEvidenceGps(image: EvidenceLikeImage) {
  if (
    typeof image.latitude === "number" &&
    Number.isFinite(image.latitude) &&
    typeof image.longitude === "number" &&
    Number.isFinite(image.longitude)
  ) {
    return `${image.latitude.toFixed(6)}, ${image.longitude.toFixed(6)}`;
  }

  return null;
}

export function EvidenceImageGrid({
  entries,
  emptyText,
  titlePrefix,
}: {
  entries: EvidenceImageEntry[];
  emptyText: string;
  titlePrefix: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {entries.map(({ image, sourceUrl }, index) => {
        const gps = formatEvidenceGps(image);

        return (
          <a
            key={`${image.id ?? "image"}-${index}`}
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          >
            <img
              src={sourceUrl}
              alt={image.filename ?? titlePrefix}
              className="aspect-video w-full object-cover transition group-hover:scale-[1.02]"
            />
            <div className="space-y-1 border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold text-slate-800">
                {titlePrefix} {index + 1}
              </div>
              <div>{formatEvidenceTimestamp(image)}</div>
              {gps ? <div>GPS {gps}</div> : null}
              {image.note ? <div className="line-clamp-2">{image.note}</div> : null}
            </div>
          </a>
        );
      })}
    </div>
  );
}
