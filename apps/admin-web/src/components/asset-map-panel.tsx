"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  ImageOff,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";

import {
  EvidenceImageGrid,
  buildEvidenceEntries,
  getImageSourceUrl,
} from "@/components/inspection-evidence-grid";
import { ApiError } from "@/lib/api";
import { fetchAssetDetail } from "@/lib/assets";
import { isMapAssetInspected, type MapAsset } from "@/lib/map";
import { editChecklistValue } from "@/lib/site-visits";
import type { AssetDetail } from "@/types/assets";
import type { ChecklistColumn } from "@/types/site-visits";

/**
 * The map's asset side panel: click a pole and its full record slides in —
 * details, the inspection checklist (editable by a manager/DC/ADMIN), and the
 * captured photos — with ‹ › to walk the poles currently on the map without
 * leaving the map. The checklist reads and writes the same values the Site Visit
 * Linked-Assets table does, through `PATCH /inspections/:id/checklist-result`.
 */

function formatDate(date: string | null | undefined) {
  if (!date) {
    return "—";
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

/** The HTML input type for a checklist item's template input type. */
function inputTypeFor(column: ChecklistColumn): string {
  switch (column.inputType) {
    case "NUMBER":
    case "READING":
      return "number";
    case "DATE":
      return "date";
    case "DATETIME":
      return "datetime-local";
    default:
      return "text";
  }
}

/** IMAGE items record a photo, not a value — their cell is read-only. */
function isImageColumn(column: ChecklistColumn): boolean {
  return column.inputType === "IMAGE";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[12.5px] text-[var(--foreground)]" title={value}>
        {value}
      </p>
    </div>
  );
}

/** The photo recorded against an IMAGE checklist item — a thumbnail that opens
 *  the full frame in a new tab, or a placeholder when nothing was captured. */
function ChecklistPhotoCell({ url }: { url: string | null }) {
  if (!url) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[var(--muted)]">
        <ImageOff size={13} />
        No photo
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--brand)] hover:underline"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        className="h-9 w-9 rounded-md border border-[var(--line)] object-cover"
      />
      View
      <ExternalLink size={12} />
    </a>
  );
}

/**
 * One checklist row. Reads as plain text until the user starts an edit, then
 * becomes the editor the template calls for: a dropdown when the item defines
 * options (SELECT / BOOLEAN), else a typed input. Saving is per-row so one
 * failure never blocks the rest of the checklist.
 */
