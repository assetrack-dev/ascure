"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronDown, RefreshCw, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";
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
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  NO_DEFECT_MARKER_COLOR,
  UNINSPECTED_DEFECT_MARKER_COLOR,
  type MapAsset,
  type MapColorMode,
} from "@/lib/map";
import { roleLabel } from "@/lib/roles";
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from "@/types/defects";
import type { AuthSession } from "@/types/auth";

const GoogleAssetMap = dynamic(() => import("@/components/google-asset-map"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--muted)]">Loading map…</p>,
});
const GlobalAssetMap = dynamic(() => import("@/components/global-asset-map"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-[var(--muted)]">Loading map…</p>,
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const UNASSIGNED = "__none__";

const secondaryButtonClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--line)] bg-[var(--chrome)] px-3 text-sm font-semibold text-[var(--foreground)] shadow-[var(--shadow-soft)] transition hover:border-[var(--brand)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-50";

type InspectedFilter = "all" | "inspected" | "not";
type Option = { value: string; label: string; count: number };

function requestErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full ring-2 ring-white"
      style={{ backgroundColor: color }}
    />
  );
}

/** Build sorted {value,label,count} options for one categorical field. */
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

function FilterDropdown({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: Option[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const count = selected.size;
  const active = count > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={options.length === 0}
        className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium shadow-[var(--shadow-soft)] transition disabled:cursor-not-allowed disabled:opacity-50 ${
          active
            ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
            : "border-[var(--line)] bg-[var(--chrome)] text-[var(--foreground)] hover:border-[var(--brand)]"
        }`}
      >
        {label}
        {active ? ` · ${count}` : ""}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-60 overflow-auto rounded-md border border-[var(--chrome-line)] bg-[var(--chrome)] p-2 text-[var(--on-chrome)] shadow-lg">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-semibold uppercase text-[var(--on-chrome-muted)]">
              {label}
            </span>
            {active ? (
              <button
                type="button"
                onClick={onClear}
                className="text-xs font-semibold text-[var(--chrome-accent)]"
              >
                Clear
              </button>
            ) : null}
          </div>
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--chrome-active)]"
            >
              <input
                type="checkbox"
                checked={selected.has(opt.value)}
                onChange={() => onToggle(opt.value)}
              />
              <span className="truncate" title={opt.label}>
                {opt.label}
              </span>
              <span className="ml-auto text-xs text-[var(--on-chrome-muted)]">
                {opt.count}
              </span>
            </label>
          ))}
        </div>
      ) : null}
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

  // Filter state (empty set = no constraint for that category).
  const [subSel, setSubSel] = useState<Set<string>>(new Set());
  const [typeSel, setTypeSel] = useState<Set<string>>(new Set());
  const [mainSel, setMainSel] = useState<Set<string>>(new Set());
  const [teamSel, setTeamSel] = useState<Set<string>>(new Set());
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [catSel, setCatSel] = useState<Set<string>>(new Set());
  const [inspectedSel, setInspectedSel] = useState<InspectedFilter>("all");
  // View preference (not a filter): how to colour the pins.
  const [colorMode, setColorMode] = useState<MapColorMode>("inspection");

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

  // Option lists are derived from the full fetched set so they stay stable as
  // the user narrows the selection.
  const subOptions = useMemo(
    () =>
      buildOptions(assets, (a) =>
        a.substation ? { id: a.substation.id, label: a.substation.name || a.substation.code } : null,
      ),
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
  // Defect-category options are multi-valued per asset (a pole can carry defects
  // in several categories), so they can't go through buildOptions — count each
  // asset once per distinct open-defect category it has.
  const categoryOptions = useMemo<Option[]>(() => {
    const counts = new Map<MaintenanceCategory, number>();
    for (const asset of assets) {
      for (const category of asset.defectCategories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return MAINTENANCE_CATEGORIES.filter((category) => counts.has(category)).map(
      (category) => ({
        value: category,
        label: formatMaintenanceCategory(category),
        count: counts.get(category) ?? 0,
      }),
    );
  }, [assets]);

  // Drop any selected value that no longer exists after the asset set changes
  // (e.g. Refresh), so the active-count badge and the checkbox list stay in sync
  // and a selection can't get stuck with no checkbox to clear it.
  useEffect(() => {
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
        return changed ? next : prev; // keep identity stable when nothing changed
      });
    };
    prune(setSubSel, subOptions);
    prune(setTypeSel, typeOptions);
    prune(setMainSel, mainOptions);
    prune(setTeamSel, teamOptions);
    prune(setStatusSel, statusOptions);
    prune(setCatSel, categoryOptions);
  }, [subOptions, typeOptions, mainOptions, teamOptions, statusOptions, categoryOptions]);

  const filtered = useMemo(() => {
    const matchesSet = (set: Set<string>, value: string | null) =>
      set.size === 0 || set.has(value ?? UNASSIGNED);
    return assets.filter((a) => {
      if (!matchesSet(subSel, a.substation?.id ?? null)) return false;
      if (!matchesSet(typeSel, a.assetType?.id ?? null)) return false;
      if (!matchesSet(mainSel, a.mainhead?.id ?? null)) return false;
      if (!matchesSet(teamSel, a.team?.id ?? null)) return false;
      if (!matchesSet(statusSel, a.status)) return false;
      // Defect category is multi-valued: keep the pole if any open defect it
      // carries is in the selected set (empty set = no constraint).
      if (catSel.size > 0 && !a.defectCategories.some((c) => catSel.has(c))) {
        return false;
      }
      if (inspectedSel !== "all") {
        const inspected = isMapAssetInspected(a);
        if (inspectedSel === "inspected" && !inspected) return false;
        if (inspectedSel === "not" && inspected) return false;
      }
      return true;
    });
  }, [assets, subSel, typeSel, mainSel, teamSel, statusSel, catSel, inspectedSel]);

  const counts = useMemo(() => {
    let inspected = 0;
    let emergency = 0;
    let defect = 0;
    let clean = 0;
    let uninspected = 0;
    for (const asset of filtered) {
      if (isMapAssetInspected(asset)) inspected += 1;
      switch (mapAssetDefectState(asset)) {
        case "emergency":
          emergency += 1;
          break;
        case "defect":
          defect += 1;
          break;
        case "clean":
          clean += 1;
          break;
        default:
          uninspected += 1;
      }
    }
    return {
      total: filtered.length,
      inspected,
      notInspected: filtered.length - inspected,
      emergency,
      defect,
      clean,
      uninspected,
    };
  }, [filtered]);

  const hasActiveFilters =
    subSel.size > 0 ||
    typeSel.size > 0 ||
    mainSel.size > 0 ||
    teamSel.size > 0 ||
    statusSel.size > 0 ||
    catSel.size > 0 ||
    inspectedSel !== "all";

  const resetFilters = useCallback(() => {
    setSubSel(new Set());
    setTypeSel(new Set());
    setMainSel(new Set());
    setTeamSel(new Set());
    setStatusSel(new Set());
    setCatSel(new Set());
    setInspectedSel("all");
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

  const useGoogle = Boolean(GOOGLE_MAPS_API_KEY) && !googleFailed;

  return (
    <AppShell user={session?.user ?? null} onLogout={handleLogout}>
      <main className="px-4 py-6 sm:px-6 lg:px-8 xl:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-[var(--brand)]">Map</p>
              <h1 className="mt-2 text-3xl font-bold text-[var(--foreground)]">Asset Map</h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Every located asset within your scope, on a {useGoogle ? "Google Maps" : "map"} basemap.{" "}
                {roleLabel(session?.user?.role)} access — you see assets from the teams and
                Pencawang you are responsible for. Click a pin for details.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => (token ? loadAssets(token) : undefined)}
                disabled={!token || isLoading}
                className={secondaryButtonClassName}
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {GOOGLE_MAPS_API_KEY && googleFailed ? (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Google Maps could not load (the key may be restricted or the Maps JavaScript API
              isn&apos;t enabled). Showing the OpenStreetMap fallback.
            </div>
          ) : null}

          {/* Filter bar */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <FilterDropdown
              label="Pencawang"
              options={subOptions}
              selected={subSel}
              onToggle={toggle(setSubSel)}
              onClear={() => setSubSel(new Set())}
            />
            <FilterDropdown
              label="Asset Type"
              options={typeOptions}
              selected={typeSel}
              onToggle={toggle(setTypeSel)}
              onClear={() => setTypeSel(new Set())}
            />
            <FilterDropdown
              label="Mainhead"
              options={mainOptions}
              selected={mainSel}
              onToggle={toggle(setMainSel)}
              onClear={() => setMainSel(new Set())}
            />
            <FilterDropdown
              label="Team"
              options={teamOptions}
              selected={teamSel}
              onToggle={toggle(setTeamSel)}
              onClear={() => setTeamSel(new Set())}
            />
            <FilterDropdown
              label="Status"
              options={statusOptions}
              selected={statusSel}
              onToggle={toggle(setStatusSel)}
              onClear={() => setStatusSel(new Set())}
            />
            <FilterDropdown
              label="Defect Category"
              options={categoryOptions}
              selected={catSel}
              onToggle={toggle(setCatSel)}
              onClear={() => setCatSel(new Set())}
            />
            {/* Inspected segmented control */}
            <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--chrome)] shadow-[var(--shadow-soft)]">
              {(
                [
                  ["all", "All"],
                  ["inspected", "Inspected"],
                  ["not", "Not inspected"],
                ] as [InspectedFilter, string][]
              ).map(([value, lbl]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInspectedSel(value)}
                  className={`h-full px-3 text-sm font-medium transition ${
                    inspectedSel === value
                      ? "bg-[var(--brand)] text-[var(--on-brand)]"
                      : "text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            ) : null}
          </div>

          {/* Colour-mode toggle + legend + counts */}
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-[var(--muted)]">
            {/* Colour-by segmented control */}
            <div className="inline-flex items-center gap-2">
              <span className="text-xs font-semibold uppercase text-[var(--muted)]">
                Colour
              </span>
              <div className="inline-flex h-9 items-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--chrome)] shadow-[var(--shadow-soft)]">
                {(
                  [
                    ["inspection", "Inspection"],
                    ["defect", "Defects"],
                  ] as [MapColorMode, string][]
                ).map(([value, lbl]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setColorMode(value)}
                    className={`h-full px-3 text-sm font-medium transition ${
                      colorMode === value
                        ? "bg-[var(--brand)] text-[var(--on-brand)]"
                        : "text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {colorMode === "inspection" ? (
              <>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={INSPECTED_MARKER_COLOR} />
                  Inspected ({counts.inspected})
                </span>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={NOT_INSPECTED_MARKER_COLOR} />
                  Not inspected ({counts.notInspected})
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={EMERGENCY_DEFECT_MARKER_COLOR} />
                  Emergency ({counts.emergency})
                </span>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={OPEN_DEFECT_MARKER_COLOR} />
                  Open defect ({counts.defect})
                </span>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={NO_DEFECT_MARKER_COLOR} />
                  No defect ({counts.clean})
                </span>
                <span className="inline-flex items-center gap-2">
                  <LegendDot color={UNINSPECTED_DEFECT_MARKER_COLOR} />
                  Not inspected ({counts.uninspected})
                </span>
              </>
            )}

            <span className="font-semibold text-[var(--foreground)]">
              Showing {counts.total} of {assets.length} located{" "}
              {assets.length === 1 ? "asset" : "assets"}
            </span>
          </div>

          <div className="mt-4">
            {isLoading && assets.length === 0 ? (
              <p className="p-6 text-sm text-[var(--muted)]">Loading asset map…</p>
            ) : assets.length === 0 ? (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-pressed)] p-6 text-sm text-[var(--muted)]">
                No located assets in your scope yet. Assets appear here once they have GPS
                coordinates and belong to a site visit you can see.
              </p>
            ) : counts.total === 0 ? (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-pressed)] p-6 text-sm text-[var(--muted)]">
                No assets match the current filters.
              </p>
            ) : useGoogle ? (
              <GoogleAssetMap
                assets={filtered}
                colorMode={colorMode}
                apiKey={GOOGLE_MAPS_API_KEY}
                onLoadError={() => setGoogleFailed(true)}
              />
            ) : (
              <GlobalAssetMap assets={filtered} colorMode={colorMode} />
            )}
          </div>
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
