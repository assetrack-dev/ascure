"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Filter as FilterIcon,
  ListOrdered,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Crosshair,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
import { Eyebrow, Seg, Tbtn, type SegOption } from "@/components/ui";
import type { AssetMapProps, MapControls } from "@/components/asset-map-shared";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  fetchMapAssets,
  formatMaintenanceCategory,
  isMapAssetInspected,
  mapAssetDefectState,
  mapAssetMarkerColor,
  mapAssetPriority,
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  MONITORING_DEFECT_MARKER_COLOR,
  NO_DEFECT_MARKER_COLOR,
  UNINSPECTED_DEFECT_MARKER_COLOR,
  type MapAsset,
  type MapColorMode,
  type MapViewMode,
} from "@/lib/map";
import { roleLabel } from "@/lib/roles";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from "@/types/defects";
import type { AuthSession } from "@/types/auth";

function backLabel(href: string) {
  if (href.startsWith("/maintenance-workspace")) return "Maintenance";
  if (href.startsWith("/site-visits")) return "Operations Detail";
  if (href.startsWith("/defects")) return "Defects";
  return "Back";
}

const GoogleAssetMap = dynamic(() => import("@/components/google-asset-map"), {
  ssr: false,
  loading: () => <MapStageLoading />,
});
const GlobalAssetMap = dynamic(() => import("@/components/global-asset-map"), {
  ssr: false,
  loading: () => <MapStageLoading />,
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const UNASSIGNED = "__none__";

const VIEW_OPTIONS: SegOption<MapViewMode>[] = [
  { value: "pins", label: "Pins" },
  { value: "clusters", label: "Clusters" },
  { value: "heat", label: "Heat" },
];
const COLOR_OPTIONS: SegOption<MapColorMode>[] = [
  { value: "inspection", label: "Inspection" },
  { value: "defect", label: "Defects" },
];
type InspectedFilter = "all" | "inspected" | "not";
const INSPECTED_OPTIONS: SegOption<InspectedFilter>[] = [
  { value: "all", label: "All" },
  { value: "inspected", label: "Inspected" },
  { value: "not", label: "Not" },
];

type Option = { value: string; label: string; count: number };

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function MapStageLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--panel-muted)] text-[13px] text-[var(--muted)]">
      Loading map…
    </div>
  );
}

function buildOptions(
  assets: MapAsset[],
  pick: (a: MapAsset) => { id: string; label: string } | null,
): Option[] {
  const map = new Map<string, Option>();
  let unassigned = 0;
  for (const asset of assets) {
    const got = pick(asset);
    if (!got) {
      unassigned += 1;
      continue;
    }
    const existing = map.get(got.id);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(got.id, { value: got.id, label: got.label, count: 1 });
    }
  }
  const options = Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" }),
  );
  if (unassigned > 0) {
    options.push({ value: UNASSIGNED, label: "Unassigned", count: unassigned });
  }
  return options;
}

