import { apiRequest } from "@/lib/api";
import {
  DEFECT_SEVERITIES,
  MAINTENANCE_CATEGORIES,
  type DefectSeverity,
  type MaintenanceCategory,
} from "@/types/defects";

/**
 * A located asset for the global map. Fed by the role-scoped `GET /assets/map`
 * endpoint, which only returns assets the caller may see (ADMIN: whole tenant;
 * MANAGER/SUPERVISOR: assets reachable through site visits in their scope).
 *
 * The defect* fields summarise the pole's OPEN defects (OPEN/IN_PROGRESS/
 * MONITORING) so the map can filter by maintenance category and recolour by
 * defect without a second round-trip.
 */
export interface MapAsset {
  id: string;
  assetCode: string;
  name: string | null;
  latitude: number;
  longitude: number;
  status: string;
  substation: { id: string; code: string; name: string; location: string | null } | null;
  assetType: { id: string; code: string; name: string } | null;
  mainhead: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  latestInspection: { status: string; submittedAt: string | null } | null;
  openDefectCount: number;
  defectCategories: MaintenanceCategory[];
  maxDefectSeverity: DefectSeverity | null;
  hasEmergencyDefect: boolean;
  /** True when a non-monitoring open defect exists (OPEN/IN_PROGRESS). Poles
   *  with open defects but no active one render as "monitoring". */
  hasActiveDefect: boolean;
}

/** How to colour the map markers. */
export type MapColorMode = "inspection" | "defect";

/** How to render the marker layer. */
export type MapViewMode = "pins" | "clusters" | "heat";

// Inspection-mode marker colours mirror the mobile app
// (apps/mobile/src/assetDisplay.ts) so the admin map and the field map read
// identically: lime = inspected, red = not yet inspected.
export const INSPECTED_MARKER_COLOR = "#84cc16"; // lime
export const NOT_INSPECTED_MARKER_COLOR = "#ef4444"; // red

// Defect-mode palette. Red/amber read as "needs attention", so an un-inspected
// pole (no defect data yet) drops to neutral slate rather than red here.
// NB: markers render on the Google/Leaflet canvas, OUTSIDE the DOM theme
// cascade, so these must be concrete hex — a CSS var would not resolve. The
// legend dots reuse the same hex so the chart and the map read identically.
export const EMERGENCY_DEFECT_MARKER_COLOR = "#dc2626"; // red-600
export const OPEN_DEFECT_MARKER_COLOR = "#ea580c"; // orange-600 (active defect)
export const MONITORING_DEFECT_MARKER_COLOR = "#d97706"; // amber-600 (monitoring only)
export const NO_DEFECT_MARKER_COLOR = "#16a34a"; // green-600 (inspected, clean)
export const UNINSPECTED_DEFECT_MARKER_COLOR = "#94a3b8"; // slate-400

export type MapAssetDefectState =
  | "emergency"
  | "defect"
  | "monitoring"
  | "clean"
  | "uninspected";

/** An asset is "inspected" once its latest inspection is SUBMITTED. */
export function isMapAssetInspected(asset: MapAsset): boolean {
  const inspection = asset.latestInspection;
  return Boolean(
    inspection && (inspection.status === "SUBMITTED" || inspection.submittedAt),
  );
}

/** Human label for a maintenance category (mirrors the Defects page). */
export function formatMaintenanceCategory(category: MaintenanceCategory): string {
  if (category === "RENTIS") {
    return "Rentis";
  }
  if (category === "CAT_TIANG") {
    return "Cat Tiang";
  }
  return "Selenggaraan";
}

/**
 * The pole's defect state for map colouring, worst-first: an emergency wins,
 * then an active open defect, then monitoring-only, then a clean inspected pole,
 * else not-yet-inspected.
 */
export function mapAssetDefectState(asset: MapAsset): MapAssetDefectState {
  if (asset.hasEmergencyDefect) {
    return "emergency";
  }
  if (asset.openDefectCount > 0) {
    return asset.hasActiveDefect ? "defect" : "monitoring";
  }
  return isMapAssetInspected(asset) ? "clean" : "uninspected";
}

