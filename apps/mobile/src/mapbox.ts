import { NativeModules } from 'react-native';
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

// If no progress event arrives for this long, downloadOfflineRegion does ONE
// safe status probe to tell "finished but events silent" from "genuinely stalled".
const OFFLINE_STALL_MS = 60000;

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

  // @rnmapbox's createPack(...) promise resolves the instant the native download
  // is KICKED OFF, not when it finishes — real progress, completion and failure
  // arrive only via the async progress/error listeners. Worse, those listeners
  // ride the legacy device-event channel, which can be silently dead under the
  // New Architecture (the MapView uses a different, working channel — so a map
  // that renders proves nothing about offline events). Awaiting createPack alone
  // returns immediately and any download error is swallowed.
  //
  // We drive the result from the progress/error listeners (fast, and they carry
  // the native error message). A watchdog covers the case where those events
  // never arrive: if the download goes quiet for OFFLINE_STALL_MS we do ONE
  // status probe to tell "finished but events silent" from "genuinely stalled".
  //
  // IMPORTANT: while a download is active we must NOT call offlineManager.getPack
  // /getPacks — on Android that runs convertRegionsToJSON on the UI thread
  // (CountDownLatch.await + an unguarded value!!), which ANRs/crashes when polled
  // mid-download. readPackPercentage() below hits the UI-thread-safe getPackStatus
  // directly, and only when events have gone silent — never in a hot loop.
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let bestPct = 0;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const report = (pct: number) => {
      if (!Number.isFinite(pct)) return;
      if (pct > bestPct) bestPct = pct;
      onProgress?.(bestPct); // monotonic — never let the bar jump backwards
    };

    const cleanup = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
      offlineManager.unsubscribe(region.id); // drop our listeners (safe if already gone)
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    // Watchdog: re-armed on every progress event, so on a healthy device (events
    // flowing) it NEVER fires and we never touch the native offline module.
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        void (async () => {
          const pct = await readPackPercentage(region.id);
          if (pct != null && pct >= 100) return succeed(); // done — events were just silent
          if (pct != null && pct > bestPct) {
            // Still advancing but events aren't crossing the bridge — degrade to a
            // slow (once-per-stall) safe poll instead of failing.
            report(pct);
            armStall();
            return;
          }
          fail(new Error('Download stalled — no tiles arrived. Check your signal and try again.'));
        })();
      }, OFFLINE_STALL_MS);
    };

    offlineManager
      .createPack(
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
          report(status.percentage);
          armStall(); // fresh event — reset the watchdog
          if (status.percentage >= 100) succeed();
        },
        (_pack, error) => {
          fail(new Error(error?.message || 'Satellite tiles failed to download.'));
        },
      )
      .then(() => armStall()) // kicked off OK — start the watchdog
      .catch((startError) => fail(startError)); // failed to even start (native reject / name clash)
  });
}

/**
 * UI-thread-SAFE single-pack progress probe (0–100), or null if unavailable.
 *
 * Deliberately calls the native getPackStatus method directly instead of
 * offlineManager.getPack()/getPacks(): the latter run convertRegionsToJSON on
 * Android's UI thread (blocking CountDownLatch.await + an unguarded `value!!`),
 * which ANRs/crashes when polled during an active download. getPackStatus is
 * plain callback-based and safe to call mid-download.
 */
async function readPackPercentage(id: string): Promise<number | null> {
  const mod = (
    NativeModules as {
      RNMBXOfflineModule?: { getPackStatus?: (name: string) => Promise<{ percentage?: number }> };
    }
  ).RNMBXOfflineModule;
  if (!mod?.getPackStatus) return null;
  try {
    const status = await mod.getPackStatus(id);
    return typeof status?.percentage === 'number' && Number.isFinite(status.percentage)
      ? status.percentage
      : null;
  } catch {
    return null;
  }
}

/** All downloaded packs with their status (for a "manage offline maps" screen). */
export async function listOfflinePacks(): Promise<OfflinePackInfo[]> {
  const packs = await offlineManager.getPacks();
  const infos = await Promise.all(
    packs.map(async (pack): Promise<OfflinePackInfo | null> => {
      try {
        const status = (await pack.status()) as {
          percentage?: number;
          completedResourceCount?: number;
          completedResourceSize?: number;
          completedTileCount?: number;
          completedTileSize?: number;
        };
        const metadata = (pack.metadata ?? {}) as { label?: string };
        const percentage = Number.isFinite(status?.percentage) ? (status.percentage as number) : 0;
        return {
          id: String(pack.name),
          label: metadata.label ?? String(pack.name),
          percentage,
          // The Android getPackStatus payload reports completedResource{Count,Size};
          // the tile-prefixed fields only exist in progress EVENTS (and on iOS). Coalesce
          // and default to 0 — otherwise `tileCount.toLocaleString()` in the UI throws
          // "Cannot read property 'toLocaleString' of undefined" and crashes the screen.
          tileCount: status.completedTileCount ?? status.completedResourceCount ?? 0,
          bytes: status.completedTileSize ?? status.completedResourceSize ?? 0,
          complete: percentage >= 100,
        };
      } catch {
        return null; // skip a pack whose status can't be read rather than blank the list
      }
    }),
  );
  return infos.filter((p): p is OfflinePackInfo => p !== null);
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
