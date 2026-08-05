"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownAZ,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  ImageOff,
  Pencil,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { RondaanCheckIssue } from "@ascure/shared-utils";

import {
  EvidenceLightbox,
  buildEvidenceEntries,
  type EvidenceImageEntry,
} from "@/components/inspection-evidence-grid";
import { ApiError } from "@/lib/api";
import { fetchAssetDetail, updateAssetCode } from "@/lib/assets";
import { isMapAssetInspected, type MapAsset } from "@/lib/map";
import { editChecklistValue, requestReinspection } from "@/lib/site-visits";
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

/** IMAGE items record a photo, not a value. They're dropped from the checklist
 *  entirely — every photo lives in the strip above it instead, captioned with
 *  the field it was captured against. */
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

/**
 * Every photo on the inspection as one horizontally swipeable row — scroll or
 * drag through them at a glance without opening anything; click one to open the
 * full-size viewer, which pages with its own arrows, ← / → or a swipe. Each
 * thumbnail is captioned with the checklist field it was captured against.
 */
function PhotoStrip({
  entries,
  onOpen,
}: {
  entries: EvidenceImageEntry[];
  onOpen: (index: number) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <ImageOff size={13} />
        No photos captured for this inspection.
      </p>
    );
  }

  return (
    <div className="-mx-3.5 overflow-x-auto px-3.5 [scrollbar-width:thin]">
      <div className="flex snap-x snap-mandatory gap-2 pb-1">
        {entries.map(({ image, sourceUrl }, index) => (
          <button
            type="button"
            key={`${image.id ?? "photo"}-${index}`}
            onClick={() => onOpen(index)}
            title={image.note ?? undefined}
            className="group w-[124px] shrink-0 snap-start overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-muted)] text-left outline-none transition hover:border-[var(--brand)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl}
              alt={image.note ?? image.filename ?? "Inspection photo"}
              loading="lazy"
              className="h-[86px] w-full object-cover"
            />
            <span className="block truncate px-1.5 py-1 text-[10.5px] font-semibold text-[var(--foreground-soft)]">
              {image.note ?? `Photo ${index + 1}`}
            </span>
          </button>
        ))}
      </div>
    </div>
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
  canEdit,
  onSave,
}: {
  column: ChecklistColumn;
  value: string | null;
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

  const templateOptions = column.options ?? [];
  const isMulti = column.inputType === "MULTI_SELECT";
  const editable = canEdit;

  // MULTI_SELECT rides the wire as a comma-separated list of option VALUES (the
  // API validates each against the template and stores them as a valueJson
  // array), so the draft splits and rejoins on that.
  const draftPicks = useMemo(
    () =>
      draft
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    [draft],
  );

  // A recorded value that is NOT among the template's current options (the
  // template was edited after the survey, or the answer predates it) would leave
  // the dropdown blank — and saving from there would silently discard what the
  // crew recorded. Keep it as an extra choice so it stays visible and selected.
  //
  // ⚠ ONLY for a column that genuinely HAS options. Without that guard this
  // synthesised a one-item list for every NUMBER/TEXT field carrying a value,
  // which turned their typed inputs into a bogus "<value> (not in list)"
  // dropdown — i.e. they could no longer be edited at all.
  const options = useMemo(() => {
    if (templateOptions.length === 0) {
      return templateOptions;
    }
    const current = value?.trim();
    if (!current || templateOptions.some((option) => option.value === current)) {
      return templateOptions;
    }
    return [...templateOptions, { value: current, label: `${current} (not in list)` }];
  }, [templateOptions, value]);

  // Show what the crew PICKED, not the stored code: a SELECT stores the option
  // value ("A") while the template's label carries the meaning ("A - Super
  // Critical"). Falls back to the raw value when there is no matching option.
  const displayValue = useMemo(() => {
    if (!value) {
      return value;
    }
    const labelFor = (raw: string) =>
      templateOptions.find((option) => option.value === raw)?.label ?? raw;
    // A multi-select's stored value is the joined picks — label each one.
    return isMulti
      ? value
          .split(",")
          .map((entry) => labelFor(entry.trim()))
          .join(", ")
      : labelFor(value);
  }, [templateOptions, value, isMulti]);

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
        {editing ? (
          <div className="flex items-start gap-1.5">
            {isMulti && templateOptions.length > 0 ? (
              <div className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-[var(--panel)] p-1.5">
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {templateOptions.map((option) => {
                    const checked = draftPicks.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-start gap-1.5 text-[12px] text-[var(--foreground)]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={() =>
                            setDraft(
                              (checked
                                ? draftPicks.filter((pick) => pick !== option.value)
                                : [...draftPicks, option.value]
                              ).join(", "),
                            )
                          }
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : options.length > 0 ? (
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
            <span
              title={displayValue ?? undefined}
              className={`min-w-0 flex-1 truncate ${value ? "" : "text-[var(--muted)]"}`}
            >
              {displayValue || "—"}
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

/**
 * The pole's NO TIANG RONDAAN (its asset code), inline-editable by the same
 * people who may edit a checklist value. When the rondaan pre-check flags this
 * pole the code turns red and the reason sits under it, so a manager reviewing
 * the map can spot a bad number and fix it on the spot rather than discovering
 * it at visit-completion.
 */
function RondaanCode({
  code,
  issues,
  canEdit,
  onSave,
}: {
  code: string;
  issues: RondaanCheckIssue[];
  canEdit: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(code);
    setEditing(false);
    setError("");
  }, [code]);

  const hasError = issues.some((issue) => issue.severity === "error");
  // A one-tap correction when the check knows the canonical form.
  const suggestion = issues.find((issue) => issue.suggestedCode)?.suggestedCode;

  const commit = useCallback(
    async (value: string) => {
      const next = value.trim();
      if (!next || next === code) {
        setEditing(false);
        setDraft(code);
        return;
      }
      setSaving(true);
      setError("");
      try {
        await onSave(next);
        setEditing(false);
      } catch (saveError) {
        setError(
          saveError instanceof Error ? saveError.message : "Unable to save this code.",
        );
      } finally {
        setSaving(false);
      }
    },
    [code, onSave],
  );

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit(draft);
            if (event.key === "Escape") {
              setDraft(code);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-[var(--brand)] bg-[var(--panel)] px-2 py-1 font-mono text-[13px] font-bold text-[var(--foreground)]"
        />
        <button
          type="button"
          aria-label="Save"
          onClick={() => void commit(draft)}
          disabled={saving}
          className="rounded-md p-1 text-[var(--brand)] transition hover:bg-[var(--panel-muted)] disabled:opacity-50"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => {
            setDraft(code);
            setEditing(false);
            setError("");
          }}
          disabled={saving}
          className="rounded-md p-1 text-[var(--muted)] transition hover:bg-[var(--panel-muted)] disabled:opacity-50"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        title={canEdit ? "Edit NO TIANG RONDAAN" : undefined}
        className={`group flex w-full items-center gap-1.5 rounded-md text-left font-mono text-[14px] font-bold ${
          hasError ? "text-[var(--critical-text)]" : "text-[var(--foreground)]"
        } ${canEdit ? "cursor-text transition hover:bg-[var(--panel-muted)]" : "cursor-default"}`}
      >
        <span className="min-w-0 flex-1 truncate">{code}</span>
        {canEdit ? (
          <Pencil
            size={11}
            className="shrink-0 text-[var(--muted-2)] opacity-0 transition group-hover:opacity-100"
          />
        ) : null}
      </button>

      {issues.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {issues.map((issue, index) => (
            <li
              key={index}
              className={`flex items-start gap-1 text-[11px] leading-snug ${
                issue.severity === "error"
                  ? "text-[var(--critical-text)]"
                  : "text-[var(--medium-text)]"
              }`}
            >
              <AlertTriangle size={11} className="mt-[2px] shrink-0" />
              <span className="min-w-0">{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {suggestion && canEdit ? (
        <button
          type="button"
          onClick={() => void commit(suggestion)}
          className="mt-1 text-[11px] font-semibold text-[var(--brand)] transition hover:underline"
        >
          Fix to “{suggestion}”
        </button>
      ) : null}

      {error ? (
        <p className="mt-1 text-[11px] text-[var(--critical-text)]">{error}</p>
      ) : null}
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
  /** A network-owner (TNB) viewer: read-only, and a blocked pole means its
   *  survey hasn't been completed yet rather than a genuine error. */
  isClientViewer?: boolean;
  /** Rondaan pre-check issues anchored to THIS pole (bad format, duplicate,
   *  spacing). Computed across the whole loaded pole set by the map. */
  rondaanIssues: RondaanCheckIssue[];
  /** Refetch the map's poles after the pole's code changed, so the list, the
   *  marker labels and the rondaan check all catch up. */
  onAssetCodeChanged: () => void;
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
  isClientViewer = false,
  rondaanIssues,
  onAssetCodeChanged,
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
  // The checklist shows only recorded fields by default; this reveals the whole
  // template (and is how you fill in a field that was left blank).
  const [showAllChecklist, setShowAllChecklist] = useState(false);
  // A–Z ordering for the checklist — find a field by name instead of scanning
  // template order. Alphabetical interleaves the template sections, so sorted
  // mode renders as one flat list without the section headers.
  const [sortChecklistAlpha, setSortChecklistAlpha] = useState(false);
  // Which photo is open in the full-size viewer (null = closed).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // The "send this pole back" prompt — open, the typed reason, and in-flight.
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
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
      // A client viewer only ever reaches a pole in their own Mainheads, so the
      // one failure they can hit is the evidence gate — the survey hasn't left
      // the field yet. Say that instead of a bare "unable to load".
      if (isClientViewer && loadError instanceof ApiError && loadError.status === 404) {
        setError(
          "This pole's survey is still in progress. Its details appear once the crew completes it.",
        );
      } else {
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load this asset.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, asset.id, isClientViewer, onUnauthorized]);

  useEffect(() => {
    void load();
    // Stepping to another pole should start at the top of its record, with any
    // open photo viewer closed (it belongs to the pole we just left).
    setLightboxIndex(null);
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

  // Every photo on the inspection, each captioned (via `note`, which the strip
  // and the lightbox both render) with the checklist field it was captured
  // against — that label is why the IMAGE rows can leave the checklist without
  // losing which photo is which.
  const photos = useMemo(() => {
    const labelByItemId = new Map<string, string>();
    for (const column of checklist?.columns ?? []) {
      for (const templateItemId of column.templateItemIds ?? []) {
        labelByItemId.set(templateItemId, column.label);
      }
    }
    return buildEvidenceEntries(
      (inspection?.images ?? []).map((image) => {
        const label = image.templateItemId
          ? labelByItemId.get(image.templateItemId)
          : undefined;
        return label ? { ...image, note: label } : image;
      }),
    );
  }, [inspection, checklist]);

  // IMAGE fields are dropped from the checklist — their photos live in the strip
  // above, captioned with the field name, so the checklist stays a list of
  // values you can read (and edit) in one pass.
  const valueColumns = useMemo(
    () => (checklist?.columns ?? []).filter((column) => !isImageColumn(column)),
    [checklist],
  );

  // The checklist starts curated — only fields the crew actually recorded.
  // "See all" reveals the rest of the template, which is also how you fill in a
  // field left blank. Mirrors the asset-detail Inspection Result toggle.
  const filledColumns = useMemo(
    () =>
      valueColumns.filter(
        (column) => (checklist?.values?.[column.key] ?? "") !== "",
      ),
    [valueColumns, checklist],
  );
  const totalColumns = valueColumns.length;
  const hiddenColumnCount = totalColumns - filledColumns.length;
  const displayedColumns = showAllChecklist ? valueColumns : filledColumns;

  // Group the shown fields by their template section so the panel reads the way
  // the crew filled it in. Fields with no section fall into one unnamed group.
  const grouped = useMemo(() => {
    if (sortChecklistAlpha) {
      return displayedColumns.length > 0
        ? [
            {
              section: null,
              columns: [...displayedColumns].sort((a, b) =>
                a.label.localeCompare(b.label),
              ),
            },
          ]
        : [];
    }
    const groups: { section: string | null; columns: ChecklistColumn[] }[] = [];
    for (const column of displayedColumns) {
      const section = column.section ?? null;
      const last = groups[groups.length - 1];
      if (last && last.section === section) {
        last.columns.push(column);
      } else {
        groups.push({ section, columns: [column] });
      }
    }
    return groups;
  }, [displayedColumns, sortChecklistAlpha]);

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

  const saveAssetCode = useCallback(
    async (next: string) => {
      if (!token) {
        throw new Error("Your session has expired.");
      }
      await updateAssetCode(token, asset.id, next);
      // The code is the marker label AND the rondaan check's input, so refresh
      // the map's poles rather than only this panel.
      onAssetCodeChanged();
      await load();
    },
    [token, asset.id, onAssetCodeChanged, load],
  );

  const sendBack = useCallback(async () => {
    if (!token || !inspection?.id) {
      return;
    }
    setSendingBack(true);
    setError("");
    try {
      await requestReinspection(token, inspection.id, sendBackReason.trim());
      setSendBackOpen(false);
      setSendBackReason("");
      // The pole now reads "not inspected" — refresh the panel AND the map so
      // its marker turns red immediately.
      onAssetCodeChanged();
      await load();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send this pole back.",
      );
    } finally {
      setSendingBack(false);
    }
  }, [token, inspection?.id, sendBackReason, onAssetCodeChanged, load]);

  const defectItems = (inspection?.items ?? []).filter((item) => item.isDefect);

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-30 flex w-[380px] max-w-[92vw] flex-col border-l border-[var(--line)] bg-[var(--panel)] shadow-[-8px_0_28px_rgba(11,14,18,.16)]">
      {/* Header — code + the ‹ N of M › stepper. */}
      <div className="shrink-0 border-b border-[var(--line)] px-3.5 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <RondaanCode
              code={asset.assetCode}
              issues={rondaanIssues}
              canEdit={canEdit}
              onSave={saveAssetCode}
            />
            <p className="truncate text-[12px] text-[var(--muted)]">
              {asset.substation?.name || asset.substation?.code || "—"}
            </p>
            {detail && detail.savtRoutes.length > 1 ? (
              // A shared-corridor pole: one physical pole, one printed code per
              // feeder — list every route's code so it reads as shared, not as
              // a duplicate (docs/PLAN-savt-shared-poles.md).
              <p className="mt-0.5 text-[11px] font-medium text-[var(--brand)]">
                Tiang kongsi ({detail.savtRoutes.length} laluan):{" "}
                {detail.savtRoutes.map((route) => route.poleCode).join(" · ")}
              </p>
            ) : null}
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

              {/* Sent back for re-inspection — the crew sees this pole as
                  not-inspected until they re-submit it. */}
              {inspection?.reinspectionReason ? (
                <div className="mt-2.5 rounded-md border border-[var(--medium-border)] bg-[var(--medium-bg)] px-2.5 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--medium-text)]">
                    Sent back for re-inspection
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-[var(--medium-text)]">
                    {inspection.reinspectionReason}
                  </p>
                  {inspection.reinspectionRequestedAt ? (
                    <p className="mt-0.5 text-[11px] text-[var(--medium-text)] opacity-80">
                      {formatDate(inspection.reinspectionRequestedAt)}
                    </p>
                  ) : null}
                </div>
              ) : null}

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

            {/* Send this pole back for re-inspection. Only offered to someone
                who may govern the data, on a pole that is actually submitted —
                and never twice. */}
            {canEdit && inspection && !inspection.reinspectionReason ? (
              <div className="border-b border-[var(--line)] px-3.5 py-3">
                {sendBackOpen ? (
                  <div>
                    <label className="block text-[12px] font-semibold text-[var(--foreground)]">
                      Why does this pole need re-inspecting?
                    </label>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      The crew sees this. The recorded answers and photos are
                      kept — the pole simply reads as not inspected until they
                      redo it.
                    </p>
                    <textarea
                      autoFocus
                      rows={3}
                      value={sendBackReason}
                      disabled={sendingBack}
                      onChange={(event) => setSendBackReason(event.target.value)}
                      placeholder="e.g. Kelegaan reading 5.98 m does not match the photo — please re-measure"
                      className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5 text-[12px] text-[var(--foreground)]"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void sendBack()}
                        disabled={sendingBack || sendBackReason.trim().length === 0}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--on-brand)] transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {sendingBack ? (
                          <RefreshCw size={13} className="animate-spin" />
                        ) : (
                          <RotateCcw size={13} />
                        )}
                        Send back
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSendBackOpen(false);
                          setSendBackReason("");
                        }}
                        disabled={sendingBack}
                        className="text-[12px] font-semibold text-[var(--muted)] transition hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSendBackOpen(true)}
                    title="Mark this pole as needing re-inspection, keeping the recorded data"
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--foreground-soft)] transition hover:text-[var(--brand)]"
                  >
                    <RotateCcw size={13} />
                    Send back for re-inspection
                  </button>
                )}
              </div>
            ) : null}

            {/* Photos — above the checklist so the evidence reads first, and
                swipeable in place without opening anything. */}
            <section className="border-b border-[var(--line)] px-3.5 py-3">
              <div className="flex items-center justify-between gap-2 pb-2">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
                  <Camera size={14} className="text-[var(--brand)]" />
                  Photos
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {photos.length > 0 ? `${photos.length} · swipe to browse` : "0"}
                </span>
              </div>
              <PhotoStrip entries={photos} onOpen={setLightboxIndex} />
            </section>

            {/* Checklist */}
            <section className="border-b border-[var(--line)]">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
                  <ClipboardList size={14} className="text-[var(--brand)]" />
                  Checklist
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--muted)]">
                    {canEdit ? "Click a value to edit" : "Read-only"}
                  </span>
                  {totalColumns > 1 ? (
                    <button
                      type="button"
                      onClick={() => setSortChecklistAlpha((value) => !value)}
                      aria-pressed={sortChecklistAlpha}
                      title={
                        sortChecklistAlpha
                          ? "Back to the template's order, grouped by section"
                          : "Sort the checklist fields A–Z"
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                        sortChecklistAlpha
                          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                          : "border-[var(--line)] bg-[var(--panel)] text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
                      }`}
                    >
                      <ArrowDownAZ size={11} />
                      {sortChecklistAlpha ? "A–Z" : "Sort"}
                    </button>
                  ) : null}
                  {hiddenColumnCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllChecklist((value) => !value)}
                      aria-pressed={showAllChecklist}
                      title={
                        showAllChecklist
                          ? "Show only the fields that were recorded"
                          : `Show all ${totalColumns} checklist fields, including the ${hiddenColumnCount} left blank`
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition ${
                        showAllChecklist
                          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                          : "border-[var(--line)] bg-[var(--panel)] text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
                      }`}
                    >
                      {showAllChecklist ? <EyeOff size={11} /> : <Eye size={11} />}
                      {showAllChecklist ? "Recorded" : `See all (${totalColumns})`}
                    </button>
                  ) : null}
                </div>
              </div>

              {!inspection ? (
                <p className="px-3.5 pb-3 text-[12px] text-[var(--muted)]">
                  This pole has no submitted inspection yet.
                </p>
              ) : totalColumns === 0 ? (
                <p className="px-3.5 pb-3 text-[12px] text-[var(--muted)]">
                  No checklist fields on this inspection&apos;s template.
                </p>
              ) : grouped.length === 0 ? (
                <p className="px-3.5 pb-3 text-[12px] text-[var(--muted)]">
                  Nothing was recorded against this checklist. Use “See all” to
                  view the {totalColumns} available fields.
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

          </>
        ) : null}
      </div>

      {lightboxIndex !== null && photos[lightboxIndex] ? (
        <EvidenceLightbox
          entries={photos}
          index={lightboxIndex}
          titlePrefix="Photo"
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </aside>
  );
}