/** Descending triage priority (emergency first) — for the "in view" list sort. */
const DEFECT_STATE_PRIORITY: Record<MapAssetDefectState, number> = {
  emergency: 5,
  defect: 4,
  monitoring: 3,
  clean: 1,
  uninspected: 2,
};

export function mapAssetPriority(asset: MapAsset): number {
  const base = DEFECT_STATE_PRIORITY[mapAssetDefectState(asset)] * 1000;
  // Break ties by open-defect count so the busiest poles rise within a state.
  return base + Math.min(asset.openDefectCount, 999);
}

/** Marker fill colour for an asset under the given colour mode. */
export function mapAssetMarkerColor(
  asset: MapAsset,
  mode: MapColorMode,
): string {
  if (mode === "inspection") {
    return isMapAssetInspected(asset)
      ? INSPECTED_MARKER_COLOR
      : NOT_INSPECTED_MARKER_COLOR;
  }

  switch (mapAssetDefectState(asset)) {
    case "emergency":
      return EMERGENCY_DEFECT_MARKER_COLOR;
    case "defect":
      return OPEN_DEFECT_MARKER_COLOR;
    case "monitoring":
      return MONITORING_DEFECT_MARKER_COLOR;
    case "clean":
      return NO_DEFECT_MARKER_COLOR;
    default:
      return UNINSPECTED_DEFECT_MARKER_COLOR;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function parseIdName(raw: unknown): { id: string; name: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  if (!id) {
    return null;
  }
  return { id, name: typeof record.name === "string" ? record.name : "" };
}

function normalizeCategory(raw: unknown): MaintenanceCategory | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (MAINTENANCE_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as MaintenanceCategory)
    : null;
}

function normalizeDefectCategories(raw: unknown): MaintenanceCategory[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<MaintenanceCategory>();
  for (const value of raw) {
    const category = normalizeCategory(value);
    if (category) {
      seen.add(category);
    }
  }
  // Keep the canonical order (RENTIS → CAT_TIANG → SELENGGARAAN).
  return MAINTENANCE_CATEGORIES.filter((category) => seen.has(category));
}

function normalizeSeverity(raw: unknown): DefectSeverity | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  return (DEFECT_SEVERITIES as readonly string[]).includes(normalized)
    ? (normalized as DefectSeverity)
    : null;
}

function normalizeMapAsset(raw: unknown): MapAsset | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const latitude = toFiniteNumber(record.latitude);
  const longitude = toFiniteNumber(record.longitude);

  // The endpoint already filters out null coordinates, but guard here too so a
  // malformed row can never crash the Leaflet bounds calculation.
  if (latitude === null || longitude === null) {
    return null;
  }

  const id = typeof record.id === "string" ? record.id : null;
  const assetCode = typeof record.assetCode === "string" ? record.assetCode : null;

  if (!id || !assetCode) {
    return null;
  }

  const substation =
    record.substation && typeof record.substation === "object"
      ? (record.substation as Record<string, unknown>)
      : null;
  const assetType =
    record.assetType && typeof record.assetType === "object"
      ? (record.assetType as Record<string, unknown>)
      : null;
  const latestInspection =
    record.latestInspection && typeof record.latestInspection === "object"
      ? (record.latestInspection as Record<string, unknown>)
      : null;

  return {
    id,
    assetCode,
    name: typeof record.name === "string" ? record.name : null,
    latitude,
    longitude,
    status: typeof record.status === "string" ? record.status : "ACTIVE",
    // Require a real id so an id-less object folds into the "Unassigned" filter
    // bucket (matching parseIdName) instead of producing a blank "" option.
    substation:
      substation && typeof substation.id === "string"
        ? {
            id: substation.id,
            code: String(substation.code ?? ""),
            name: String(substation.name ?? ""),
            location:
              typeof substation.location === "string" ? substation.location : null,
          }
        : null,
    assetType:
      assetType && typeof assetType.id === "string"
        ? {
            id: assetType.id,
            code: String(assetType.code ?? ""),
            name: String(assetType.name ?? ""),
          }
        : null,
    mainhead: parseIdName(record.mainhead),
    team: parseIdName(record.team),
    latestInspection: latestInspection
      ? {
          status: String(latestInspection.status ?? ""),
          submittedAt:
            typeof latestInspection.submittedAt === "string"
              ? latestInspection.submittedAt
              : null,
        }
      : null,
    openDefectCount: toFiniteNumber(record.openDefectCount) ?? 0,
    defectCategories: normalizeDefectCategories(record.defectCategories),
    maxDefectSeverity: normalizeSeverity(record.maxDefectSeverity),
    hasEmergencyDefect: record.hasEmergencyDefect === true,
    hasActiveDefect: record.hasActiveDefect === true,
  };
}

