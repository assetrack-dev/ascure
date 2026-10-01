"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MapPinOff, SquareDashedMousePointer, Undo2, X } from "lucide-react";
import type { PackageMapPoint } from "@/components/maintenance-packages-map";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  DestinationSelect,
  ErrorBanner,
  LegendDot,
  checkboxClass,
  decodeDestination,
  modalInputClass,
  modalLabelClass,
  modalSelectClass,
  routingMessage,
} from "@/components/maintenance-packages-shared";
import { Chip, Eyebrow, IconBtn, Seg, Tbtn } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  assignPackagePoles,
  clearPackagePoles,
  fetchPackagePoles,
} from "@/lib/maintenance-packages";
import type {
  MaintenanceCategory,
  MaintenancePackageBoard,
  PackagePole,
  PackagePoleLane,
  PackagePolesResponse,
} from "@/types/maintenance-packages";

const MaintenancePackagesMap = dynamic(() => import("@/components/maintenance-packages-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
      Loading map…
    </div>
  ),
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** Owner colours on the satellite map — fixed hex, distinct from the status fills. */
const OWNER_PALETTE = ["#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#059669", "#4f46e5", "#be123c"];
const UNASSIGNED_COLOR = "#f59e0b";
const MIXED_COLOR = "#334155";
const DONE_COLOR = "#16a34a";

function laneKey(lane: PackagePoleLane) {
  return `${lane.organization?.id ?? ""}|${lane.team?.id ?? ""}`;
}

function laneOwnerLabel(lane: PackagePoleLane) {
  if (!lane.organization) return "Not assigned";
  return lane.team ? `${lane.organization.name} · ${lane.team.name}` : lane.organization.name;
}

/** One owner for the whole pole, "mixed" when its work types differ, or "done". */
function poleOwnerKey(pole: PackagePole) {
  if (pole.open === 0) return "done";
  const keys = new Set(pole.lanes.filter((lane) => lane.open > 0).map(laneKey));
  return keys.size === 1 ? [...keys][0] : "mixed";
}

function poleLabel(pole: PackagePole) {
  return pole.noTiangLama ? `${pole.assetCode} (${pole.noTiangLama})` : pole.assetCode;
}

interface PoleSplitDialogProps {
  token: string;
  siteVisitId: string;
  title: string;
  board: MaintenancePackageBoard;
  onClose: () => void;
  /** A split changed ownership — parent reloads the board and shows `message`. */
  onChanged: (message: string) => void;
  onUnauthorized: () => void;
}

/**
 * Split one Pencawang between crews pole by pole (docs/PLAN-maintenance-flow.md
 * §12.6): select poles on the map or in the list, give them (whole, or one work
 * type) to a company / team, or return them to the Pencawang's own owner.
 */
export function PoleSplitDialog({
  token,
  siteVisitId,
  title,
  board,
  onClose,
  onChanged,
  onUnauthorized,
}: PoleSplitDialogProps) {
  const [data, setData] = useState<PackagePolesResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [boxMode, setBoxMode] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [scope, setScope] = useState<"WHOLE" | "LANE">("WHOLE");
  const [category, setCategory] = useState<MaintenanceCategory>("SELENGGARAAN");
  const [destination, setDestination] = useState("");
  const [dueDate, setDueDate] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await fetchPackagePoles(token, siteVisitId);
      setData(next);
      const allowed = new Set(
        next.poles.filter((pole) => pole.lanes.some((lane) => lane.canAssign)).map((pole) => pole.assetId),
      );
      setSelected((current) => new Set([...current].filter((id) => allowed.has(id))));
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load poles.");
    }
  }, [onUnauthorized, siteVisitId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const allPoles = useMemo(() => data?.poles ?? [], [data]);
  // "One work type": show only the poles that carry it, each reduced to that
  // work type (its open count, its owner), so the map answers "which poles
  // have Rentis, and who has them?".
  const laneFilter = scope === "LANE" ? category : null;
  const polesByCategory = useMemo(
    () =>
      Object.fromEntries(
        CATEGORY_ORDER.map((cat) => [
          cat,
          allPoles.filter((pole) => pole.lanes.some((lane) => lane.category === cat)).length,
        ]),
      ) as Record<MaintenanceCategory, number>,
    [allPoles],
  );
  const poles = useMemo(() => {
    if (!laneFilter) return allPoles;
    return allPoles.flatMap((pole) => {
      const lane = pole.lanes.find((candidate) => candidate.category === laneFilter);
      return lane
        ? [{
            ...pole,
            lanes: [lane],
            total: lane.total,
            open: lane.open,
            canAssign: lane.canAssign,
            split: lane.source === "POLE",
          }]
        : [];
    });
  }, [allPoles, laneFilter]);

  // Switching to a work type no pole carries → jump to one that has poles.
  useEffect(() => {
    if (scope !== "LANE" || polesByCategory[category] > 0) return;
    const first = CATEGORY_ORDER.find((cat) => polesByCategory[cat] > 0);
    if (first) setCategory(first);
  }, [category, polesByCategory, scope]);

  const selectable = useMemo(
    () => new Set(poles.filter((pole) => pole.lanes.some((lane) => lane.canAssign)).map((pole) => pole.assetId)),
    [poles],
  );

  // A selected pole that doesn't carry the chosen work type drops out.
  useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((id) => selectable.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectable]);

  // Stable colour per owner, in order of first appearance.
  const owners = useMemo(() => {
    const byKey = new Map<string, { color: string; label: string; poles: number }>();
    let next = 0;
    for (const pole of poles) {
      const key = poleOwnerKey(pole);
      const existing = byKey.get(key);
      if (existing) {
        existing.poles += 1;
        continue;
      }
      const lane = pole.lanes.find((candidate) => candidate.open > 0) ?? pole.lanes[0];
      const entry =
        key === "done"
          ? { color: DONE_COLOR, label: "All done", poles: 1 }
          : key === "mixed"
            ? { color: MIXED_COLOR, label: "Work types split", poles: 1 }
            : key === "|"
              ? { color: UNASSIGNED_COLOR, label: "Not assigned", poles: 1 }
              : { color: OWNER_PALETTE[next++ % OWNER_PALETTE.length], label: laneOwnerLabel(lane), poles: 1 };
      byKey.set(key, entry);
    }
    return byKey;
  }, [poles]);

  const points: PackageMapPoint[] = useMemo(
    () =>
      poles
        .filter((pole) => pole.latitude !== null && pole.longitude !== null)
        .map((pole) => ({
          id: pole.assetId,
          latitude: pole.latitude as number,
          longitude: pole.longitude as number,
          openCount: pole.open,
          color: owners.get(poleOwnerKey(pole))?.color ?? MIXED_COLOR,
          selected: selected.has(pole.assetId),
          title:
            `${poleLabel(pole)} — ${pole.open} open · ` +
            pole.lanes.map((lane) => `${CATEGORY_LABEL[lane.category]}: ${laneOwnerLabel(lane)}`).join(" / "),
        })),
    [owners, poles, selected],
  );

  const selectedPoles = poles.filter((pole) => selected.has(pole.assetId));
  const selectedOpen = selectedPoles.reduce((sum, pole) => sum + pole.open, 0);
  const openByLane = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    open: selectedPoles.reduce(
      (sum, pole) => sum + (pole.lanes.find((lane) => lane.category === cat)?.open ?? 0),
      0,
    ),
  }));
  const decoded = decodeDestination(destination, board.teams);
  const anySplitSelected = selectedPoles.some((pole) => pole.split);
  const unlocated = poles.filter((pole) => pole.latitude === null || pole.longitude === null);

  const toggle = (id: string) => {
    if (!selectable.has(id)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = async (write: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      const message = await write();
      setSelected(new Set());
      await load();
      onChanged(message);
    } catch (writeError) {
      if (writeError instanceof ApiError && writeError.status === 401) {
        onUnauthorized();
        return;
      }
      setError(writeError instanceof Error ? writeError.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };

  const give = () =>
    decoded &&
    void run(async () => {
      const result = await assignPackagePoles(token, siteVisitId, {
        assetIds: [...selected],
        category: scope === "WHOLE" ? null : category,
        ...decoded,
        dueDate: dueDate || null,
        notes: null,
      });
      return `${result.poles} pole${result.poles === 1 ? "" : "s"} of ${title}: ${routingMessage(result.routing)}`;
    });

  const giveBack = () =>
    void run(async () => {
      const result = await clearPackagePoles(token, siteVisitId, {
        assetIds: [...selected],
        category: scope === "WHOLE" ? null : category,
      });
      return `Poles of ${title} returned to the Pencawang owner. ${routingMessage(result.routing)}`;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-3 py-4">
      <div className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line2)] px-[18px] py-3.5">
          <div className="min-w-0">
            <Eyebrow>Split by poles</Eyebrow>
            <h2
              className="mt-1 truncate text-[18px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
            <p className="mt-1 text-[12.5px] text-[var(--muted)]">
              Give some poles to another team so several crews work this Pencawang at once. Each pole
              keeps exactly one crew per work type.
            </p>
          </div>
          <IconBtn onClick={onClose} aria-label="Close pole split">
            <X size={16} />
          </IconBtn>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 border-b border-[var(--line2)] lg:border-b-0 lg:border-r">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line2)] px-3 py-2.5">
              {data?.canAssign ? (
                <Tbtn variant={boxMode ? "primary" : "secondary"} onClick={() => setBoxMode((on) => !on)}>
                  <SquareDashedMousePointer size={16} />
                  {boxMode ? "Box select on — drag on map" : "Box select"}
                </Tbtn>
              ) : null}
              {laneFilter ? (
                <span className="text-[12px] font-semibold text-[var(--brand)]">
                  {poles.length} of {allPoles.length} poles have {CATEGORY_LABEL[laneFilter]}
                </span>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {[...owners.values()].map((owner) => (
                  <LegendDot key={owner.label} color={owner.color} label={`${owner.label} (${owner.poles})`} />
                ))}
              </div>
            </div>
            <div className="h-[360px] lg:h-[460px]">
              {!data ? (
                <div className="flex h-full items-center justify-center text-[13px] text-[var(--muted)]">
                  Loading poles…
                </div>
              ) : GOOGLE_MAPS_API_KEY && !mapError && points.length > 0 ? (
                <MaintenancePackagesMap
                  apiKey={GOOGLE_MAPS_API_KEY}
                  points={points}
                  boxMode={boxMode}
                  onToggle={toggle}
                  onBoxSelect={(ids) =>
                    setSelected((current) => new Set([...current, ...ids.filter((id) => selectable.has(id))]))
                  }
                  onLoadError={() => setMapError(true)}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--muted)]">
                  {points.length === 0
                    ? "None of these poles has GPS — select them in the list below."
                    : "The map is unavailable right now — select poles in the list below."}
                </div>
              )}
            </div>

            <div className="max-h-[260px] overflow-y-auto border-t border-[var(--line2)]">
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {poles.map((pole) => (
                    <tr key={pole.assetId} className="border-b border-[var(--line2)] last:border-b-0">
                      <td className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${poleLabel(pole)}`}
                          className={checkboxClass}
                          checked={selected.has(pole.assetId)}
                          disabled={!selectable.has(pole.assetId)}
                          onChange={() => toggle(pole.assetId)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className="font-semibold text-[var(--foreground)]">{poleLabel(pole)}</span>
                        {pole.latitude === null ? (
                          <MapPinOff size={12} className="ml-1.5 inline text-[var(--muted)]" aria-label="No GPS" />
                        ) : null}
                        <span className="ml-2 text-[var(--muted)]">{pole.open} open</span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {pole.lanes.map((lane) => (
                            <Chip
                              key={lane.category}
                              tone={lane.organization ? (lane.source === "POLE" ? "brand" : "neutral") : "warning"}
                              title={lane.source === "POLE" ? "Split off this pole" : "Follows the Pencawang"}
                            >
                              {CATEGORY_LABEL[lane.category]} → {laneOwnerLabel(lane)}
                            </Chip>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unlocated.length > 0 ? (
                <p className="px-3 py-2 text-[11.5px] text-[var(--muted)]">
                  {unlocated.length} pole{unlocated.length === 1 ? "" : "s"} without GPS — only in this list.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4 p-[18px]">
            <ErrorBanner error={error} />
            <div>
              <Eyebrow>Selection</Eyebrow>
              <p
                className="mt-1 text-[22px] font-bold leading-tight text-[var(--foreground)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {selected.size} pole{selected.size === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--muted)]">{selectedOpen} open Kejanggalan</p>
              {selected.size > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {openByLane
                    .filter((lane) => lane.open > 0)
                    .map((lane) => (
                      <Chip key={lane.category} tone="neutral">
                        {CATEGORY_LABEL[lane.category]} {lane.open}
                      </Chip>
                    ))}
                </div>
              ) : (
                <p className="mt-2 text-[12.5px] text-[var(--muted)]">
                  Click poles on the map, drag a box, or tick them in the list.
                </p>
              )}
            </div>

            {data?.canAssign ? (
              <>
                <div>
                  <span className={modalLabelClass}>Work</span>
                  <div className="mt-1.5">
                    <Seg
                      aria-label="Pole scope"
                      options={[
                        { value: "WHOLE", label: "All work types" },
                        { value: "LANE", label: "One work type" },
                      ]}
                      value={scope}
                      onChange={setScope}
                    />
                  </div>
                  {scope === "LANE" ? (
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value as MaintenanceCategory)}
                      className={modalSelectClass}
                      aria-label="Work type"
                    >
                      {CATEGORY_ORDER.map((cat) => (
                        <option key={cat} value={cat} disabled={polesByCategory[cat] === 0}>
                          {CATEGORY_LABEL[cat]} — {polesByCategory[cat]} pole
                          {polesByCategory[cat] === 1 ? "" : "s"}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>

                <label className="block">
                  <span className={modalLabelClass}>Give to</span>
                  <DestinationSelect
                    companies={board.companies}
                    teams={board.teams}
                    value={destination}
                    onChange={setDestination}
                    className={modalSelectClass}
                  />
                </label>

                <label className="block">
                  <span className={modalLabelClass}>Target date</span>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    className={modalInputClass}
                  />
                </label>

                <p className="text-[11.5px] text-[var(--muted)]">
                  Kejanggalan the current crew has already photographed stay with them.
                </p>

                <div className="mt-auto flex flex-col gap-2">
                  <Tbtn variant="primary" onClick={give} disabled={busy || selected.size === 0 || !decoded}>
                    {busy ? "Saving…" : `Give ${selected.size || ""} pole${selected.size === 1 ? "" : "s"}`}
                  </Tbtn>
                  <Tbtn onClick={giveBack} disabled={busy || !anySplitSelected}>
                    <Undo2 size={16} />
                    Return to Pencawang owner
                  </Tbtn>
                </div>
              </>
            ) : (
              <p className="text-[12.5px] text-[var(--muted)]">View only.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
