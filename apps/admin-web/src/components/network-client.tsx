"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Download, GitBranch, Map as MapIcon, Plus, RefreshCw, X, Zap, ZapOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import { downloadSchematicPdf, fetchReportSubstations } from "@/lib/reports";
import {
  createTieEdge,
  fetchFeederIsolation,
  fetchSubstationNetwork,
  setTieEdgeState,
  type FeederIsolation,
  type SubstationNetwork,
} from "@/lib/network";
import type { AuthSession } from "@/types/auth";
import type { ReportSubstation } from "@/types/reports";

const NetworkMap = dynamic(() => import("@/components/network-map"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--muted)]">Loading map…</p>,
});

const COL_W = 150;
const ROW_H = 64;
const PAD = 48;
const FEEDER_COLORS = [
  "#0F766E",
  "#2563EB",
  "#9333EA",
  "#C026D3",
  "#0891B2",
  "#CA8A04",
  "#DC2626",
  "#65A30D",
];

const inputClassName =
  "h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-[var(--shadow-soft)] outline-none transition focus:border-[var(--brand)] focus:ring-4 focus:ring-teal-100";
const secondaryButtonClassName =
  "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";

function feederColor(code: string, feeders: { code: string }[]) {
  const index = feeders.findIndex((feeder) => feeder.code === code);
  return FEEDER_COLORS[(index < 0 ? 0 : index) % FEEDER_COLORS.length];
}