function ChecklistRow({
  column,
  value,
  photoUrl,
  canEdit,
  onSave,
}: {
  column: ChecklistColumn;
  value: string | null;
  photoUrl: string | null;
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A refetch (or stepping to another pole) must win over a stale draft.
  useEffect(() => {
    setDraft(value ?? "");
    setEditing(false);
    setError("");
  }, [value, column.key]);

  const options = column.options ?? [];
  const editable = canEdit && !isImageColumn(column);

  const commit = useCallback(async () => {
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
      setEditing(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save this value.",
      );
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  return (
    <div className="grid grid-cols-[1fr_1.1fr] items-start gap-3 border-b border-[var(--line2)] px-3.5 py-2 last:border-b-0">
      <p className="text-[12px] leading-snug text-[var(--foreground-soft)]">
        {column.label}
      </p>

      <div className="min-w-0">
        {isImageColumn(column) ? (
          <ChecklistPhotoCell url={photoUrl} />
        ) : editing ? (
          <div className="flex items-center gap-1.5">
            {options.length > 0 ? (
              <select
                autoFocus
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--foreground)]"
              >
                <option value="">—</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                type={inputTypeFor(column)}
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void commit();
                  }
                  if (event.key === "Escape") {
                    setDraft(value ?? "");
                    setEditing(false);
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-[var(--panel)] px-2 py-1 text-[12px] text-[var(--foreground)]"
              />
            )}
            <button
              type="button"
              aria-label="Save"
              onClick={() => void commit()}
              disabled={saving}
              className="rounded-md p-1 text-[var(--brand)] transition hover:bg-[var(--panel-muted)] disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
            </button>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setDraft(value ?? "");
                setEditing(false);
                setError("");
              }}
              disabled={saving}
              className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--panel-muted)] disabled:opacity-50"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!editable}
            onClick={() => setEditing(true)}
            title={editable ? "Edit this value" : undefined}
            className={`group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] ${
              editable
                ? "cursor-text text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
                : "cursor-default text-[var(--foreground)]"
            }`}
          >
            <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-[var(--muted)]"}`}>
              {value || "—"}
            </span>
            {editable ? (
              <Pencil
                size={11}
                className="shrink-0 text-[var(--muted-2)] opacity-0 transition group-hover:opacity-100"
              />
            ) : null}
          </button>
        )}

        {error ? (
          <p className="mt-1 text-[11px] text-[var(--critical-text)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

export interface AssetMapPanelProps {
  /** The pole clicked on the map — its marker data seeds the header instantly
   *  while the full record loads. */
  asset: MapAsset;
  token: string | null;
  /** ADMIN / DC / the managing MANAGER — the API re-enforces its own scope. */
  canEdit: boolean;
  /** Position within the poles currently on the map, for the ‹ N of M › stepper. */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onOpenFullPage: () => void;
  onUnauthorized: () => void;
}

export function AssetMapPanel({
  asset,
  token,
  canEdit,
  index,
  total,
  onPrev,
  onNext,
  onClose,
  onOpenFullPage,
  onUnauthorized,
}: AssetMapPanelProps) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      setDetail(await fetchAssetDetail(token, asset.id));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      setDetail(null);
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load this asset.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [token, asset.id, onUnauthorized]);

  useEffect(() => {
    void load();
    // Stepping to another pole should start at the top of its record.
    scrollRef.current?.scrollTo({ top: 0 });
  }, [load]);

  // ← / → step through the poles. Ignored while the user is typing so the arrow
  // keys still move the caret inside a checklist editor.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (event.key === "ArrowLeft" && index > 0) {
        onPrev();
      }
      if (event.key === "ArrowRight" && index < total - 1) {
        onNext();
      }
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, total, onPrev, onNext, onClose]);

  const inspection = detail?.latestInspection ?? null;
  const checklist = inspection?.checklist ?? null;

  const photos = useMemo(
    () => buildEvidenceEntries(inspection?.images ?? []),
    [inspection],
  );

  // Group the checklist by its template section so the panel reads the way the
  // crew filled it in. Items with no section fall into one unnamed group.
  const grouped = useMemo(() => {
    const groups: { section: string | null; columns: ChecklistColumn[] }[] = [];
    for (const column of checklist?.columns ?? []) {
      const section = column.section ?? null;
      const last = groups[groups.length - 1];
      if (last && last.section === section) {
        last.columns.push(column);
      } else {
        groups.push({ section, columns: [column] });
      }
    }
    return groups;
  }, [checklist]);

  const photoUrlFor = useCallback(
    (column: ChecklistColumn): string | null => {
      for (const templateItemId of column.templateItemIds ?? []) {
        const photo = checklist?.images?.[templateItemId];
        if (photo) {
          return getImageSourceUrl(photo);
        }
      }
      return null;
    },
    [checklist],
  );

  const saveValue = useCallback(
    async (column: ChecklistColumn, next: string) => {
      if (!token || !inspection?.id) {
        throw new Error("This pole has no submitted inspection to edit.");
      }
      await editChecklistValue(
        token,
        inspection.id,
        column.key,
        next,
        inspection.siteVisitId ?? "",
      );
      // Reflect the saved value locally — the server coerces by input type, so
      // reload rather than trusting the raw draft for anything typed.
      await load();
    },
    [token, inspection?.id, inspection?.siteVisitId, load],
  );

  const defectItems = (inspection?.items ?? []).filter((item) => item.isDefect);

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-30 flex w-[380px] max-w-[92vw] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[-8px_0_28px_rgba(11,14,18,.16)]">
      {/* Header — code + the ‹ N of M › stepper. */}
      <div className="shrink-0 border-b border-[var(--line)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-[14px] font-bold text-[var(--foreground)]">
              {asset.assetCode}
            </p>
            <p className="truncate text-[12px] text-[var(--muted)]">
              {asset.substation?.name || asset.substation?.code || "—"}
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

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous asset"
              onClick={onPrev}
              disabled={index <= 0}
              className="rounded-md border border-[var(--line)] p-1 text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="px-1 font-mono text-[11px] text-[var(--muted)]">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              aria-label="Next asset"
              onClick={onNext}
              disabled={index >= total - 1}
              className="rounded-md border border-[var(--line)] p-1 text-[var(--foreground-soft)] transition hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenFullPage}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--brand)] transition hover:underline"
          >
            Full page
            <ExternalLink size={12} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="m-3.5 rounded-lg border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-[12px] text-[var(--critical-text)]">
            {error}
          </div>
        ) : null}

        {isLoading && !detail ? (
          <div className="space-y-2 p-3.5">
            {Array.from({ length: 8 }).map((_, position) => (
              <div
                key={position}
                className="h-8 animate-pulse rounded-md bg-[var(--panel-muted)]"
              />
            ))}
          </div>
        ) : null}

        {detail ? (
          <>
            {/* Status + key facts */}
            <div className="border-b border-[var(--line)] px-3.5 py-3">
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    isMapAssetInspected(asset)
                      ? "border-[var(--good-border)] bg-[var(--good-bg)] text-[var(--good-text)]"
                      : "border-[var(--line)] bg-[var(--panel-muted)] text-[var(--muted)]"
                  }`}
                >
                  {isMapAssetInspected(asset) ? "Inspected" : "Not inspected"}
                </span>
                {asset.openDefectCount > 0 ? (
                  <span className="rounded-full border border-[var(--critical-border)] bg-[var(--critical-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--critical-text)]">
                    {asset.openDefectCount} open
                    {asset.hasEmergencyDefect ? " · emergency" : ""}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
                <Field label="Asset type" value={detail.assetType || "—"} />
                <Field label="Feeder" value={detail.feeder || "—"} />
                <Field label="Team" value={asset.team?.name || "—"} />
                <Field label="Inspected" value={formatDate(inspection?.submittedAt)} />
                <Field
                  label="Latitude"
                  value={detail.latitude === null ? "—" : detail.latitude.toFixed(6)}
                />
                <Field
                  label="Longitude"
                  value={detail.longitude === null ? "—" : detail.longitude.toFixed(6)}
                />
              </div>
            </div>

            {/* Checklist */}
            <section className="border-b border-[var(--line)]">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
                  <ClipboardList size={14} className="text-[var(--brand)]" />
                  Checklist
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {canEdit ? "Click a value to edit" : "Read-only"}
                </span>
              </div>

              {!inspection ? (
                <p className="px-3.5 pb-3 text-[12px] text-[var(--muted)]">
                  This pole has no submitted inspection yet.
                </p>
              ) : grouped.length === 0 ? (
                <p className="px-3.5 pb-3 text-[12px] text-[var(--muted)]">
                  No checklist fields on this inspection&apos;s template.
                </p>
              ) : (
                grouped.map((group, groupIndex) => (
                  <div key={`${group.section ?? "ungrouped"}-${groupIndex}`}>
                    {group.section ? (
                      <p className="bg-[var(--panel-muted)] px-3.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
                        {group.section}
                      </p>
                    ) : null}
                    {group.columns.map((column) => (
                      <ChecklistRow
                        key={column.key}
                        column={column}
                        value={checklist?.values?.[column.key] ?? null}
                        photoUrl={photoUrlFor(column)}
                        canEdit={canEdit}
                        onSave={(next) => saveValue(column, next)}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>

            {/* Defects raised by this inspection */}
            {defectItems.length > 0 ? (
              <section className="border-b border-[var(--line)] px-3.5 py-3">
                <p className="text-[12.5px] font-semibold text-[var(--foreground)]">
                  Defects ({defectItems.length})
                </p>
                <ul className="mt-2 space-y-1.5">
                  {defectItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-[var(--critical-border)] bg-[var(--critical-bg)] px-2.5 py-1.5 text-[12px] text-[var(--critical-text)]"
                    >
                      <span className="font-semibold">{item.label}</span>
                      {item.severity ? ` · ${item.severity}` : ""}
                      {item.remark ? (
                        <span className="block text-[11.5px] opacity-90">
                          {item.remark}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Photos */}
            <section className="px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
                  <Camera size={14} className="text-[var(--brand)]" />
                  Photos
                </span>
                <span className="text-[11px] text-[var(--muted)]">{photos.length}</span>
              </div>
              <div className="mt-2.5">
                <EvidenceImageGrid
                  entries={photos}
                  emptyText="No photos captured for this inspection."
                  titlePrefix="Inspection Image"
                />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </aside>
  );
}
