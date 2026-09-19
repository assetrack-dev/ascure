"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, ImageOff, X } from "lucide-react";

import {
  EvidenceLightbox,
  buildEvidenceEntries,
} from "@/components/inspection-evidence-grid";
import type { PencawangMarker } from "@/lib/map";

/**
 * The map's Pencawang check-in panel: click the blue PE square and the crew's
 * arrival "Site Photos" slide in, so the office can hold the real building up
 * against the satellite view and confirm the PE marker sits on the right
 * Pencawang. Read-only — a mis-pointed PE is fixed from the Pencawang page
 * (manual pin), not here.
 */

function formatCapturedAt(date: string | null | undefined) {
  if (!date) {
    return null;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function PencawangCheckInPanel({
  pencawang,
  onClose,
}: {
  pencawang: PencawangMarker;
  onClose: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const entries = useMemo(
    () =>
      buildEvidenceEntries(
        pencawang.checkInPhotos.map((photo) => ({
          id: photo.id,
          url: photo.url,
          filename: photo.fileName,
          timestamp: photo.capturedAt,
        })),
      ),
    [pencawang.checkInPhotos],
  );

  // Stepping to another Pencawang (or a refetch) must not leave a stale viewer.
  useEffect(() => {
    setLightboxIndex(null);
  }, [pencawang.id]);

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-30 flex w-[340px] max-w-[92vw] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[-8px_0_28px_rgba(11,14,18,.16)]">
      <div className="shrink-0 border-b border-[var(--line)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
              Pencawang check-in
            </p>
            <p
              className="mt-0.5 truncate text-[14px] font-semibold text-[var(--foreground)]"
              title={pencawang.name}
            >
              {pencawang.name}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--panel-muted)] hover:text-[var(--foreground)]"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--muted)]">
          Photos the crew captured on arrival — compare with the satellite view
          to verify this is the right PE.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 [scrollbar-width:thin]">
        {entries.length === 0 ? (
          <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
            <ImageOff size={13} />
            No check-in photos captured for this Pencawang yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {entries.map(({ image, sourceUrl }, index) => (
              <button
                type="button"
                key={image.id ?? index}
                onClick={() => setLightboxIndex(index)}
                className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-muted)] text-left outline-none transition hover:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sourceUrl}
                  alt={image.filename ?? "Check-in photo"}
                  loading="lazy"
                  className="h-[110px] w-full object-cover"
                />
                <span className="flex items-center gap-1 truncate px-1.5 py-1 text-[10.5px] font-semibold text-[var(--foreground-soft)]">
                  <Camera size={11} className="shrink-0" />
                  {formatCapturedAt(image.timestamp) ?? `Photo ${index + 1}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] px-3.5 py-2.5">
        <p className="font-mono text-[10.5px] text-[var(--muted)]">
          {pencawang.latitude.toFixed(6)}, {pencawang.longitude.toFixed(6)}
        </p>
      </div>

      {lightboxIndex !== null && entries[lightboxIndex] ? (
        <EvidenceLightbox
          entries={entries}
          index={lightboxIndex}
          titlePrefix="Check-in photo"
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </aside>
  );
}
