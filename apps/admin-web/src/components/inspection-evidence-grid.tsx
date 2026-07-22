"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";

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
  // Which photo (if any) is open in the in-page lightbox.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-[var(--muted)]">
        {emptyText}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(({ image, sourceUrl }, index) => {
          const gps = formatEvidenceGps(image);

          return (
            <button
              type="button"
              key={`${image.id ?? "image"}-${index}`}
              onClick={() => setOpenIndex(index)}
              className="group block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <img
                src={sourceUrl}
                alt={image.filename ?? titlePrefix}
                loading="lazy"
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
            </button>
          );
        })}
      </div>
      {openIndex !== null ? (
        <EvidenceLightbox
          entries={entries}
          index={openIndex}
          titlePrefix={titlePrefix}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Full-size viewer for the evidence grid: opens in-page (no new tab), pages
 * through the set with the on-screen arrows, ← / → keys, or a touch swipe, and
 * closes on the X, a backdrop click, or Escape. Focus is trapped and restored.
 */
export function EvidenceLightbox({
  entries,
  index,
  titlePrefix,
  onIndexChange,
  onClose,
}: {
  entries: EvidenceImageEntry[];
  index: number;
  titlePrefix: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const count = entries.length;

  const goPrev = useCallback(
    () => onIndexChange((index - 1 + count) % count),
    [index, count, onIndexChange],
  );
  const goNext = useCallback(
    () => onIndexChange((index + 1) % count),
    [index, count, onIndexChange],
  );

  // A fresh photo each time we page — clear any prior broken-image state.
  useEffect(() => {
    setBroken(false);
  }, [index]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (event.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) {
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [goPrev, goNext, onClose]);

  const { image, sourceUrl } = entries[index];
  const gps = formatEvidenceGps(image);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${titlePrefix} ${index + 1} of ${count}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => {
          touchStartX.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touchStartX.current;
          touchStartX.current = null;
          if (start === null || count < 2) {
            return;
          }
          const dx = (event.changedTouches[0]?.clientX ?? start) - start;
          if (dx > 40) {
            goPrev();
          } else if (dx < -40) {
            goNext();
          }
        }}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">
            {titlePrefix} {index + 1}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {index + 1} / {count}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-100 p-3">
          {sourceUrl && !broken ? (
            <img
              src={sourceUrl}
              alt={image.filename ?? `${titlePrefix} ${index + 1}`}
              onError={() => setBroken(true)}
              className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-slate-500">
              <ImageOff size={28} className="text-slate-400" />
              Photo unavailable — the file could not be loaded.
            </div>
          )}

          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/90 p-2 text-slate-700 shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/90 p-2 text-slate-700 shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <ChevronRight size={20} />
              </button>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{formatEvidenceTimestamp(image)}</span>
            {gps ? <span>GPS {gps}</span> : null}
            {image.note ? <span className="text-slate-500">{image.note}</span> : null}
          </span>
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="font-semibold text-[var(--brand)] hover:underline"
            >
              Open full size
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
