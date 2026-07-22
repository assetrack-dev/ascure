"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Crosshair,
  Filter as FilterIcon,
  ListOrdered,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import {
  checkRondaanForCompletion,
  type AssetLike,
  type RondaanCheckIssue,
} from "@ascure/shared-utils";
import { AppShell } from "@/components/app-shell";
import { AssetMapPanel } from "@/components/asset-map-panel";
import { AuthGuard } from "@/components/auth-guard";
import { Eyebrow, Seg, Tbtn, type SegOption } from "@/components/ui";
import type { MapControls } from "@/components/asset-map-shared";
import { ApiError } from "@/lib/api";
import {
  clearStoredSession,
  readStoredSession,
  refreshStoredSessionUser,
} from "@/lib/auth";
import {
  fetchMapBubbles,
  fetchMapPoints,
  fetchMapFilterOptions,
  fetchMapPointsForMainhead,
  formatMaintenanceCategory,
  isMapAssetInspected,
  mapAssetMarkerColor,
  mapAssetPriority,
  mapFiltersActive,
  EMPTY_MAP_FILTERS,
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  UNASSIGNED_BUBBLE_ID,
  type MapAsset,
  type MapBaseType,
  type MapBubble,
  type MapColorMode,
  type MapFilters,
  type MapLevel,
  type PencawangMarker,
} from "@/lib/map";
import { fetchAssetTypes } from "@/lib/checklist-templates";
import { fetchTeams } from "@/lib/teams";
import { MAINTENANCE_CATEGORIES } from "@/types/defects";
import type { AuthSession } from "@/types/auth";

const HierarchicalMap = dynamic(() => import("@/components/hierarchical-map"), {
  ssr: false,
  loading: () => <MapStageLoading />,
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

const COLOR_OPTIONS: SegOption<MapColorMode>[] = [
  { value: "inspection", label: "Inspection" },
  { value: "defect", label: "Defects" },
];

// Base-map layer toggle. "Satellite" is Google's hybrid (imagery + labels), the
// default so crews see the real terrain; "Map" is the plain road map.
const BASE_TYPE_OPTIONS: SegOption<MapBaseType>[] = [
  { value: "hybrid", label: "Satellite" },
  { value: "roadmap", label: "Map" },
];

const INSPECTED_FILTER_OPTIONS: SegOption<MapFilters["inspected"]>[] = [
  { value: "all", label: "All" },
  { value: "inspected", label: "Inspected" },
  { value: "not", label: "Not" },
];

// AssetStatus enum → filter options.
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "NOT_FOUND", label: "Not found" },
  { value: "REMOVED", label: "Removed" },
  { value: "DUPLICATE", label: "Duplicate" },
];

type ArrayFilterKey =
  | "assetTypeIds"
  | "categories"
  | "mainheadIds"
  | "pencawangIds"
  | "statuses"
  | "teamIds";

type IdName = { id: string; name: string };
type DrillState = { region?: IdName; mainhead?: IdName; pencawang?: IdName };

/**
 * Where the user was on the map, remembered for the browser session so opening
 * a pole's full page and coming back lands on the same view instead of resetting
 * to the whole country. Session-scoped (like the Site Visits filters) — a new
 * tab always starts at the top level.
 */
const MAP_VIEW_STORAGE_KEY = "ascure.map.view";

type StoredMapView = {
  drill: DrillState;
  filters: MapFilters;
  showAllPoles: boolean;
  /** The pole whose panel was open, reopened once its points load. */
  selectedId: string | null;
};

function readStoredMapView(): StoredMapView | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(MAP_VIEW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredMapView>;
    const drill = (parsed.drill ?? {}) as DrillState;
    // A stored step is only usable with both an id and a name (the breadcrumb
    // renders the name); anything malformed falls back to the top level.
    const step = (value: unknown): IdName | undefined => {
      const record = value as IdName | undefined;
      return record && typeof record.id === "string" && typeof record.name === "string"
        ? { id: record.id, name: record.name }
        : undefined;
    };
    return {
      drill: {
        region: step(drill.region),
        mainhead: step(drill.mainhead),
        pencawang: step(drill.pencawang),
      },
      filters: { ...EMPTY_MAP_FILTERS, ...(parsed.filters ?? {}) },
      showAllPoles: parsed.showAllPoles === true,
      selectedId: typeof parsed.selectedId === "string" ? parsed.selectedId : null,
    };
  } catch {
    return null;
  }
}

function writeStoredMapView(view: StoredMapView): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // A full / blocked sessionStorage must never break the map.
  }
}

function levelFor(drill: DrillState): MapLevel {
  if (drill.pencawang) return "points";
  if (drill.mainhead) return "pencawang";
  if (drill.region) return "mainhead";
  return "region";
}