export async function fetchMapAssets(token: string): Promise<MapAsset[]> {
  const payload = await apiRequest<unknown>("/assets/map", { token });

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map(normalizeMapAsset)
    .filter((asset): asset is MapAsset => asset !== null);
}

// ---------------------------------------------------------------------------
// Hierarchical drill-down (docs/PLAN-hierarchical-map.md)
// ---------------------------------------------------------------------------

/** Drill-down levels. `points` returns individual poles; the rest return groups. */
export type MapLevel = "region" | "mainhead" | "pencawang" | "points";

/** A group id the API returns for poles whose Pencawang has no Mainhead/Region. */
export const UNASSIGNED_BUBBLE_ID = "__unassigned__";

/**
 * An aggregated group ("bubble") on the hierarchical map: a count of all poles
 * under a Region / Mainhead / Pencawang, positioned at their centroid, with a
 * rolled-up inspection + defect summary. Fed by `GET /assets/map?level=...`.
 */
export interface MapBubble {
  level: "region" | "mainhead" | "pencawang";
  id: string;
  name: string;
  count: number;
  latitude: number;
  longitude: number;
  inspected: number;
  notInspected: number;
  openDefects: number;
  emergency: number;
}

function normalizeMapBubble(raw: unknown): MapBubble | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const level = record.level;
  if (level !== "region" && level !== "mainhead" && level !== "pencawang") {
    return null;
  }
  const latitude = toFiniteNumber(record.latitude);
  const longitude = toFiniteNumber(record.longitude);
  if (!id || latitude === null || longitude === null) {
    return null;
  }
  return {
    level: level as MapBubble["level"],
    id,
    name: typeof record.name === "string" && record.name ? record.name : "—",
    count: toFiniteNumber(record.count) ?? 0,
    latitude,
    longitude,
    inspected: toFiniteNumber(record.inspected) ?? 0,
    notInspected: toFiniteNumber(record.notInspected) ?? 0,
    openDefects: toFiniteNumber(record.openDefects) ?? 0,
    emergency: toFiniteNumber(record.emergency) ?? 0,
  };
}

export interface MapBubbleQuery {
  level: "region" | "mainhead" | "pencawang";
  /** mainhead level: only mainheads in this Region. */
  regionId?: string;
  /** pencawang level: only Pencawang under this Mainhead. */
  mainheadId?: string;
}

/** Orthogonal map filters — narrow the counts at every level (and the leaf). */
export interface MapFilters {
  inspected: "all" | "inspected" | "not";
  assetTypeIds: string[];
  categories: string[];
  defectsOnly: boolean;
  mainheadIds: string[];
  pencawangIds: string[];
  statuses: string[];
  teamIds: string[];
}

export const EMPTY_MAP_FILTERS: MapFilters = {
  inspected: "all",
  assetTypeIds: [],
  categories: [],
  defectsOnly: false,
  mainheadIds: [],
  pencawangIds: [],
  statuses: [],
  teamIds: [],
};

/** How many filters are active (for the dock badge). */
export function mapFiltersActive(filters: MapFilters): number {
  return (
    (filters.inspected !== "all" ? 1 : 0) +
    filters.assetTypeIds.length +
    filters.categories.length +
    (filters.defectsOnly ? 1 : 0) +
    filters.mainheadIds.length +
    filters.pencawangIds.length +
    filters.statuses.length +
    filters.teamIds.length
  );
}

