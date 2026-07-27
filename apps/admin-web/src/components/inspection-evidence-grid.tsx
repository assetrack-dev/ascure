"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X, ZoomIn, ZoomOut } from "lucide-react";

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

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

/** Keep the pan offset inside the zoomed image's travel range so the photo
 *  can never be dragged fully out of the frame. */
function clampZoomView(view: ZoomView, rect: DOMRect): ZoomView {
  const maxX = ((view.scale - 1) * rect.width) / 2;
  const maxY = ((view.scale - 1) * rect.height) / 2;
  return {
    scale: view.scale,
    x: Math.min(maxX, Math.max(-maxX, view.x)),
    y: Math.min(maxY, Math.max(-maxY, view.y)),
  };
}

/**
 * Full-size viewer for the evidence grid: opens in-page (no new tab), pages
 * through the set with the on-screen arrows, ← / → keys, or a touch swipe, and
 * closes on the X, a backdrop click, or Escape. Focus is trapped and restored.
 * The photo zooms with the scroll wheel (at the cursor), a click, the +/− keys
 * or header buttons, and pans by dragging while zoomed.
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
  const imageAreaRef = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const [view, setView] = useState<ZoomView>({ scale: 1, x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panState = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  // A drag that panned the photo must not also fire the click-to-zoom toggle.
  const suppressClick = useRef(false);
  const count = entries.length;

  const goPrev = useCallback(
    () => onIndexChange((index - 1 + count) % count),
    [index, count, onIndexChange],
  );
  const goNext = useCallback(
    () => onIndexChange((index + 1) % count),
    [index, count, onIndexChange],
  );

  /** Zoom by `factor`, keeping the point under (clientX, clientY) fixed —
   *  pass nulls to zoom on the frame centre (buttons, keyboard). */
  const zoomAt = useCallback(
    (clientX: number | null, clientY: number | null, factor: number) => {
      const rect = imageAreaRef.current?.getBoundingClientRect();
      setView((prev) => {
        const nextScale = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.scale * factor),
        );
        if (nextScale === MIN_ZOOM || !rect) {
          return { scale: nextScale, x: 0, y: 0 };
        }
        const cx = clientX === null ? 0 : clientX - rect.left - rect.width / 2;
        const cy = clientY === null ? 0 : clientY - rect.top - rect.height / 2;
        const ratio = nextScale / prev.scale;
        return clampZoomView(
          {
            scale: nextScale,
            x: cx - ratio * (cx - prev.x),
            y: cy - ratio * (cy - prev.y),
          },
          rect,
        );
      });
    },
    [],
  );

  const resetZoom = useCallback(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, []);

  // A fresh photo each time we page — clear any prior broken-image state and
  // start it unzoomed.
  useEffect(() => {
    setBroken(false);
    setView({ scale: 1, x: 0, y: 0 });
  }, [index]);

  // Scroll wheel zooms at the cursor. React's synthetic onWheel can't call
  // preventDefault (the root listener is passive), so bind natively.
  useEffect(() => {
    const node = imageAreaRef.current;
    if (!node) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.25 : 0.8);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

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
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(null, null, 1.25);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAt(null, null, 0.8);
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
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
  }, [goPrev, goNext, onClose, zoomAt, resetZoom]);

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
          // While zoomed, a touch drag pans the photo — don't page on it.
          if (start === null || count < 2 || view.scale > 1) {
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
          <div className="flex items-center gap-1">
            {sourceUrl && !broken ? (
              <>
                <button
                  type="button"
                  onClick={() => zoomAt(null, null, 0.8)}
                  disabled={view.scale <= MIN_ZOOM}
                  aria-label="Zoom out"
                  title="Zoom out (−)"
                  className="rounded-md p-1 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  <ZoomOut size={17} />
                </button>
                <button
                  type="button"
                  onClick={resetZoom}
                  title="Reset zoom (0)"
                  className="min-w-[3.25rem] rounded-md px-1 py-0.5 text-center text-xs font-semibold tabular-nums text-slate-600 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                >
                  {Math.round(view.scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => zoomAt(null, null, 1.25)}
                  disabled={view.scale >= MAX_ZOOM}
                  aria-label="Zoom in"
                  title="Zoom in (+)"
                  className="rounded-md p-1 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand)] disabled:cursor-not-allowed disabled:text-slate-300"
                >
                  <ZoomIn size={17} />
                </button>
                <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
              </>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1 text-slate-500 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          ref={imageAreaRef}
          onPointerDown={(event) => {
            if (view.scale <= 1 || event.button !== 0) {
              return;
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Capture is a nicety (keeps the pan while the cursor leaves the
              // frame); panning must not die when a browser refuses it.
            }
            panState.current = {
              pointerId: event.pointerId,
              lastX: event.clientX,
              lastY: event.clientY,
              moved: false,
            };
            setIsPanning(true);
          }}
          onPointerMove={(event) => {
            const pan = panState.current;
            if (!pan || pan.pointerId !== event.pointerId) {
              return;
            }
            const dx = event.clientX - pan.lastX;
            const dy = event.clientY - pan.lastY;
            if (Math.abs(dx) + Math.abs(dy) > 2) {
              pan.moved = true;
            }
            pan.lastX = event.clientX;
            pan.lastY = event.clientY;
            const rect = imageAreaRef.current?.getBoundingClientRect();
            setView((prev) =>
              rect
                ? clampZoomView(
                    { scale: prev.scale, x: prev.x + dx, y: prev.y + dy },
                    rect,
                  )
                : prev,
            );
          }}
          onPointerUp={(event) => {
            const pan = panState.current;
            if (pan?.pointerId === event.pointerId) {
              suppressClick.current = pan.moved;
              panState.current = null;
              setIsPanning(false);
            }
          }}
          onPointerCancel={(event) => {
            if (panState.current?.pointerId === event.pointerId) {
              panState.current = null;
              setIsPanning(false);
            }
          }}
          onClick={(event) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (!sourceUrl || broken) {
              return;
            }
            if (view.scale === 1) {
              zoomAt(event.clientX, event.clientY, 2.5);
            } else {
              resetZoom();
            }
          }}
          style={{ touchAction: view.scale > 1 ? "none" : undefined }}
          className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-100 p-3 ${
            view.scale > 1
              ? isPanning
                ? "cursor-grabbing"
                : "cursor-grab"
              : sourceUrl && !broken
                ? "cursor-zoom-in"
                : ""
          }`}
        >
          {sourceUrl && !broken ? (
            <img
              src={sourceUrl}
              alt={image.filename ?? `${titlePrefix} ${index + 1}`}
              onError={() => setBroken(true)}
              draggable={false}
              style={{
                transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
              }}
              className={`max-h-[70vh] w-auto max-w-full select-none rounded-lg object-contain ${
                isPanning ? "" : "transition-transform duration-100"
              }`}
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
                onClick={(event) => {
                  event.stopPropagation();
                  goPrev();
                }}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white/90 p-2 text-slate-700 shadow-sm outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  goNext();
                }}
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
            {sourceUrl && !broken ? (
              <span className="text-slate-400">
                Scroll or click to zoom · drag to pan
              </span>
            ) : null}
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
