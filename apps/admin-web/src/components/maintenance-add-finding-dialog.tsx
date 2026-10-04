"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_LABEL,
  DialogFrame,
  ErrorBanner,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
} from "@/components/maintenance-packages-shared";
import { Tbtn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { addMaintenanceFinding, fetchFindingOptions } from "@/lib/maintenance-packages";
import type { FindingOptionsResponse, FindingPole } from "@/types/maintenance-packages";

/**
 * Add a Kejanggalan that was not in the survey (docs/PLAN-maintenance-flow.md
 * §13) — e.g. a pole that needs Rentis now. Needs a photo of the condition
 * (usually sent in by the crew). It goes to the pole's crew like any other
 * Kejanggalan, tagged "New finding".
 */

function poleLabel(pole: FindingPole) {
  return pole.noTiangLama ? `${pole.assetCode} (${pole.noTiangLama})` : pole.assetCode;
}

interface AddFindingDialogProps {
  token: string;
  siteVisitId: string;
  title: string;
  /** Pre-select a pole (e.g. opened from a pole row). */
  initialAssetId?: string;
  onClose: () => void;
  onAdded: (message: string) => void;
  onUnauthorized: () => void;
}

export function AddFindingDialog({
  token,
  siteVisitId,
  title,
  initialAssetId,
  onClose,
  onAdded,
  onUnauthorized,
}: AddFindingDialogProps) {
  const [options, setOptions] = useState<FindingOptionsResponse | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [poleQuery, setPoleQuery] = useState("");
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [templateItemId, setTemplateItemId] = useState("");
  const [optionValue, setOptionValue] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Latest callback without re-running the load when the parent re-renders.
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    let cancelled = false;
    fetchFindingOptions(token, siteVisitId)
      .then((response) => {
        if (!cancelled) setOptions(response);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) {
          onUnauthorizedRef.current();
          return;
        }
        setError(caught instanceof Error ? caught.message : "Could not load the poles.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, siteVisitId]);

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const filteredPoles = useMemo(() => {
    const poles = options?.poles ?? [];
    const query = poleQuery.trim().toLowerCase();
    if (!query) return poles;
    return poles.filter(
      (pole) =>
        pole.assetCode.toLowerCase().includes(query) ||
        (pole.noTiangLama ?? "").toLowerCase().includes(query) ||
        pole.assetId === assetId,
    );
  }, [options, poleQuery, assetId]);

  const pole = options?.poles.find((candidate) => candidate.assetId === assetId) ?? null;
  const items = useMemo(
    () => options?.findingTemplates.find((row) => row.templateId === pole?.templateId)?.items ?? [],
    [options, pole],
  );
  const item = items.find((candidate) => candidate.templateItemId === templateItemId) ?? null;

  // A pole change can drop the chosen item (another template).
  useEffect(() => {
    if (templateItemId && !items.some((candidate) => candidate.templateItemId === templateItemId)) {
      setTemplateItemId("");
      setOptionValue("");
    }
  }, [items, templateItemId]);

  const sections = useMemo(() => {
    const grouped = new Map<string, typeof items>();
    for (const candidate of items) {
      const key = candidate.section ?? "Checklist";
      grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
    }
    return [...grouped.entries()];
  }, [items]);

  const ready =
    Boolean(pole && item && photo) && (item?.options.length === 0 || Boolean(optionValue)) && !isSaving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pole || !item || !photo) return;
    setIsSaving(true);
    setError("");
    try {
      await addMaintenanceFinding(
        token,
        siteVisitId,
        {
          assetId: pole.assetId,
          templateItemId: item.templateItemId,
          optionValue: item.options.length > 0 ? optionValue : undefined,
          note,
        },
        photo,
      );
      onAdded(`Kejanggalan added on ${poleLabel(pole)} — ${item.label}. It is now in the crew's work.`);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onUnauthorized();
        return;
      }
      setError(caught instanceof Error ? caught.message : "Could not add the Kejanggalan.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DialogFrame
      eyebrow="New finding · not in survey"
      title={`Add Kejanggalan — ${title}`}
      subtitle="For a condition found after the survey (e.g. a pole that needs Rentis now). It goes to the pole's crew like any other Kejanggalan."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4 px-[18px] py-4">
        <ErrorBanner error={error} />
        {!options && !error ? (
          <p className="text-[13px] text-[var(--muted)]">Loading poles…</p>
        ) : null}
        {options && !options.canAdd ? (
          <p className="text-[13px] text-[var(--muted)]">
            You can view this Pencawang but not add Kejanggalan to it.
          </p>
        ) : null}

        {options?.canAdd ? (
          <>
            <div>
              <label className={modalLabelClass} htmlFor="finding-pole-search">
                Pole
              </label>
              <input
                id="finding-pole-search"
                className={modalInputClass}
                placeholder="Search NO TIANG / old number…"
                value={poleQuery}
                onChange={(event) => setPoleQuery(event.target.value)}
              />
              <select
                aria-label="Pole"
                className={modalSelectClass}
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                required
              >
                <option value="">Choose a pole… ({filteredPoles.length})</option>
                {filteredPoles.map((candidate) => (
                  <option key={candidate.assetId} value={candidate.assetId}>
                    {poleLabel(candidate)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={modalLabelClass} htmlFor="finding-item">
                Checklist item
              </label>
              <select
                id="finding-item"
                className={modalSelectClass}
                value={templateItemId}
                onChange={(event) => {
                  setTemplateItemId(event.target.value);
                  setOptionValue("");
                }}
                disabled={!pole}
                required
              >
                <option value="">{pole ? "Choose the item…" : "Choose a pole first"}</option>
                {sections.map(([section, sectionItems]) => (
                  <optgroup key={section} label={section}>
                    {sectionItems.map((candidate) => (
                      <option key={candidate.templateItemId} value={candidate.templateItemId}>
                        {candidate.label} · {CATEGORY_LABEL[candidate.category]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {item && item.options.length > 0 ? (
              <div>
                <label className={modalLabelClass} htmlFor="finding-option">
                  Which defect
                </label>
                <select
                  id="finding-option"
                  className={modalSelectClass}
                  value={optionValue}
                  onChange={(event) => setOptionValue(event.target.value)}
                  required
                >
                  <option value="">Choose…</option>
                  {item.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.severity}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className={modalLabelClass} htmlFor="finding-note">
                Note (optional)
              </label>
              <textarea
                id="finding-note"
                className={`${modalInputClass} min-h-[72px]`}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="What the crew found"
              />
            </div>

            <div>
              <label className={modalLabelClass} htmlFor="finding-photo">
                Photo of the condition (required)
              </label>
              <input
                id="finding-photo"
                type="file"
                accept="image/*"
                className="mt-1.5 block w-full text-[13px] text-[var(--foreground-soft)]"
                onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
                required
              />
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Condition photo preview"
                  className="mt-2 max-h-48 rounded-[var(--radius-control)] border border-[var(--line)] object-contain"
                />
              ) : null}
              <p className="mt-1 text-[12px] text-[var(--muted)]">
                Kept as the reported condition. The crew still takes its own stamped BEFORE and AFTER photos.
              </p>
            </div>
          </>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-[var(--line2)] pt-4">
          <Tbtn type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Tbtn>
          {options?.canAdd ? (
            <Tbtn type="submit" variant="primary" disabled={!ready}>
              {isSaving ? "Adding…" : "Add Kejanggalan"}
            </Tbtn>
          ) : null}
        </div>
      </form>
    </DialogFrame>
  );
}
