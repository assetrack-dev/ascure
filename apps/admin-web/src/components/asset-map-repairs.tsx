"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Wrench } from "lucide-react";

import {
  EvidenceLightbox,
  buildEvidenceEntries,
  type EvidenceImageEntry,
} from "@/components/inspection-evidence-grid";
import { ApiError } from "@/lib/api";
import {
  REPAIR_STATE_COLOR,
  REPAIR_STATE_LABEL,
  fetchAssetRepairs,
  formatMaintenanceCategory,
  type PoleRepairItem,
} from "@/lib/map";

/** Repair photo stages, in order; older app builds carry no stage ("Other"). */
const STAGES = [
  { key: "FINDING", label: "Reported" },
  { key: "BEFORE", label: "Before" },
  { key: "DURING", label: "During" },
  { key: "AFTER", label: "After" },
  { key: "OTHER", label: "Other" },
] as const;

function stageOf(evidenceType: string | null) {
  const type = (evidenceType ?? "").toUpperCase();
  return STAGES.some((stage) => stage.key === type) ? type : "OTHER";
}

/**
 * The Asset Map panel's "Your repairs" section (repair view): the pole's
 * Kejanggalan routed to the caller's company — work type, who has it, repair
 * stage — with the crew's before / during / after photos.
 */
export function PoleRepairsSection({
  token,
  assetId,
  onUnauthorized,
}: {
  token: string | null;
  assetId: string;
  onUnauthorized: () => void;
}) {
  const [items, setItems] = useState<PoleRepairItem[] | null>(null);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<{ entries: EvidenceImageEntry[]; index: number; title: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!token) return;
    setItems(null);
    setError("");
    try {
      setItems(await fetchAssetRepairs(token, assetId));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : "Unable to load the repairs.");
    }
  }, [assetId, onUnauthorized, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = useMemo(
    () => (items ?? []).filter((item) => item.stage === "closed" || item.stage === "awaiting").length,
    [items],
  );

  return (
    <section className="border-b border-[var(--line)] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--foreground)]">
          <Wrench size={14} className="text-[var(--brand)]" />
          Your repairs
        </span>
        {items && items.length > 0 ? (
          <span className="text-[11px] text-[var(--muted)]">
            {done}/{items.length} repaired
          </span>
        ) : null}
      </div>

      {items === null ? (
        <p className="text-[12px] text-[var(--muted)]">Loading…</p>
      ) : error ? (
        <p className="text-[12px] text-[var(--critical-text)]">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">
          No Kejanggalan on this pole is your company&apos;s work.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => {
            const entries = buildEvidenceEntries(item.photos);
            const groups = STAGES.map((stage) => ({
              ...stage,
              entries: entries.filter((entry) => {
                const photo = item.photos.find((candidate) => candidate.id === entry.image.id);
                return stageOf(photo?.evidenceType ?? null) === stage.key;
              }),
            })).filter((group) => group.entries.length > 0);
            return (
              <li
                key={item.id}
                className="rounded-[10px] border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold leading-snug text-[var(--foreground)]">
                      {item.label}
                      {item.isEmergency && item.stage !== "closed" && item.stage !== "awaiting" ? (
                        <span className="ml-1 text-[var(--critical-text)]">⚠</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {formatMaintenanceCategory(item.category)}
                      {item.team ? ` · ${item.team.name}` : " · No team yet"}
                    </p>
                    {item.remark ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--foreground-soft)]">{item.remark}</p>
                    ) : null}
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--panel)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--foreground-soft)]"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: REPAIR_STATE_COLOR[item.stage] }}
                    />
                    {REPAIR_STATE_LABEL[item.stage].replace("All closed", "Closed")}
                  </span>
                </div>

                {groups.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {groups.map((group) => (
                      <div key={group.key} className="flex items-center gap-2">
                        <span className="w-[54px] shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--muted-2)]">
                          {group.label}
                        </span>
                        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
                          {group.entries.map((entry, index) => (
                            <button
                              key={entry.image.id ?? index}
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  entries: group.entries,
                                  index,
                                  title: `${item.label} · ${group.label}`,
                                })
                              }
                              className="h-12 w-12 shrink-0 overflow-hidden rounded-[6px] border border-[var(--line)] bg-[var(--panel)]"
                            >
                              <img
                                src={entry.sourceUrl}
                                alt={`${group.label} photo ${index + 1}`}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] text-[var(--muted)]">No repair photos yet.</p>
                )}

                <a
                  href={`/defects/${encodeURIComponent(item.id)}`}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand)] hover:underline"
                >
                  Open Kejanggalan
                  <ExternalLink size={11} />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {lightbox ? (
        <EvidenceLightbox
          entries={lightbox.entries}
          index={lightbox.index}
          titlePrefix={lightbox.title}
          onIndexChange={(index) => setLightbox((current) => (current ? { ...current, index } : current))}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}