/** A collapsible checkbox filter group inside the left dock. */
function FilterGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-[var(--chrome-line)] px-3.5 py-3">
      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-faint)]">
        {label}
        {selected.size > 0 ? ` · ${selected.size}` : ""}
      </p>
      <div className="space-y-0.5">
        {options.map((opt) => {
          const on = selected.has(opt.value);
          return (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded-[7px] px-1.5 py-1 text-[12.5px] transition hover:bg-[var(--chrome-active)]"
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  on
                    ? "border-[var(--chrome-accent)] bg-[var(--chrome-accent)]"
                    : "border-[var(--chrome-line-strong)]"
                }`}
              >
                {on ? <span className="text-[10px] font-bold text-white">✓</span> : null}
              </span>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(opt.value)}
                className="sr-only"
              />
              <span className="truncate text-[var(--on-chrome)]" title={opt.label}>
                {opt.label}
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-[var(--on-chrome-faint)]">
                {opt.count}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** A legend row — the dot colour is a concrete marker hex, not a token. */
function LegendRow({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ backgroundColor: color }} />
      <span className="text-[var(--foreground-soft)]">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-[var(--muted)]">{count}</span>
    </div>
  );
}

function KpiTile({ label, value, alarm = false }: { label: string; value: string | number; alarm?: boolean }) {
  return (
    <div
      className={`min-w-[92px] rounded-[10px] border px-3 py-2 ${
        alarm ? "border-[var(--critical-border)] bg-[var(--danger-tint)]" : "border-[var(--line)] bg-[var(--panel)]"
      }`}
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">{label}</p>
      <p
        className={`mt-0.5 text-[20px] font-bold leading-none tabular-nums ${alarm ? "text-[var(--critical)]" : "text-[var(--foreground)]"}`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
    </div>
  );
}

function MapContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [googleFailed, setGoogleFailed] = useState(false);

  const [subSel, setSubSel] = useState<Set<string>>(new Set());
  const [typeSel, setTypeSel] = useState<Set<string>>(new Set());
  const [mainSel, setMainSel] = useState<Set<string>>(new Set());
  const [teamSel, setTeamSel] = useState<Set<string>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [catSel, setCatSel] = useState<Set<string>>(new Set());
  const [inspectedSel, setInspectedSel] = useState<InspectedFilter>("all");
  const [colorMode, setColorMode] = useState<MapColorMode>("inspection");
  const [viewMode, setViewMode] = useState<MapViewMode>("clusters");
  const [defectsOnly, setDefectsOnly] = useState(false);
  const [backHref, setBackHref] = useState<string | null>(null);

  // Lifted map state.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const controlsRef = useRef<MapControls | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const substationId = params.get("substationId");
    if (substationId) {
      setSubSel(new Set([substationId]));
    }
    if (params.get("defectsOnly") === "1") {
      setDefectsOnly(true);
      setColorMode("defect");
    }
    const from = params.get("from");
    if (from && from.startsWith("/") && !from.startsWith("//")) {
      setBackHref(from);
    }
  }, []);

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  const loadAssets = useCallback(
    async (token: string) => {
      setIsLoading(true);
      setError("");
      try {
        const [refreshed, mapAssets] = await Promise.all([
          refreshStoredSessionUser(token).catch(() => null),
          fetchMapAssets(token),
        ]);
        if (refreshed) {
          setSession({ token, user: refreshed });
        }
        setAssets(mapAssets);
      } catch (loadError) {
        if (loadError instanceof ApiError && loadError.status === 401) {
          handleLogout();
          return;
        }
        setError(requestErrorMessage(loadError, "Unable to load the asset map."));
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
    void loadAssets(stored.token);
  }, [loadAssets]);

  const token = session?.token ?? null;

  const subOptions = useMemo(
    () => buildOptions(assets, (a) => (a.substation ? { id: a.substation.id, label: a.substation.name || a.substation.code } : null)),
    [assets],
  );
  const typeOptions = useMemo(
    () => buildOptions(assets, (a) => (a.assetType ? { id: a.assetType.id, label: a.assetType.name } : null)),
    [assets],
  );
  const mainOptions = useMemo(
    () => buildOptions(assets, (a) => (a.mainhead ? { id: a.mainhead.id, label: a.mainhead.name } : null)),
    [assets],
  );
  const teamOptions = useMemo(
    () => buildOptions(assets, (a) => (a.team ? { id: a.team.id, label: a.team.name } : null)),
    [assets],
  );
  const statusOptions = useMemo(
    () => buildOptions(assets, (a) => ({ id: a.status, label: a.status })),
    [assets],
  );
  const categoryOptions = useMemo<Option[]>(() => {
    const counts = new Map<MaintenanceCategory, number>();
    for (const asset of assets) {
      for (const category of asset.defectCategories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return MAINTENANCE_CATEGORIES.filter((category) => counts.has(category)).map((category) => ({
      value: category,
      label: formatMaintenanceCategory(category),
      count: counts.get(category) ?? 0,
    }));
  }, [assets]);

  useEffect(() => {
    if (assets.length === 0) {
      return;
    }
    const prune = (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>,
      options: Option[],
    ) => {
      const valid = new Set(options.map((o) => o.value));
      setter((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const value of prev) {
          if (valid.has(value)) next.add(value);
          else changed = true;
        }
        return changed ? next : prev;
      });
    };
    prune(setSubSel, subOptions);
    prune(setTypeSel, typeOptions);
    prune(setMainSel, mainOptions);
    prune(setTeamSel, teamOptions);
    prune(setStatusSel, statusOptions);
    prune(setCatSel, categoryOptions);
  }, [assets.length, subOptions, typeOptions, mainOptions, teamOptions, statusOptions, categoryOptions]);

  const filtered = useMemo(() => {
    const matchesSet = (set: Set<string>, value: string | null) =>
      set.size === 0 || set.has(value ?? UNASSIGNED);
    return assets.filter((a) => {
      if (defectsOnly && a.openDefectCount <= 0) return false;
      if (!matchesSet(subSel, a.substation?.id ?? null)) return false;
      if (!matchesSet(typeSel, a.assetType?.id ?? null)) return false;
      if (!matchesSet(mainSel, a.mainhead?.id ?? null)) return false;
      if (!matchesSet(teamSel, a.team?.id ?? null)) return false;
      if (!matchesSet(statusSel, a.status)) return false;
      if (catSel.size > 0 && !a.defectCategories.some((c) => catSel.has(c))) return false;
      if (inspectedSel !== "all") {
        const inspected = isMapAssetInspected(a);
        if (inspectedSel === "inspected" && !inspected) return false;
        if (inspectedSel === "not" && inspected) return false;
      }
      return true;
    });
  }, [assets, defectsOnly, subSel, typeSel, mainSel, teamSel, statusSel, catSel, inspectedSel]);

  // "In view" = filtered assets inside the current viewport. Before the map
  // reports bounds (empty set), treat everything filtered as in view.
  const inView = useMemo(() => {
    if (visibleIds.size === 0) return filtered;
    return filtered.filter((a) => visibleIds.has(a.id));
  }, [filtered, visibleIds]);

  const counts = useMemo(() => {
    let inspected = 0;
    let emergency = 0;
    let defect = 0;
    let monitoring = 0;
    let clean = 0;
    let uninspected = 0;
    let openDefects = 0;
    for (const asset of inView) {
      if (isMapAssetInspected(asset)) inspected += 1;
      if (asset.openDefectCount > 0) openDefects += 1;
      switch (mapAssetDefectState(asset)) {
        case "emergency": emergency += 1; break;
        case "defect": defect += 1; break;
        case "monitoring": monitoring += 1; break;
        case "clean": clean += 1; break;
        default: uninspected += 1;
      }
    }
    const total = inView.length;
    return {
      total,
      inspected,
      notInspected: total - inspected,
      inspectedPct: total > 0 ? Math.round((inspected / total) * 100) : 0,
      emergency,
      defect,
      monitoring,
      clean,
      uninspected,
      openDefects,
    };
  }, [inView]);

  const priorityList = useMemo(
    () => [...inView].sort((a, b) => mapAssetPriority(b) - mapAssetPriority(a)),
    [inView],
  );

  const hasActiveFilters =
    subSel.size > 0 || typeSel.size > 0 || mainSel.size > 0 || teamSel.size > 0 ||
    statusSel.size > 0 || catSel.size > 0 || inspectedSel !== "all" || defectsOnly;
  const activeFilterCount =
    subSel.size + typeSel.size + mainSel.size + teamSel.size + statusSel.size + catSel.size +
    (inspectedSel !== "all" ? 1 : 0) + (defectsOnly ? 1 : 0);

  const resetFilters = useCallback(() => {
    setSubSel(new Set());
    setTypeSel(new Set());
    setMainSel(new Set());
    setTeamSel(new Set());
    setStatusSel(new Set());
    setCatSel(new Set());
    setInspectedSel("all");
    setDefectsOnly(false);
  }, []);

  const toggle = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (value: string) => {
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    },
    [],
  );

  const onVisibleChange = useCallback((ids: string[]) => setVisibleIds(new Set(ids)), []);

  const useGoogle = Boolean(GOOGLE_MAPS_API_KEY) && !googleFailed;
  const rendererProps: AssetMapProps = {
    assets: filtered,
    colorMode,
    viewMode,
    selectedId,
    onSelect: setSelectedId,
    onVisibleChange,
    controlsRef,
  };

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="flex h-[calc(100dvh-64px)] min-h-[520px] flex-col">
        {/* Slim header with KPI tiles */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-[30px] py-3">
          <div className="min-w-0">
            {backHref ? (
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--muted)] transition hover:text-[var(--brand)]"
              >
                <ArrowLeft size={14} />
                Back to {backLabel(backHref)}
              </button>
            ) : (
              <Eyebrow>Map</Eyebrow>
            )}
            <div className="flex items-center gap-3">
              <h1 className="text-[20px] font-bold leading-tight text-[var(--foreground)]" style={{ fontFamily: "var(--font-display)" }}>
                Asset Map
              </h1>
              {defectsOnly ? (
                <button
                  type="button"
                  onClick={() => setDefectsOnly(false)}
                  title="Show every pole, not just those carrying an open defect"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--medium-border)] bg-[var(--medium-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--medium-text)]"
                >
                  Defect poles only
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <KpiTile label="In view" value={counts.total} />
            <KpiTile label="Inspected" value={`${counts.inspectedPct}%`} />
            <KpiTile label="Open defects" value={counts.openDefects} />
            <KpiTile label="Emergency" value={counts.emergency} alarm={counts.emergency > 0} />
            <Tbtn onClick={() => (token ? loadAssets(token) : undefined)} disabled={!token || isLoading} className="ml-1">
              <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              Refresh
            </Tbtn>
          </div>
        </header>

        {error ? (
          <div className="shrink-0 border-b border-[var(--critical-border)] bg-[var(--critical-bg)] px-[30px] py-2 text-[13px] text-[var(--critical-text)]">
            {error}
          </div>
        ) : null}
        {GOOGLE_MAPS_API_KEY && googleFailed ? (
          <div className="shrink-0 border-b border-[var(--medium-border)] bg-[var(--medium-bg)] px-[30px] py-2 text-[13px] text-[var(--medium-text)]">
            Google Maps could not load (the key may be restricted or the Maps JavaScript API isn&apos;t enabled). Showing the OpenStreetMap fallback.
          </div>
        ) : null}

        {/* Map stage */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--panel-muted)]">
          {isLoading && assets.length === 0 ? (
            <MapStageLoading />
          ) : assets.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[var(--muted)]">
              No located assets in your scope yet. Assets appear here once they have GPS coordinates and belong to a site visit you can see.
            </div>
          ) : (
            <>
              {useGoogle ? (
                <GoogleAssetMap {...rendererProps} apiKey={GOOGLE_MAPS_API_KEY} onLoadError={() => setGoogleFailed(true)} />
              ) : (
                <GlobalAssetMap {...rendererProps} />
              )}

              {/* View-mode control — top-left, inset past the collapsed handle */}
              <div className="pointer-events-auto absolute left-[46px] top-3 z-10">
                <Seg options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} aria-label="Map view mode" className="shadow-[var(--shadow-card)]" />
              </div>
              {/* Colour-by control — top-right, inset past the right handle */}
              <div className="pointer-events-auto absolute right-[46px] top-3 z-10">
                <Seg options={COLOR_OPTIONS} value={colorMode} onChange={setColorMode} aria-label="Colour markers by" className="shadow-[var(--shadow-card)]" />
              </div>

              {/* Legend card — bottom-left, inset */}
              <div className="pointer-events-none absolute bottom-3 left-[46px] z-10 w-52 rounded-[12px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_86%,transparent)] p-3 shadow-[var(--shadow-card)] backdrop-blur">
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
                  {colorMode === "inspection" ? "Inspection status" : "Defect state"}
                </p>
                <div className="space-y-1.5">
                  {colorMode === "inspection" ? (
                    <>
                      <LegendRow color={INSPECTED_MARKER_COLOR} label="Inspected" count={counts.inspected} />
                      <LegendRow color={NOT_INSPECTED_MARKER_COLOR} label="Not inspected" count={counts.notInspected} />
                    </>
                  ) : (
                    <>
                      <LegendRow color={EMERGENCY_DEFECT_MARKER_COLOR} label="Emergency" count={counts.emergency} />
                      <LegendRow color={OPEN_DEFECT_MARKER_COLOR} label="Open defect" count={counts.defect} />
                      <LegendRow color={MONITORING_DEFECT_MARKER_COLOR} label="Monitoring" count={counts.monitoring} />
                      <LegendRow color={NO_DEFECT_MARKER_COLOR} label="Clean" count={counts.clean} />
                      <LegendRow color={UNINSPECTED_DEFECT_MARKER_COLOR} label="Not inspected" count={counts.uninspected} />
                    </>
                  )}
                </div>
              </div>

              {/* Zoom box — bottom-right, inset */}
              <div className="absolute bottom-3 right-[46px] z-10 flex flex-col overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
                <button type="button" aria-label="Zoom in" onClick={() => controlsRef.current?.zoomIn()} className="flex h-9 w-9 items-center justify-center text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]">
                  <Plus size={16} />
                </button>
                <button type="button" aria-label="Zoom out" onClick={() => controlsRef.current?.zoomOut()} className="flex h-9 w-9 items-center justify-center border-t border-[var(--line2)] text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]">
                  <Minus size={16} />
                </button>
                <button type="button" aria-label="Recenter" onClick={() => controlsRef.current?.recenter()} className="flex h-9 w-9 items-center justify-center border-t border-[var(--line2)] text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]">
                  <Crosshair size={15} />
                </button>
              </div>

              {/* LEFT auto-hide dock — filters */}
              <div className="group absolute bottom-0 left-0 top-0 z-20 flex -translate-x-[250px] transition-transform duration-300 [transition-timing-function:cubic-bezier(.4,0,.2,1)] focus-within:translate-x-0 hover:translate-x-0">
                <div className="flex h-full w-[250px] flex-col overflow-hidden border-r border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] shadow-[6px_0_24px_rgba(11,14,18,.12)]">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--chrome-line)] px-3.5 py-3">
                    <span className="text-[13px] font-semibold">Filters</span>
                    {hasActiveFilters ? (
                      <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--chrome-accent)]">
                        <RotateCcw size={13} />
                        Reset all
                      </button>
                    ) : null}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="px-3.5 py-3">
                      <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-faint)]">Inspection status</p>
                      <Seg options={INSPECTED_OPTIONS} value={inspectedSel} onChange={setInspectedSel} aria-label="Inspection status filter" className="w-full !bg-[var(--chrome-panel)]" />
                    </div>
                    <FilterGroup label="Pencawang" options={subOptions} selected={subSel} onToggle={toggle(setSubSel)} />
                    <FilterGroup label="Asset type" options={typeOptions} selected={typeSel} onToggle={toggle(setTypeSel)} />
                    <FilterGroup label="Mainhead" options={mainOptions} selected={mainSel} onToggle={toggle(setMainSel)} />
                    <FilterGroup label="Team" options={teamOptions} selected={teamSel} onToggle={toggle(setTeamSel)} />
                    <FilterGroup label="Status" options={statusOptions} selected={statusSel} onToggle={toggle(setStatusSel)} />
                    <FilterGroup label="Defect category" options={categoryOptions} selected={catSel} onToggle={toggle(setCatSel)} />
                  </div>
                </div>
                {/* Handle */}
                <div className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 self-center rounded-r-[10px] border border-l-0 border-[var(--chrome-line)] bg-[var(--chrome)] py-4 shadow-[3px_0_10px_rgba(11,14,18,.08)]">
                  <FilterIcon size={15} className="text-[var(--on-chrome-muted)]" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--on-chrome-muted)] [writing-mode:vertical-rl]">Filters</span>
                  {activeFilterCount > 0 ? (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--chrome-accent)] px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
                  ) : null}
                </div>
              </div>

              {/* RIGHT auto-hide dock — in-view list */}
              <div className="group absolute bottom-0 right-0 top-0 z-20 flex translate-x-[320px] transition-transform duration-300 [transition-timing-function:cubic-bezier(.4,0,.2,1)] focus-within:translate-x-0 hover:translate-x-0">
                {/* Handle */}
                <div className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 self-center rounded-l-[10px] border border-r-0 border-[var(--chrome-line)] bg-[var(--chrome)] py-4 shadow-[-3px_0_10px_rgba(11,14,18,.08)]">
                  <ListOrdered size={15} className="text-[var(--on-chrome-muted)]" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--on-chrome-muted)] [writing-mode:vertical-rl]">In view</span>
                </div>
                <div className="flex h-full w-[320px] flex-col overflow-hidden border-l border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] shadow-[-6px_0_24px_rgba(11,14,18,.12)]">
                  <div className="border-b border-[var(--chrome-line)] px-3.5 py-3">
                    <p className="text-[13px] font-semibold">In view · {counts.total} asset{counts.total === 1 ? "" : "s"}</p>
                    <p className="text-[11.5px] text-[var(--on-chrome-muted)]">sorted by priority</p>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {priorityList.length === 0 ? (
                      <p className="px-3.5 py-8 text-center text-[12.5px] text-[var(--on-chrome-muted)]">No assets in view.</p>
                    ) : (
                      priorityList.map((asset) => {
                        const isSel = asset.id === selectedId;
                        const dotColor = mapAssetMarkerColor(asset, colorMode);
                        const state = mapAssetDefectState(asset);
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => setSelectedId(asset.id)}
                            className={`flex w-full items-center gap-2.5 border-b border-[var(--chrome-line)] px-3.5 py-2.5 text-left transition ${
                              isSel ? "bg-[var(--brand-tint)] shadow-[inset_3px_0_0_var(--chrome-accent)]" : "hover:bg-[var(--chrome-active)]"
                            }`}
                          >
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70" style={{ backgroundColor: dotColor }} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-[12.5px] font-semibold text-[var(--on-chrome)]">{asset.assetCode}</span>
                              <span className="block truncate text-[11.5px] text-[var(--on-chrome-muted)]">
                                {asset.substation?.name || asset.substation?.code || "—"}
                                {asset.team ? ` · ${asset.team.name}` : ""}
                              </span>
                            </span>
                            {asset.openDefectCount > 0 ? (
                              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--on-chrome-muted)]">
                                {asset.openDefectCount}
                                {state === "emergency" ? "⚠" : ""}
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export function MapClient() {
  return (
    <AuthGuard>
      <MapContent />
    </AuthGuard>
  );
}