function appendFilters(params: URLSearchParams, filters?: MapFilters): void {
  if (!filters) return;
  if (filters.inspected !== "all") params.set("inspected", filters.inspected);
  if (filters.assetTypeIds.length > 0)
    params.set("assetTypeIds", filters.assetTypeIds.join(","));
  if (filters.categories.length > 0)
    params.set("categories", filters.categories.join(","));
  if (filters.defectsOnly) params.set("defectsOnly", "true");
  if (filters.mainheadIds.length > 0)
    params.set("mainheadIds", filters.mainheadIds.join(","));
  if (filters.pencawangIds.length > 0)
    params.set("pencawangIds", filters.pencawangIds.join(","));
  if (filters.statuses.length > 0) params.set("statuses", filters.statuses.join(","));
  if (filters.teamIds.length > 0) params.set("teamIds", filters.teamIds.join(","));
}

/** Scoped Mainhead + Pencawang options for the filter dock. */
export interface MapFilterOptions {
  mainheads: { id: string; name: string }[];
  pencawang: { id: string; name: string }[];
}

export async function fetchMapFilterOptions(
  token: string,
): Promise<MapFilterOptions> {
  const payload = await apiRequest<unknown>("/assets/map/filter-options", { token });
  const source = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  const norm = (raw: unknown): { id: string; name: string }[] =>
    Array.isArray(raw)
      ? raw
          .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : null))
          .filter((r): r is Record<string, unknown> => r !== null && typeof r.id === "string")
          .map((r) => ({
            id: r.id as string,
            name: typeof r.name === "string" && r.name ? r.name : "—",
          }))
      : [];
  return { mainheads: norm(source.mainheads), pencawang: norm(source.pencawang) };
}

/** Fetch the count bubbles for one drill-down level. */
export async function fetchMapBubbles(
  token: string,
  query: MapBubbleQuery,
  filters?: MapFilters,
): Promise<MapBubble[]> {
  const params = new URLSearchParams({ level: query.level });
  if (query.regionId) params.set("regionId", query.regionId);
  if (query.mainheadId) params.set("mainheadId", query.mainheadId);
  appendFilters(params, filters);
  const payload = await apiRequest<unknown>(`/assets/map?${params.toString()}`, {
    token,
  });
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map(normalizeMapBubble)
    .filter((bubble): bubble is MapBubble => bubble !== null);
}

/** Fetch the individual poles for one Pencawang (the drill-down leaf). */
/** The drilled Pencawang's own location (its site-visit check-in GPS). */
export interface PencawangMarker {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** The points-level response: the Pencawang's poles + its own check-in marker. */
export interface MapPointsResult {
  poles: MapAsset[];
  pencawang: PencawangMarker | null;
}

function normalizePencawangMarker(raw: unknown): PencawangMarker | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const latitude = toFiniteNumber(record.latitude);
  const longitude = toFiniteNumber(record.longitude);
  if (!id || latitude === null || longitude === null) return null;
  return {
    id,
    name: typeof record.name === "string" && record.name ? record.name : "Pencawang",
    latitude,
    longitude,
  };
}

export async function fetchMapPoints(
  token: string,
  pencawangId: string,
  filters?: MapFilters,
): Promise<MapPointsResult> {
  const params = new URLSearchParams({ level: "points", pencawangId });
  appendFilters(params, filters);
  const payload = await apiRequest<unknown>(`/assets/map?${params.toString()}`, {
    token,
  });
  const source = (payload && typeof payload === "object" ? payload : {}) as Record<
    string,
    unknown
  >;
  const poles = Array.isArray(source.poles)
    ? source.poles
        .map(normalizeMapAsset)
        .filter((asset): asset is MapAsset => asset !== null)
    : [];
  return { poles, pencawang: normalizePencawangMarker(source.pencawang) };
}
