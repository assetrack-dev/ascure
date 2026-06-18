import { apiRequest } from "@/lib/api";

/**
 * A located asset for the global map. Fed by the role-scoped `GET /assets/map`
 * endpoint, which only returns assets the caller may see (ADMIN: whole tenant;
 * MANAGER/SUPERVISOR: assets reachable through site visits in their scope).
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
}

// Marker colours mirror the mobile app (apps/mobile/src/assetDisplay.ts) so the
// admin map and the field map read identically.
export const INSPECTED_MARKER_COLOR = "#84cc16"; // lime
export const NOT_INSPECTED_MARKER_COLOR = "#ef4444"; // red

/** An asset is "inspected" once its latest inspection is SUBMITTED. */
export function isMapAssetInspected(asset: MapAsset): boolean {
  const inspection = asset.latestInspection;
  return Boolean(
    inspection && (inspection.status === "SUBMITTED" || inspection.submittedAt),
  );
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
