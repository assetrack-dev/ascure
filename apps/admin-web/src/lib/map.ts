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
}

/** How to colour the map markers. */
export type MapColorMode = "inspection" | "defect";

// Inspection-mode marker colours mirror the mobile app
// (apps/mobile/src/assetDisplay.ts) so the admin map and the field map read
// identically: lime = inspected, red = not yet inspected.
export const INSPECTED_MARKER_COLOR = "#84cc16"; // lime
export const NOT_INSPECTED_MARKER_COLOR = "#ef4444"; // red

// Defect-mode palette. Red/amber read as "needs attention", so an un-inspected
// pole (no defect data yet) drops to neutral slate rather than red here.
export const EMERGENCY_DEFECT_MARKER_COLOR = "#dc2626"; // red-600
export const OPEN_DEFECT_MARKER_COLOR = "#f59e0b"; // amber-500
export const NO_DEFECT_MARKER_COLOR = "#84cc16"; // lime (inspected, clean)
export const UNINSPECTED_DEFECT_MARKER_COLOR = "#94a3b8"; // slate-400

export type MapAssetDefectState =
  | "emergency"
  | "defect"
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
 * then any open defect, then a clean inspected pole, else not-yet-inspected.
 */
export function mapAssetDefectState(asset: MapAsset): MapAssetDefectState {
  if (asset.hasEmergencyDefect) {
    return "emergency";
  }
  if (asset.openDefectCount > 0) {
    return "defect";
  }
  return isMapAssetInspected(asset) ? "clean" : "uninspected";
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
