"use client";

import { useState } from "react";
import { ArrowLeftRight, Hammer, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import { buildEvidenceEntries } from "@/components/inspection-evidence-grid";
import {
  deleteRepairPhoto,
  fetchRepairMethods,
  relabelRepairPhoto,
  saveDefectRepairMethod,
  type DefectRepairMethod,
  type RepairMethod,
} from "@/lib/maintenance-corrections";
import type { DefectEvidenceImage } from "@/types/defects";

const STAGES = ["BEFORE", "DURING", "AFTER"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = { BEFORE: "Before", DURING: "During", AFTER: "After" };

/**
 * Plan §20: the office corrects a repair until TNB verifies it —
 * the kind of repair done (Rentis: KAEDAH LAZIM …) and the repair photos
 * (delete, or move a photo filed under the wrong stage). The API checks who
 * may (the crew's company / ADMIN) and refuses once TNB has verified.
 */
export function RepairCorrectionsCard({
  token,
  defectId,
  category,
  repairMethod,
  photos,
  canEdit,
  isVerified,
  onChanged,
  onUnauthorized,
}: {
  token: string | null;
  defectId: string;
  category: string | null;
  repairMethod: DefectRepairMethod | null;
  photos: DefectEvidenceImage[];
  canEdit: boolean;
  /** TNB has verified (CLOSED) — read-only. */
  isVerified: boolean;
  /** Reload the Kejanggalan after a change. */
  onChanged: () => void;
  onUnauthorized: () => void;
}) {
  const [methods, setMethods] = useState<RepairMethod[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [methodId, setMethodId] = useState(repairMethod?.id ?? "");
  const [note, setNote] = useState(repairMethod?.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const repairPhotos = photos
    .filter((photo) => STAGES.includes((photo.evidenceType ?? "") as Stage))
    .flatMap((photo) => {
      const [entry] = buildEvidenceEntries([photo]);
      return entry ? [{ image: photo, sourceUrl: entry.sourceUrl }] : [];
    });
  const editable = canEdit && !isVerified && Boolean(token);
  const chosen = methods?.find((method) => method.id === methodId) ?? null;
  // Only work types that have kinds of repair (Rentis for now) show the picker.
  const showMethod = Boolean(repairMethod) || category === "RENTIS";

  const fail = (failure: unknown, fallback: string) => {
    if (failure instanceof ApiError && failure.status === 401) {
      onUnauthorized();
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  };

  const startEditing = async () => {
    if (!token) return;
    setError("");
    setMethodId(repairMethod?.id ?? "");
    setNote(repairMethod?.note ?? "");
    setEditing(true);
    if (!methods) {
      try {
        setMethods(await fetchRepairMethods(token, category ?? undefined));
      } catch (failure) {
        fail(failure, "Could not load the repair types.");
      }
    }
  };

  const saveMethod = async () => {
    if (!token) return;
    if (chosen?.requiresNote && !note.trim()) {
      setError(`"${chosen.label}" needs a short description of the work done.`);
      return;
    }
    setBusy("method");
    setError("");
    try {
      await saveDefectRepairMethod(token, defectId, methodId || null, chosen?.requiresNote ? note.trim() : null);
      setEditing(false);
      onChanged();
    } catch (failure) {
      fail(failure, "Could not save the repair type.");
    } finally {
      setBusy(null);
    }
  };

  const movePhoto = async (imageId: string, stage: Stage) => {
    if (!token) return;
    setBusy(imageId);
    setError("");
    try {
      await relabelRepairPhoto(token, imageId, stage);
      onChanged();
    } catch (failure) {
      fail(failure, "Could not move the photo.");
    } finally {
      setBusy(null);
    }
  };

  const removePhoto = async (imageId: string) => {
    if (!token) return;
    if (!window.confirm("Delete this repair photo? It is kept in the audit record but disappears from reports.")) {
      return;
    }
    setBusy(imageId);
    setError("");
    try {
      await deleteRepairPhoto(token, imageId);
      onChanged();
    } catch (failure) {
      fail(failure, "Could not delete the photo.");
    } finally {
      setBusy(null);
    }
  };

  if (!showMethod && repairPhotos.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--line)] bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
            <Hammer size={18} /> Repair corrections
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {isVerified
              ? "TNB has verified this repair — it can no longer be changed."
              : "Fix the repair type or the repair photos until TNB verifies. A deleted photo is kept for audit but leaves the reports."}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-[var(--critical-border)] bg-[var(--critical-bg)] px-3 py-2 text-sm text-[var(--critical-text)]">
          {error}
        </div>
      ) : null}

      {showMethod ? (
        <div className="mt-4 rounded-lg border border-[var(--line)] p-4">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
            Repair type
          </p>
          {editing ? (
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
              <select
                aria-label="Repair type"
                value={methodId}
                onChange={(event) => setMethodId(event.target.value)}
                className="h-10 rounded-[9px] border border-[var(--line-strong)] bg-white px-3 text-sm"
              >
                <option value="">— Not set —</option>
                {(methods ?? []).map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.label}
                  </option>
                ))}
              </select>
              {chosen?.requiresNote ? (
                <input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={300}
                  placeholder="Describe the work done"
                  className="h-10 flex-1 rounded-[9px] border border-[var(--line-strong)] px-3 text-sm"
                />
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy === "method"}
                  onClick={() => void saveMethod()}
                  className="h-10 rounded-[9px] bg-[var(--brand)] px-4 text-sm font-semibold text-[var(--on-brand)] disabled:opacity-60"
                >
                  {busy === "method" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-10 rounded-[9px] border border-[var(--line-strong)] px-4 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-[var(--foreground)]">
                {repairMethod?.label ?? <span className="text-[var(--warning-text)]">Not set</span>}
                {repairMethod?.note ? <span className="font-normal text-[var(--foreground-soft)]"> — {repairMethod.note}</span> : null}
              </span>
              {editable ? (
                <button
                  type="button"
                  onClick={() => void startEditing()}
                  className="rounded-[8px] border border-[var(--line-strong)] px-3 py-1 text-[12.5px] font-semibold"
                >
                  {repairMethod ? "Change" : "Set"}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {repairPhotos.length > 0 ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {repairPhotos.map(({ image, sourceUrl }) => {
            const stage = (image.evidenceType ?? "") as Stage;
            return (
              <div key={image.id} className="overflow-hidden rounded-lg border border-[var(--line)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceUrl} alt={`${STAGE_LABEL[stage] ?? stage} photo`} className="h-40 w-full object-cover" />
                <div className="flex flex-wrap items-center gap-2 p-2.5">
                  <span className="rounded-full bg-[var(--panel-muted)] px-2 py-0.5 text-[11.5px] font-semibold">
                    {STAGE_LABEL[stage] ?? stage}
                  </span>
                  {editable ? (
                    <>
                      <label className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--muted)]">
                        <ArrowLeftRight size={13} />
                        <select
                          aria-label="Move to stage"
                          value={stage}
                          disabled={busy === image.id}
                          onChange={(event) => void movePhoto(image.id, event.target.value as Stage)}
                          className="h-8 rounded-[7px] border border-[var(--line-strong)] bg-white px-1.5 text-[12px]"
                        >
                          {STAGES.map((option) => (
                            <option key={option} value={option}>
                              {STAGE_LABEL[option]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={busy === image.id}
                        onClick={() => void removePhoto(image.id)}
                        className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-[var(--danger-border)] px-2 text-[12px] font-semibold text-[var(--danger-text)] disabled:opacity-60"
                        aria-label="Delete photo"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