// Plural noun for the items shown AT a level (region shows regions, …).
const LEVEL_ITEMS: Record<MapLevel, string> = {
  region: "regions",
  mainhead: "mainheads",
  pencawang: "Pencawang",
  points: "poles",
};

function MapStageLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--panel-muted)] text-[13px] text-[var(--muted)]">
      Loading map…
    </div>
  );
}

function KpiTile({
  label,
  value,
  alarm = false,
}: {
  label: string;
  value: string | number;
  alarm?: boolean;
}) {
  return (
    <div
      className={`min-w-[92px] rounded-[10px] border px-3 py-2 ${
        alarm
          ? "border-[var(--critical-border)] bg-[var(--danger-tint)]"
          : "border-[var(--line)] bg-[var(--panel)]"
      }`}
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
        {label}
      </p>
      <p
        className={`mt-0.5 text-[20px] font-bold leading-none tabular-nums ${
          alarm ? "text-[var(--critical)]" : "text-[var(--foreground)]"
        }`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
    </div>
  );
}

function LegendRow({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70"
        style={{ backgroundColor: color }}
      />
      <span className="text-[var(--foreground-soft)]">{label}</span>
      <span className="ml-auto font-mono tabular-nums text-[var(--muted)]">{count}</span>
    </div>
  );
}

/** A checkbox filter group inside the left dock — collapsed by default, click
 *  the header to expand. A badge keeps active selections visible when collapsed.
 *  Long lists get a search box + scroll (Pencawang can be large at scale). */
function FilterCheckGroup({
  label,
  options,
  selected,
  onToggle,
  searchable = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  if (options.length === 0) return null;
  const q = query.trim().toLowerCase();
  const shown = searchable && q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <div className="border-t border-[var(--chrome-line)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition hover:bg-[var(--chrome-active)]"
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-[var(--on-chrome-muted)] transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-faint)]">
          {label}
        </span>
        {selected.length > 0 ? (
          <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--chrome-accent)] px-1 text-[10px] font-bold text-white">
            {selected.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="px-3.5 pb-3">
          {searchable && options.length > 8 ? (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="mb-1.5 w-full rounded-[6px] border border-[var(--chrome-line-strong)] bg-[var(--chrome-panel)] px-2 py-1 text-[12px] text-[var(--on-chrome)] outline-none placeholder:text-[var(--on-chrome-faint)]"
            />
          ) : null}
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {shown.map((opt) => {
              const on = selected.includes(opt.value);
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
                </label>
              );
            })}
            {shown.length === 0 ? (
              <p className="px-1.5 py-1 text-[12px] text-[var(--on-chrome-faint)]">No matches</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MapContent() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [googleFailed, setGoogleFailed] = useState(false);
  // True while the Street View panorama is open — used to hide the map-chrome
  // overlays so the auto-hide docks can't block Street View's own controls.
  const [streetViewOpen, setStreetViewOpen] = useState(false);

  const [drill, setDrill] = useState<DrillState>({});
  const [bubbles, setBubbles] = useState<MapBubble[]>([]);
  const [points, setPoints] = useState<MapAsset[]>([]);
  const [selected, setSelected] = useState<MapAsset | null>(null);
  const [pencawangMarker, setPencawangMarker] = useState<PencawangMarker | null>(null);
  const [colorMode, setColorMode] = useState<MapColorMode>("inspection");
  const [mapBaseType, setMapBaseType] = useState<MapBaseType>("hybrid");
  const [filters, setFilters] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [assetTypes, setAssetTypes] = useState<{ id: string; name: string }[]>([]);
  const [mainheadOptions, setMainheadOptions] = useState<{ id: string; name: string }[]>([]);
  const [pencawangOptions, setPencawangOptions] = useState<
    { id: string; name: string; mainheadId: string | null }[]
  >([]);
  const [teamOptions, setTeamOptions] = useState<{ id: string; name: string }[]>([]);
  // "Show all poles" overlap view (Mainhead level): render every pole under the
  // Mainhead — viewport-capped, coloured by Pencawang — instead of group bubbles.
  const [showAllPoles, setShowAllPoles] = useState(false);
  const [truncated, setTruncated] = useState(false);
  // Stable per-Pencawang anchor points for the overlap view (fixed centroids
  // from the server) — set on a structural load, NOT on every pan refetch, so
  // the anchors stay put and don't churn the marker layer.
  const [pencawangAnchors, setPencawangAnchors] = useState<PencawangMarker[]>([]);
  // Gate the first load until the stored view is restored, so returning from a
  // pole's full page fetches the remembered level once instead of loading the
  // top level and then immediately re-loading the restored one.
  const [viewRestored, setViewRestored] = useState(false);
  // The pole to reopen once its points arrive (from the stored view). Cleared as
  // soon as it's matched, so a later manual close doesn't get undone.
  const pendingSelectRef = useRef<string | null>(null);
  const controlsRef = useRef<MapControls | null>(null);
  // Debounces the viewport-driven pole refetch as the map is panned/zoomed.
  const bboxTimerRef = useRef<number | null>(null);

  const level = levelFor(drill);
  const mainheadWide = showAllPoles && Boolean(drill.mainhead) && !drill.pencawang;
  const mode: "bubbles" | "points" =
    drill.pencawang || mainheadWide ? "points" : "bubbles";

  const handleLogout = useCallback(() => {
    clearStoredSession();
    router.replace("/login");
  }, [router]);

  // Session bootstrap + a single user refresh so the shell identity stays fresh.
  useEffect(() => {
    const stored = readStoredSession();
    setSession(stored);
    if (!stored?.token) {
      setIsLoading(false);
      return;
    }
    refreshStoredSessionUser(stored.token)
      .then((user) => {
        if (user) setSession({ token: stored.token as string, user });
      })
      .catch(() => {});
  }, []);

  const token = session?.token ?? null;

  // Fetch + apply the Mainhead-wide poles for a viewport. Shared by the
  // structural load and the silent pan/zoom refetch; it does NOT toggle the
  // full-stage loading state, so panning doesn't flash the spinner.
  const applyMainheadPoints = useCallback(
    async (
      authToken: string,
      mainheadId: string,
      bbox: string | null,
      currentFilters: MapFilters,
      updateAnchors: boolean,
    ) => {
      try {
        const result = await fetchMapPointsForMainhead(
          authToken,
          mainheadId,
          bbox,
          currentFilters,
        );
        setPoints(result.poles);
        setTruncated(result.truncated);
        setBubbles([]);
        setPencawangMarker(null);
        // Only refresh the anchors on a structural load — they're viewport-
        // independent, so a pan refetch must not re-set (and re-render) them.
        if (updateAnchors) {
          setPencawangAnchors(result.pencawangMarkers);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleLogout();
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load the map.");
      }
    },
    [handleLogout],
  );

  const load = useCallback(
    async (
      authToken: string,
      current: DrillState,
      currentFilters: MapFilters,
      showAll: boolean,
    ) => {
      setIsLoading(true);
      setError("");
      try {
        if (current.pencawang) {
          const result = await fetchMapPoints(
            authToken,
            current.pencawang.id,
            currentFilters,
          );
          setPoints(result.poles);
          setPencawangMarker(result.pencawang);
          setBubbles([]);
          setTruncated(false);
        } else if (showAll && current.mainhead) {
          // Seed with the current viewport so the first fetch matches what the
          // user already sees; pan/zoom refines it (handleBoundsChange).
          const bbox = controlsRef.current?.getBounds?.() ?? null;
          await applyMainheadPoints(
            authToken,
            current.mainhead.id,
            bbox,
            currentFilters,
            true,
          );
        } else {
          const lvl = current.mainhead
            ? "pencawang"
            : current.region
              ? "mainhead"
              : "region";
          setBubbles(
            await fetchMapBubbles(
              authToken,
              {
                level: lvl,
                regionId: current.region?.id,
                mainheadId: current.mainhead?.id,
              },
              currentFilters,
            ),
          );
          setPoints([]);
          setPencawangMarker(null);
          setTruncated(false);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          handleLogout();
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load the map.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleLogout, applyMainheadPoints],
  );

  // Silent, debounced pole refetch as the Mainhead-wide map is panned/zoomed.
  const handleBoundsChange = useCallback(
    (bbox: string) => {
      if (!token || !showAllPoles || !drill.mainhead || drill.pencawang) {
        return;
      }
      const mainheadId = drill.mainhead.id;
      if (bboxTimerRef.current) {
        window.clearTimeout(bboxTimerRef.current);
      }
      bboxTimerRef.current = window.setTimeout(() => {
        void applyMainheadPoints(token, mainheadId, bbox, filters, false);
      }, 350);
    },
    [token, showAllPoles, drill, filters, applyMainheadPoints],
  );

  // Restore the remembered view once, before the first fetch. Runs on the client
  // only (sessionStorage), so the prerendered HTML always matches the top level.
  useEffect(() => {
    const stored = readStoredMapView();
    if (stored) {
      setDrill(stored.drill);
      setFilters(stored.filters);
      setShowAllPoles(stored.showAllPoles);
      pendingSelectRef.current = stored.selectedId;
    }
    setViewRestored(true);
  }, []);

  useEffect(() => {
    if (token && viewRestored) void load(token, drill, filters, showAllPoles);
  }, [token, viewRestored, drill, filters, showAllPoles, load]);

  // Remember where the user is, so a trip to a pole's full page comes back here.
  useEffect(() => {
    if (!viewRestored) {
      return;
    }
    writeStoredMapView({
      drill,
      filters,
      showAllPoles,
      selectedId: selected?.id ?? null,
    });
  }, [viewRestored, drill, filters, showAllPoles, selected]);

  // Reopen the panel on the pole that was open before the round-trip, once its
  // points have loaded.
  useEffect(() => {
    const pendingId = pendingSelectRef.current;
    if (!pendingId || points.length === 0) {
      return;
    }
    pendingSelectRef.current = null;
    const match = points.find((asset) => asset.id === pendingId);
    if (match) {
      setSelected(match);
    }
  }, [points]);

  // Re-point the open panel at the freshly loaded copy of its pole. Without this
  // the panel keeps rendering the pole as it was when clicked — so editing its
  // NO TIANG RONDAAN left the header showing the OLD code while the rondaan
  // check (recomputed from the new points) already showed the new one.
  useEffect(() => {
    setSelected((current) => {
      if (!current) {
        return current;
      }
      const fresh = points.find((asset) => asset.id === current.id);
      return fresh ?? current;
    });
  }, [points]);

  // Filter-dock option lists (fetched once).
  useEffect(() => {
    if (!token) return;
    fetchAssetTypes(token)
      .then((types) => setAssetTypes(types.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => {});
    fetchMapFilterOptions(token)
      .then((o) => {
        setMainheadOptions(o.mainheads);
        setPencawangOptions(o.pencawang);
      })
      .catch(() => {});
    fetchTeams(token)
      .then((teams) =>
        setTeamOptions(
          teams
            .filter((t) => t.name)
            .map((t) => ({ id: t.id, name: t.name as string })),
        ),
      )
      .catch(() => {});
  }, [token]);

  const toggleFilter = useCallback(
    (key: ArrayFilterKey) => (value: string) =>
      setFilters((f) => {
        const list = f[key];
        return {
          ...f,
          [key]: list.includes(value)
            ? list.filter((x) => x !== value)
            : [...list, value],
        };
      }),
    [],
  );
  const activeFilters = mapFiltersActive(filters);

  const drillInto = useCallback((bubble: MapBubble) => {
    if (bubble.id === UNASSIGNED_BUBBLE_ID) return; // ungrouped poles aren't drillable
    setSelected(null);
    setShowAllPoles(false);
    setDrill((prev) => {
      const step: IdName = { id: bubble.id, name: bubble.name };
      if (!prev.region) return { region: step };
      if (!prev.mainhead) return { ...prev, mainhead: step };
      if (!prev.pencawang) return { ...prev, pencawang: step };
      return prev;
    });
  }, []);

  const goToDepth = useCallback((depth: 0 | 1 | 2) => {
    setSelected(null);
    setShowAllPoles(false);
    setDrill((prev) => {
      if (depth === 0) return {};
      if (depth === 1) return { region: prev.region };
      return { region: prev.region, mainhead: prev.mainhead };
    });
  }, []);

  const kpis = useMemo(() => {
    let count = 0;
    let inspected = 0;
    let openDefects = 0;
    let emergency = 0;
    if (mode === "bubbles") {
      for (const b of bubbles) {
        count += b.count;
        inspected += b.inspected;
        openDefects += b.openDefects;
        emergency += b.emergency;
      }
    } else {
      for (const a of points) {
        if (isMapAssetInspected(a)) inspected += 1;
        if (a.openDefectCount > 0) openDefects += 1;
        if (a.hasEmergencyDefect) emergency += 1;
      }
      count = points.length;
    }
    return {
      count,
      inspected,
      notInspected: count - inspected,
      openDefects,
      emergency,
      inspectedPct: count > 0 ? Math.round((inspected / count) * 100) : 0,
    };
  }, [mode, bubbles, points]);

  const bubbleRows = useMemo(
    () => [...bubbles].sort((a, b) => b.count - a.count),
    [bubbles],
  );
  const pointRows = useMemo(
    () => [...points].sort((a, b) => mapAssetPriority(b) - mapAssetPriority(a)),
    [points],
  );

  // The SAME NO TIANG RONDAAN pre-check the inspector runs before completing a
  // visit and the DC sees on the Site Visit page, re-run over the poles on the
  // map so the panel can flag a bad number where a manager can fix it. Issues
  // are indexed by asset so the panel only shows the ones for its pole. Gaps sit
  // BETWEEN poles and carry no assetId, so they're not surfaced per-pole here.
  const rondaanIssuesByAsset = useMemo(() => {
    const byAsset = new Map<string, RondaanCheckIssue[]>();
    if (points.length === 0) {
      return byAsset;
    }
    const result = checkRondaanForCompletion(
      points.map(
        (asset): AssetLike => ({
          id: asset.id,
          name: asset.name,
          assetCode: asset.assetCode,
          noTiangRondaan: asset.assetCode,
        }),
      ),
    );
    const add = (assetId: string, issue: RondaanCheckIssue) => {
      const list = byAsset.get(assetId);
      if (list) {
        list.push(issue);
      } else {
        byAsset.set(assetId, [issue]);
      }
    };
    for (const issue of result.issues) {
      if (issue.assetId) {
        add(issue.assetId, issue);
      }
      // A duplicate names every pole sharing the code — flag all of them.
      for (const assetId of issue.assetIds ?? []) {
        add(assetId, issue);
      }
    }
    return byAsset;
  }, [points]);

  // The asset panel steps through the poles in the same order the in-view list
  // shows them, so ‹ › and the list agree on what "next" means.
  const selectedIndex = selected
    ? pointRows.findIndex((asset) => asset.id === selected.id)
    : -1;

  // Selecting from the panel also centres the map on that pole (zoom untouched),
  // so stepping never leaves the pole under review off screen.
  const selectAt = useCallback(
    (index: number) => {
      const asset = pointRows[index];
      if (!asset) {
        return;
      }
      setSelected(asset);
      controlsRef.current?.panTo?.(asset.latitude, asset.longitude);
    },
    [pointRows],
  );

  // In-place checklist editing in the panel — ADMIN, DC (canGovernQa), or the
  // managing MANAGER (canReviewSurvey). MANAGER collapses to VIEWER client-side,
  // so we mirror the server's flags; the API re-enforces scope on every write.
  const canEditChecklist =
    session?.user?.role === "ADMIN" ||
    session?.user?.canGovernQa === true ||
    session?.user?.canReviewSurvey === true;

  const itemsLabel = mode === "points" ? LEVEL_ITEMS.points : LEVEL_ITEMS[level];
  // Sum both sets so the render gate never hits 0 mid-transition (e.g. toggling
  // "show all poles": mode flips to points before the poles arrive). A 0 here
  // unmounts the map, which loses the camera and resets to the default zoom.
  const itemCount = bubbles.length + points.length;

  // Scope the Pencawang filter list to the drilled Mainhead (else it lists every
  // Pencawang in the tenant); falls back to all when not inside a Mainhead.
  const scopedPencawangOptions = useMemo(() => {
    const mainheadId = drill.mainhead?.id;
    return mainheadId
      ? pencawangOptions.filter((p) => p.mainheadId === mainheadId)
      : pencawangOptions;
  }, [pencawangOptions, drill.mainhead]);
  const showMap = Boolean(GOOGLE_MAPS_API_KEY) && !googleFailed;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="flex h-[calc(100dvh-64px)] min-h-[520px] flex-col">
        {/* Header: breadcrumb + KPIs */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-[30px] py-3">
          <div className="min-w-0">
            <Eyebrow>Map</Eyebrow>
            <div className="flex flex-wrap items-center gap-1 text-[12.5px] text-[var(--muted)]">
              <button
                type="button"
                onClick={() => goToDepth(0)}
                className={`font-semibold transition hover:text-[var(--brand)] ${
                  level === "region" ? "text-[var(--foreground)]" : ""
                }`}
              >
                All regions
              </button>
              {drill.region ? (
                <>
                  <ChevronRight size={13} className="text-[var(--muted-2)]" />
                  <button
                    type="button"
                    onClick={() => goToDepth(1)}
                    className={`font-semibold transition hover:text-[var(--brand)] ${
                      level === "mainhead" ? "text-[var(--foreground)]" : ""
                    }`}
                  >
                    {drill.region.name}
                  </button>
                </>
              ) : null}
              {drill.mainhead ? (
                <>
                  <ChevronRight size={13} className="text-[var(--muted-2)]" />
                  <button
                    type="button"
                    onClick={() => goToDepth(2)}
                    className={`font-semibold transition hover:text-[var(--brand)] ${
                      level === "pencawang" ? "text-[var(--foreground)]" : ""
                    }`}
                  >
                    {drill.mainhead.name}
                  </button>
                </>
              ) : null}
              {drill.pencawang ? (
                <>
                  <ChevronRight size={13} className="text-[var(--muted-2)]" />
                  <span className="font-semibold text-[var(--foreground)]">
                    {drill.pencawang.name}
                  </span>
                </>
              ) : null}
            </div>
            <h1
              className="mt-0.5 text-[20px] font-bold leading-tight text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Asset Map
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <KpiTile label="Poles" value={kpis.count} />
            <KpiTile label="Inspected" value={`${kpis.inspectedPct}%`} />
            <KpiTile label="Open defects" value={kpis.openDefects} />
            <KpiTile label="Emergency" value={kpis.emergency} alarm={kpis.emergency > 0} />
            <Tbtn
              onClick={() =>
                token ? load(token, drill, filters, showAllPoles) : undefined
              }
              disabled={!token || isLoading}
              className="ml-1"
            >
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
            Google Maps could not load. Use the list on the right to drill down.
          </div>
        ) : null}

        {/* Map stage */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--panel-muted)]">
          {isLoading && itemCount === 0 ? (
            <MapStageLoading />
          ) : itemCount === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[var(--muted)]">
              Nothing to show here yet. Poles appear once they have GPS coordinates
              and belong to a site visit you can see.
            </div>
          ) : showMap ? (
            <HierarchicalMap
              mode={mode}
              bubbles={bubbles}
              points={points}
              colorMode={colorMode}
              baseType={mapBaseType}
              pencawang={pencawangMarker}
              onDrill={drillInto}
              onSelectPoint={setSelected}
              apiKey={GOOGLE_MAPS_API_KEY}
              onLoadError={() => setGoogleFailed(true)}
              controlsRef={controlsRef}
              onStreetViewVisibleChange={setStreetViewOpen}
              colorByPencawang={mainheadWide}
              suppressAutoFit={mainheadWide}
              onBoundsChange={handleBoundsChange}
              pencawangAnchors={pencawangAnchors}
              selectedPoint={selected}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-[var(--muted)]">
              The map needs a Google Maps key. Drill down with the list on the right.
            </div>
          )}

          {/* Every map-chrome overlay below hides while Street View is open, so
              the auto-hide filter/list docks can't slide over the panorama's own
              controls — notably its top-left "back to map" button. */}
          {!streetViewOpen ? (
            <>
          {/* Top-centre toggle row — [Inspection/Defects] [Satellite/Map],
              centred so the left/right auto-hide docks never cover it. The
              native Street View pegman lives bottom-right, above the zoom box. */}
          {showMap ? (
            <div className="pointer-events-auto absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
              {/* Overlap view (Mainhead level only): swap the Pencawang group
                  bubbles for every pole under the Mainhead, coloured by Pencawang. */}
              {drill.mainhead && !drill.pencawang ? (
                <button
                  type="button"
                  onClick={() => setShowAllPoles((value) => !value)}
                  aria-pressed={showAllPoles}
                  title="Show every pole under this Mainhead (viewport-capped), coloured by Pencawang — to spot poles overlapping the wrong Pencawang."
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold shadow-[var(--shadow-card)] transition ${
                    showAllPoles
                      ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                      : "border-[var(--line)] bg-[var(--panel)] text-[var(--foreground-soft)] hover:bg-[var(--panel-muted)]"
                  }`}
                >
                  <span className="h-2 w-2 rounded-full bg-current opacity-80" />
                  {showAllPoles ? "Showing all poles" : "Show all poles"}
                </button>
              ) : null}
              <Seg
                options={COLOR_OPTIONS}
                value={colorMode}
                onChange={setColorMode}
                aria-label="Colour markers by"
                className="shadow-[var(--shadow-card)]"
              />
              <Seg
                options={BASE_TYPE_OPTIONS}
                value={mapBaseType}
                onChange={setMapBaseType}
                aria-label="Base map layer"
                className="shadow-[var(--shadow-card)]"
              />
            </div>
          ) : null}

          {/* Cap notice — the viewport holds more poles than the 1000-cap. */}
          {showMap && mainheadWide && truncated ? (
            <div className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 rounded-full border border-[var(--medium-border)] bg-[var(--medium-bg)] px-3 py-1 text-[11.5px] font-semibold text-[var(--medium-text)] shadow-[var(--shadow-card)]">
              Showing 1,000 poles — zoom in to see the rest
            </div>
          ) : null}

          {/* Legend */}
          <div className="pointer-events-none absolute bottom-3 left-[46px] z-10 w-52 rounded-[12px] border border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_86%,transparent)] p-3 shadow-[var(--shadow-card)] backdrop-blur">
            <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-2)]">
              {mainheadWide
                ? "By Pencawang"
                : colorMode === "inspection"
                  ? "Inspection"
                  : "Defects"}
            </p>
            <div className="space-y-1.5">
              {mainheadWide ? (
                <p className="text-[11px] leading-snug text-[var(--muted)]">
                  Each Pencawang has its own colour. Hover a pole for its code +
                  Pencawang — an off-colour pole inside a cluster is a possible
                  overlap.
                </p>
              ) : colorMode === "inspection" ? (
                <>
                  <LegendRow color={INSPECTED_MARKER_COLOR} label="Inspected" count={kpis.inspected} />
                  <LegendRow color={NOT_INSPECTED_MARKER_COLOR} label="Not inspected" count={kpis.notInspected} />
                </>
              ) : (
                <>
                  <LegendRow color={EMERGENCY_DEFECT_MARKER_COLOR} label="Emergency" count={kpis.emergency} />
                  <LegendRow color={OPEN_DEFECT_MARKER_COLOR} label="Open defects" count={kpis.openDefects} />
                </>
              )}
            </div>
          </div>

          {/* Zoom box */}
          <div className="absolute bottom-3 right-[46px] z-10 flex flex-col overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-card)]">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => controlsRef.current?.zoomIn()}
              className="flex h-9 w-9 items-center justify-center text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => controlsRef.current?.zoomOut()}
              className="flex h-9 w-9 items-center justify-center border-t border-[var(--line2)] text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
            >
              <Minus size={16} />
            </button>
            <button
              type="button"
              aria-label="Recenter"
              onClick={() => controlsRef.current?.recenter()}
              className="flex h-9 w-9 items-center justify-center border-t border-[var(--line2)] text-[var(--foreground)] transition hover:bg-[var(--panel-muted)]"
            >
              <Crosshair size={15} />
            </button>
          </div>

          {/* Selected pole — the full record in a side panel, with ‹ › stepping
              through the poles currently on the map. */}
          {selected ? (
            <AssetMapPanel
              asset={selected}
              token={session?.token ?? null}
              canEdit={canEditChecklist}
              rondaanIssues={rondaanIssuesByAsset.get(selected.id) ?? []}
              onAssetCodeChanged={() => {
                if (token) void load(token, drill, filters, showAllPoles);
              }}
              index={selectedIndex}
              total={pointRows.length}
              onPrev={() => selectAt(selectedIndex - 1)}
              onNext={() => selectAt(selectedIndex + 1)}
              onClose={() => setSelected(null)}
              onOpenFullPage={() =>
                router.push(
                  `/assets/${encodeURIComponent(selected.id)}?from=${encodeURIComponent("/map")}`,
                )
              }
              onUnauthorized={handleLogout}
            />
          ) : null}

          {/* Left auto-hide dock — filters */}
          <div className="group absolute bottom-0 left-0 top-0 z-20 flex -translate-x-[250px] transition-transform duration-300 [transition-timing-function:cubic-bezier(.4,0,.2,1)] focus-within:translate-x-0 hover:translate-x-0">
            <div className="flex h-full w-[250px] flex-col overflow-hidden border-r border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] shadow-[6px_0_24px_rgba(11,14,18,.12)]">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--chrome-line)] px-3.5 py-3">
                <span className="text-[13px] font-semibold">Filters</span>
                {activeFilters > 0 ? (
                  <button
                    type="button"
                    onClick={() => setFilters(EMPTY_MAP_FILTERS)}
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--chrome-accent)]"
                  >
                    <RotateCcw size={13} />
                    Reset
                  </button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="px-3.5 py-3">
                  <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--on-chrome-faint)]">
                    Inspection
                  </p>
                  <Seg
                    options={INSPECTED_FILTER_OPTIONS}
                    value={filters.inspected}
                    onChange={(v) => setFilters((f) => ({ ...f, inspected: v }))}
                    aria-label="Inspection filter"
                    className="w-full !bg-[var(--chrome-panel)]"
                  />
                </div>
                <div className="border-t border-[var(--chrome-line)] px-3.5 py-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        filters.defectsOnly
                          ? "border-[var(--chrome-accent)] bg-[var(--chrome-accent)]"
                          : "border-[var(--chrome-line-strong)]"
                      }`}
                    >
                      {filters.defectsOnly ? (
                        <span className="text-[10px] font-bold text-white">✓</span>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      checked={filters.defectsOnly}
                      onChange={(e) =>
                        setFilters((f) => ({ ...f, defectsOnly: e.target.checked }))
                      }
                      className="sr-only"
                    />
                    <span className="text-[var(--on-chrome)]">Only poles with open defects</span>
                  </label>
                </div>
                <FilterCheckGroup
                  label="Status"
                  options={STATUS_OPTIONS}
                  selected={filters.statuses}
                  onToggle={toggleFilter("statuses")}
                />
                <FilterCheckGroup
                  label="Mainhead"
                  options={mainheadOptions.map((m) => ({ value: m.id, label: m.name }))}
                  selected={filters.mainheadIds}
                  onToggle={toggleFilter("mainheadIds")}
                  searchable
                />
                <FilterCheckGroup
                  label="Pencawang"
                  options={scopedPencawangOptions.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                  selected={filters.pencawangIds}
                  onToggle={toggleFilter("pencawangIds")}
                  searchable
                />
                <FilterCheckGroup
                  label="Asset type"
                  options={assetTypes.map((t) => ({ value: t.id, label: t.name }))}
                  selected={filters.assetTypeIds}
                  onToggle={toggleFilter("assetTypeIds")}
                />
                <FilterCheckGroup
                  label="Defect category"
                  options={MAINTENANCE_CATEGORIES.map((c) => ({
                    value: c,
                    label: formatMaintenanceCategory(c),
                  }))}
                  selected={filters.categories}
                  onToggle={toggleFilter("categories")}
                />
                <FilterCheckGroup
                  label="Team"
                  options={teamOptions.map((t) => ({ value: t.id, label: t.name }))}
                  selected={filters.teamIds}
                  onToggle={toggleFilter("teamIds")}
                  searchable
                />
              </div>
            </div>
            {/* Handle */}
            <div className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 self-center rounded-r-[10px] border border-l-0 border-[var(--chrome-line)] bg-[var(--chrome)] py-4 shadow-[3px_0_10px_rgba(11,14,18,.08)]">
              <FilterIcon size={15} className="text-[var(--on-chrome-muted)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--on-chrome-muted)] [writing-mode:vertical-rl]">
                Filters
              </span>
              {activeFilters > 0 ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--chrome-accent)] px-1 text-[10px] font-bold text-white">
                  {activeFilters}
                </span>
              ) : null}
            </div>
          </div>

          {/* Right auto-hide dock — the current level's list */}
          <div className="group absolute bottom-0 right-0 top-0 z-20 flex translate-x-[300px] transition-transform duration-300 [transition-timing-function:cubic-bezier(.4,0,.2,1)] focus-within:translate-x-0 hover:translate-x-0">
            <div className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 self-center rounded-l-[10px] border border-r-0 border-[var(--chrome-line)] bg-[var(--chrome)] py-4 shadow-[-3px_0_10px_rgba(11,14,18,.08)]">
              <ListOrdered size={15} className="text-[var(--on-chrome-muted)]" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--on-chrome-muted)] [writing-mode:vertical-rl]">
                List
              </span>
            </div>
            <div className="flex h-full w-[300px] flex-col overflow-hidden border-l border-[var(--chrome-line)] bg-[var(--chrome)] text-[var(--on-chrome)] shadow-[-6px_0_24px_rgba(11,14,18,.12)]">
              <div className="border-b border-[var(--chrome-line)] px-3.5 py-3">
                <p className="text-[13px] font-semibold">
                  {itemCount} {itemsLabel}
                </p>
                <p className="text-[11.5px] text-[var(--on-chrome-muted)]">
                  {mode === "bubbles" ? "click to drill in" : "sorted by priority"}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {mode === "bubbles"
                  ? bubbleRows.map((b) => {
                      const drillable = b.id !== UNASSIGNED_BUBBLE_ID && level !== "pencawang";
                      const isLeafParent = level === "pencawang";
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => drillInto(b)}
                          disabled={b.id === UNASSIGNED_BUBBLE_ID}
                          className="flex w-full items-center gap-2.5 border-b border-[var(--chrome-line)] px-3.5 py-2.5 text-left transition hover:bg-[var(--chrome-active)] disabled:cursor-default disabled:opacity-60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--on-chrome)]">
                              {b.name}
                            </span>
                            <span className="block truncate text-[11.5px] text-[var(--on-chrome-muted)]">
                              {b.inspected}/{b.count} inspected
                              {b.openDefects > 0 ? ` · ${b.openDefects} open` : ""}
                              {b.emergency > 0 ? ` · ${b.emergency}⚠` : ""}
                            </span>
                          </span>
                          <span className="font-mono text-[13px] font-bold tabular-nums text-[var(--on-chrome)]">
                            {b.count}
                          </span>
                          {drillable || isLeafParent ? (
                            <ChevronRight size={14} className="text-[var(--on-chrome-faint)]" />
                          ) : null}
                        </button>
                      );
                    })
                  : pointRows.map((asset) => {
                      const isSel = asset.id === selected?.id;
                      const dotColor = mapAssetMarkerColor(asset, colorMode);
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSelected(asset)}
                          className={`flex w-full items-center gap-2.5 border-b border-[var(--chrome-line)] px-3.5 py-2.5 text-left transition ${
                            isSel
                              ? "bg-[var(--brand-tint)] shadow-[inset_3px_0_0_var(--chrome-accent)]"
                              : "hover:bg-[var(--chrome-active)]"
                          }`}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/70"
                            style={{ backgroundColor: dotColor }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[12.5px] font-semibold text-[var(--on-chrome)]">
                              {asset.assetCode}
                            </span>
                            <span className="block truncate text-[11.5px] text-[var(--on-chrome-muted)]">
                              {asset.substation?.name || asset.substation?.code || "—"}
                            </span>
                          </span>
                          {asset.openDefectCount > 0 ? (
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--on-chrome-muted)]">
                              {asset.openDefectCount}
                              {asset.hasEmergencyDefect ? "⚠" : ""}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
              </div>
            </div>
          </div>
            </>
          ) : null}
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
