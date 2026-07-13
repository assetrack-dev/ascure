import Mapbox, { offlineManager, StyleURL } from '@rnmapbox/maps';

/**
 * Mapbox setup + offline satellite tile-pack manager.
 *
 * WHY MAPBOX (not the existing Google map): Google's terms forbid caching tiles
 * for offline use, so the field crew's satellite view goes blank with no signal.
 * Mapbox supports genuine offline via its SDK's offline pack manager, so a crew
 * can pre-download the satellite imagery for their work area (at the depot, on
 * wifi) and place markers precisely on poles with zero coverage.
 *
 * TOKENS (owner-provided; NOT committed):
 *  - runtime PUBLIC token (pk.*) baked via EXPO_PUBLIC_MAPBOX_TOKEN — renders the map.
 *  - build-time SECRET download token (sk.* with DOWNLOADS:READ) — set as the
 *    gradle property/env MAPBOX_DOWNLOADS_TOKEN so gradle can fetch the native SDK
 *    (see android/build.gradle). Never appears in JS.
 *
 * OFFLINE LIMIT: Mapbox caps offline at 6,000 tiles/device by default (ToS —
 * cannot be raised without a commercial agreement). We keep MAX_ZOOM at 18
 * (~0.6 m/px, enough to see a pole) and budget each region's tile count
 * (estimateTileCount) so a download stays under the cap.
 */

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';

/** Satellite + street labels — precise imagery to place a pin, with road/pole context. */
export const SATELLITE_STYLE: string = StyleURL.SatelliteStreet;
/** Plain vector street map (the "Map" side of the Sat/Map toggle). */
export const STREET_STYLE: string = StyleURL.Street;

export const OFFLINE_TILE_LIMIT = 6000; // Mapbox ToS default, per device
export const OFFLINE_MIN_ZOOM = 12; // wide context
export const OFFLINE_MAX_ZOOM = 18; // ~0.6 m/px — pole-precise without blowing the tile budget

let initialized = false;

/** Idempotent one-time init — call once at app startup (before any MapView mounts). */
export function initMapbox(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  void Mapbox.setAccessToken(MAPBOX_TOKEN || null);
  // Make the ToS cap explicit so a download can't silently exceed it.
  offlineManager.setTileCountLimit(OFFLINE_TILE_LIMIT);
}

/** Whether a usable public token was baked in — screens fall back gracefully if not. */
export function hasMapboxToken(): boolean {
  return MAPBOX_TOKEN.startsWith('pk.');
}

/** [lng, lat] corners of a rectangular area to take offline. */
export interface OfflineRegionInput {
  /** Stable pack id (e.g. the Pencawang id) — reused to update/delete the pack. */
  id: string;
  /** Human label shown in the download UI. */
  label: string;
  ne: [number, number]; // [lng, lat] north-east
  sw: [number, number]; // [lng, lat] south-west
  minZoom?: number;
  maxZoom?: number;
}

export interface OfflinePackInfo {
  id: string;
  label: string;
  percentage: number;
  tileCount: number;
  bytes: number;
  complete: boolean;
}

/**
 * Download (or resume) the satellite tile pack for a work area. Progress is
 * reported 0–100. Throws if the region would exceed the tile budget so the
 * caller can warn before starting a doomed download.
 */
export async function downloadOfflineRegion(
  region: OfflineRegionInput,
  onProgress?: (percentage: number) => void,
): Promise<void> {
  const minZoom = region.minZoom ?? OFFLINE_MIN_ZOOM;
  const maxZoom = region.maxZoom ?? OFFLINE_MAX_ZOOM;

  const estimate = estimateTileCount(region.sw, region.ne, minZoom, maxZoom);
  if (estimate > OFFLINE_TILE_LIMIT) {
    throw new Error(
      `This area needs ~${estimate} tiles but the offline limit is ${OFFLINE_TILE_LIMIT}. ` +
        `Pick a smaller area or lower the max zoom.`,
    );
  }

  await offlineManager.createPack(
    {
      name: region.id,
      styleURL: SATELLITE_STYLE,
      // Mapbox expects [NE, SW], each a [lng, lat] position.
      bounds: [region.ne, region.sw],
      minZoom,
      maxZoom,
      metadata: { label: region.label },
    },
    (_pack, status) => {
      onProgress?.(status.percentage);
    },
  );
}

/** All downloaded packs with their status (for a "manage offline maps" screen). */
export async function listOfflinePacks(): Promise<OfflinePackInfo[]> {
  const packs = await offlineManager.getPacks();
  return Promise.all(
    packs.map(async (pack) => {
      const status = await pack.status();
      const metadata = (pack.metadata ?? {}) as { label?: string };
      return {
        id: String(pack.name),
        label: metadata.label ?? String(pack.name),
        percentage: status.percentage,
        tileCount: status.completedTileCount,
        bytes: status.completedTileSize,
        complete: status.percentage >= 100,
      };
    }),
  );
}

/** Delete a downloaded pack (free storage / re-download a refreshed area). */
export async function deleteOfflineRegion(id: string): Promise<void> {
  await offlineManager.deletePack(id);
}

/**
 * Estimate the XYZ tile count for a bbox across a zoom range — used to keep a
 * region under OFFLINE_TILE_LIMIT before downloading. Pure (Web-Mercator math).
 */
export function estimateTileCount(
  sw: [number, number],
  ne: [number, number],
  minZoom: number,
  maxZoom: number,
): number {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const n = 2 ** z;
    const xMin = lngToTileX(sw[0], n);
    const xMax = lngToTileX(ne[0], n);
    // Latitude grows downward in tile-Y, so NE lat → smaller Y.
    const yMin = latToTileY(ne[1], n);
    const yMax = latToTileY(sw[1], n);
    total += (Math.abs(xMax - xMin) + 1) * (Math.abs(yMax - yMin) + 1);
  }
  return total;
}

function lngToTileX(lng: number, n: number): number {
  return Math.floor(((lng + 180) / 360) * n);
}

function latToTileY(lat: number, n: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
}