function viewTabClass(active: boolean) {
  return `inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-semibold transition ${
    active ? "bg-[var(--brand)] text-white" : "text-slate-600 hover:text-[var(--brand)]"
  }`;
}

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function NetworkContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [substations, setSubstations] = useState<ReportSubstation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [network, setNetwork] = useState<SubstationNetwork | null>(null);
  const [isolation, setIsolation] = useState<FeederIsolation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingNetwork, setIsLoadingNetwork] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"schematic" | "map">("schematic");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [isMutating, setIsMutating] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const canReport =
    session?.user?.canReport === true || session?.user?.role === "ADMIN";

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadSubstations = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        const [refreshed, subs] = await Promise.all([
          refreshStoredSessionUser(token).catch(() => null),
          fetchReportSubstations(token),
        ]);
        if (refreshed) {
          setSession({ token, user: refreshed });
        }
        setSubstations(subs);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load the Pencawang list."));
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout],
  );

  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (!stored?.token) {
      setIsLoading(false);
      return;
    }
    void loadSubstations(stored.token);
  }, [loadSubstations]);

  const loadNetwork = useCallback(
    async (substationId: string) => {
      if (!session?.token || !substationId) {
        setNetwork(null);
        return;
      }
      setIsLoadingNetwork(true);
      setError("");
      setIsolation(null);
      try {
        setNetwork(await fetchSubstationNetwork(session.token, substationId));
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load the network."));
        setNetwork(null);
      } finally {
        setIsLoadingNetwork(false);
      }
    },
    [session?.token, handleLogout],
  );

  const handleIsolate = useCallback(
    async (feederId: string) => {
      if (!session?.token) {
        return;
      }
      try {
        setIsolation(await fetchFeederIsolation(session.token, feederId));
      } catch (isolateError) {
        setError(requestErrorMessage(isolateError, "Unable to compute isolation."));
      }
    },
    [session?.token],
  );

  const handleAddTie = useCallback(async () => {
    if (!session?.token || !selectedId || !newFrom || !newTo || newFrom === newTo) {
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      await createTieEdge(session.token, { fromAssetId: newFrom, toAssetId: newTo });
      setNewFrom("");
      setNewTo("");
      await loadNetwork(selectedId);
    } catch (mutateError) {
      setError(requestErrorMessage(mutateError, "Unable to add the NOP tie."));
    } finally {
      setIsMutating(false);
    }
  }, [session?.token, selectedId, newFrom, newTo, loadNetwork]);

  const handleToggleTie = useCallback(
    async (id: string, current: string) => {
      if (!session?.token || !selectedId) {
        return;
      }
      setIsMutating(true);
      setError("");
      try {
        await setTieEdgeState(session.token, id, current === "OPEN" ? "CLOSED" : "OPEN");
        await loadNetwork(selectedId);
      } catch (mutateError) {
        setError(requestErrorMessage(mutateError, "Unable to switch the NOP."));
      } finally {
        setIsMutating(false);
      }
    },
    [session?.token, selectedId, loadNetwork],
  );

  const handleDownloadSchematic = useCallback(async () => {
    if (!session?.token || !selectedId) {
      return;
    }
    const substation = substations.find((item) => item.id === selectedId);
    if (!substation) {
      return;
    }
    setIsDownloadingPdf(true);
    setError("");
    try {
      // Pass the isolated feeder (if any) so the PDF matches what's on screen.
      await downloadSchematicPdf(
        session.token,
        { id: substation.id, code: substation.code },
        isolation?.feeder.id,
      );
    } catch (downloadError) {
      setError(requestErrorMessage(downloadError, "Unable to download the schematic PDF."));
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [session?.token, selectedId, substations, isolation]);

  // Tidy left-to-right tree layout from the radial (fed-from) edges: x = depth,
  // y = in-order leaf position (parents centred over their children).
  const layout = useMemo(() => {
    if (!network) {
      return null;
    }
    const children = new Map<string, string[]>();
    const hasParent = new Set<string>();
    for (const edge of network.edges.radial) {
      const existing = children.get(edge.from);
      if (existing) {
        existing.push(edge.to);
      } else {
        children.set(edge.from, [edge.to]);
      }
      hasParent.add(edge.to);
    }

    const depth = new Map<string, number>();
    const yPos = new Map<string, number>();
    let leaf = 0;
    const visit = (id: string, d: number) => {
      if (depth.has(id)) {
        return;
      }
      depth.set(id, d);
      const kids = children.get(id) ?? [];
      if (kids.length === 0) {
        yPos.set(id, leaf++);
        return;
      }
      for (const kid of kids) {
        visit(kid, d + 1);
      }
      const ys = kids.map((kid) => yPos.get(kid) ?? 0);
      yPos.set(id, (Math.min(...ys) + Math.max(...ys)) / 2);
    };
    for (const pole of network.poles) {
      if (!hasParent.has(pole.id)) {
        visit(pole.id, 0);
      }
    }
    for (const pole of network.poles) {
      if (!depth.has(pole.id)) {
        depth.set(pole.id, 0);
        yPos.set(pole.id, leaf++);
      }
    }

    const positions = new Map(
      network.poles.map((pole) => [
        pole.id,
        {
          x: PAD + (depth.get(pole.id) ?? 0) * COL_W,
          y: PAD + (yPos.get(pole.id) ?? 0) * ROW_H,
        },
      ]),
    );
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    return {
      positions,
      width: (xs.length ? Math.max(...xs) : PAD) + COL_W,
      height: (ys.length ? Math.max(...ys) : PAD) + PAD,
    };
  }, [network]);

  const deEnergizedIds = useMemo(
    () => new Set(isolation?.deEnergized.map((pole) => pole.id) ?? []),
    [isolation],
  );
  const backfeedEdgeIds = useMemo(
    () => new Set(isolation?.backfeed.map((b) => b.tieEdgeId) ?? []),
    [isolation],
  );
  const poleLabelById = useMemo(
    () => new Map(network?.poles.map((pole) => [pole.id, pole.noTiangRondaan]) ?? []),
    [network],
  );

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">Network</p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">
                Network Graph &amp; Isolation
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                The feeder topology for a Pencawang, rendered from the persisted graph. Click a
                feeder to isolate it — de-energized poles turn red and back-feed points (NOPs) are
                flagged.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReport && network ? (
                <button
                  type="button"
                  onClick={handleDownloadSchematic}
                  disabled={isDownloadingPdf}
                  className={secondaryButtonClassName}
                  title={
                    isolation
                      ? `Export the schematic with feeder ${isolation.feeder.code} isolated`
                      : "Export the network schematic as a PDF"
                  }
                >
                  <Download size={16} className={isDownloadingPdf ? "animate-pulse" : ""} />
                  {isolation ? "Schematic PDF (isolation)" : "Schematic PDF"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => (selectedId ? loadNetwork(selectedId) : undefined)}
                disabled={!selectedId || isLoadingNetwork}
                className={secondaryButtonClassName}
              >
                <RefreshCw size={16} className={isLoadingNetwork ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-6 max-w-md">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Pencawang</span>
              <select
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  void loadNetwork(event.target.value);
                }}
                disabled={isLoading || substations.length === 0}
                className={`${inputClassName} mt-1.5`}
              >
                <option value="">
                  {isLoading
                    ? "Loading…"
                    : substations.length === 0
                      ? "No Pencawang available"
                      : "Select a Pencawang"}
                </option>
                {substations.map((substation) => (
                  <option key={substation.id} value={substation.id}>
                    {substation.code} - {substation.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {network ? (
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                <div className="inline-flex gap-0.5 rounded-md border border-slate-300 bg-white p-0.5 shadow-[var(--shadow-soft)]">
                  <button
                    type="button"
                    onClick={() => setView("schematic")}
                    className={viewTabClass(view === "schematic")}
                  >
                    <GitBranch size={15} /> Schematic
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("map")}
                    className={viewTabClass(view === "map")}
                  >
                    <MapIcon size={15} /> Map
                  </button>
                </div>
                <section className="overflow-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 shadow-[var(--shadow-card)]">
                {view === "map" ? (
                  <NetworkMap
                    network={network}
                    deEnergizedIds={deEnergizedIds}
                    backfeedEdgeIds={backfeedEdgeIds}
                    colorForFeeder={(code) => feederColor(code, network.feeders)}
                  />
                ) : layout && network.poles.length > 0 ? (
                  <svg
                    width={layout.width}
                    height={layout.height}
                    role="img"
                    aria-label={`Network schematic for ${network.substation.code}`}
                  >
                    {network.edges.radial.map((edge) => {
                      const a = layout.positions.get(edge.from);
                      const b = layout.positions.get(edge.to);
                      if (!a || !b) return null;
                      return (
                        <line
                          key={`r-${edge.from}-${edge.to}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="#94A3B8"
                          strokeWidth={2}
                        />
                      );
                    })}
                    {network.edges.tie.map((edge) => {
                      const a = layout.positions.get(edge.from);
                      const b = layout.positions.get(edge.to);
                      if (!a || !b) return null;
                      const lit = backfeedEdgeIds.has(edge.id);
                      return (
                        <line
                          key={`t-${edge.id}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke={lit ? "#F59E0B" : "#CBD5E1"}
                          strokeWidth={lit ? 3 : 2}
                          strokeDasharray="6 5"
                        />
                      );
                    })}
                    {network.poles.map((pole) => {
                      const pos = layout.positions.get(pole.id);
                      if (!pos) return null;
                      const dead = deEnergizedIds.has(pole.id);
                      const color = dead
                        ? "#DC2626"
                        : feederColor(pole.feeders[0] ?? "", network.feeders);
                      return (
                        <g key={pole.id}>
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={8}
                            fill={color}
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                          <text
                            x={pos.x + 13}
                            y={pos.y + 4}
                            fontSize={12}
                            fill={dead ? "#DC2626" : "#0F172A"}
                            fontWeight={dead ? 700 : 500}
                          >
                            {pole.noTiangRondaan}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <p className="p-6 text-sm text-[var(--muted)]">
                    No poles with graph structure yet for this Pencawang. Run the backfill, or
                    capture poles via the mobile app.
                  </p>
                )}
                </section>
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-card)]">
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Feeders — click to isolate
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {network.feeders.map((feeder) => (
                      <button
                        key={feeder.id}
                        type="button"
                        onClick={() => handleIsolate(feeder.id)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: feederColor(feeder.code, network.feeders) }}
                        />
                        {feeder.code}
                      </button>
                    ))}
                    {network.feeders.length === 0 ? (
                      <span className="text-sm text-[var(--muted)]">No feeders.</span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                    <span>{network.poles.length} poles</span>
                    <span>{network.edges.radial.length} spans</span>
                    <span>{network.edges.tie.length} NOP ties</span>
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-card)]">
                  <p className="text-xs font-semibold uppercase text-slate-500">NOP ties</p>
                  {network.edges.tie.length === 0 ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">None yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {network.edges.tie.map((tie) => (
                        <li key={tie.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate text-slate-700">
                            {poleLabelById.get(tie.from) ?? "?"} ↔ {poleLabelById.get(tie.to) ?? "?"}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleToggleTie(tie.id, tie.switchState)}
                            disabled={isMutating}
                            className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold ${
                              tie.switchState === "CLOSED"
                                ? "bg-green-100 text-green-700"
                                : "bg-slate-100 text-slate-600"
                            } disabled:opacity-50`}
                          >
                            {tie.switchState}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    <p className="text-xs font-semibold uppercase text-slate-500">Add NOP</p>
                    <select
                      value={newFrom}
                      onChange={(event) => setNewFrom(event.target.value)}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                    >
                      <option value="">From pole…</option>
                      {network.poles.map((pole) => (
                        <option key={pole.id} value={pole.id}>
                          {pole.noTiangRondaan}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newTo}
                      onChange={(event) => setNewTo(event.target.value)}
                      className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm"
                    >
                      <option value="">To pole…</option>
                      {network.poles.map((pole) => (
                        <option key={pole.id} value={pole.id}>
                          {pole.noTiangRondaan}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddTie}
                      disabled={isMutating || !newFrom || !newTo || newFrom === newTo}
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--brand)] text-sm font-semibold text-white transition hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Plus size={15} /> Add NOP tie
                    </button>
                  </div>
                </div>

                {isolation ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-[var(--shadow-card)]">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
                        <ZapOff size={16} /> Feeder {isolation.feeder.code} open
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsolation(null)}
                        className="text-amber-700 transition hover:text-amber-900"
                        aria-label="Clear isolation"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-amber-900">
                      <strong>{isolation.deEnergizedCount}</strong> pole
                      {isolation.deEnergizedCount === 1 ? "" : "s"} de-energized.
                    </p>
                    <p className="mt-3 text-xs font-semibold uppercase text-amber-800">
                      Back-feed options
                    </p>
                    {isolation.backfeed.length === 0 ? (
                      <p className="mt-1 text-sm text-amber-800">
                        None — no NOP ties to a still-energized feeder.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1.5">
                        {isolation.backfeed.map((option) => (
                          <li
                            key={option.tieEdgeId}
                            className="flex items-start gap-1.5 text-sm text-amber-900"
                          >
                            <Zap size={14} className="mt-0.5 shrink-0" />
                            <span>
                              Close NOP ({option.switchState}) → re-feed{" "}
                              <strong>{option.deEnergizedPole.noTiangRondaan}</strong> from{" "}
                              <strong>{option.sourcePole.noTiangRondaan}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </aside>
            </div>
          ) : isLoadingNetwork ? (
            <p className="mt-6 text-sm text-[var(--muted)]">Loading network…</p>
          ) : selectedId ? null : (
            <p className="mt-6 text-sm text-[var(--muted)]">Select a Pencawang to view its network.</p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export function NetworkClient() {
  return (
    <AuthGuard>
      <NetworkContent />
    </AuthGuard>
  );
}
