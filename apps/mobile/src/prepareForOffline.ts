import { api } from './api';
import { cachedFetch } from './offlineCache';
import { warmVisitOfflineCache } from './offlineWarm';
import {
  OFFLINE_MAX_ZOOM,
  OFFLINE_MIN_ZOOM,
  OFFLINE_TILE_LIMIT,
  downloadOfflineRegion,
  estimateTileCount,
  hasMapboxToken,
  listOfflinePacks,
} from './mapbox';
import type { Asset, SiteVisit } from './types';

export type PrepareOfflinePhase = 'warming' | 'downloading' | 'done';

export type PrepareOfflineProgress = {
  phase: PrepareOfflinePhase;
  message: string;
};

export type PrepareOfflineSummary = {
  areasCached: number;
  mapsDownloaded: number;
  mapsSkippedNoCoords: number;
  mapsSkippedBudget: number;
  mapsFailed: number;
  mapsToken: boolean;
};

// A degree of latitude is ~111 km; pad the pole bounding box so poles aren't at
// the very tile edge and a little surrounding context comes along.
const PAD_METERS = 250;
// If all a Pencawang's poles sit at ~one point, frame at least this half-span so
// there's a usable area to place markers against.
const MIN_HALF_SPAN_DEG = 0.0025; // ~275 m

type Bbox = { ne: [number, number]; sw: [number, number] };

function boundingBoxFor(assets: Asset[]): Bbox | null {
  const coords = assets.filter(
    (asset): asset is Asset & { latitude: number; longitude: number } =>
      typeof asset.latitude === 'number' &&
      Number.isFinite(asset.latitude) &&
      typeof asset.longitude === 'number' &&
      Number.isFinite(asset.longitude),
  );

  if (coords.length === 0) {
    return null;
  }

  let minLat = coords[0].latitude;
  let maxLat = coords[0].latitude;
  let minLng = coords[0].longitude;
  let maxLng = coords[0].longitude;

  for (const asset of coords) {
    minLat = Math.min(minLat, asset.latitude);
    maxLat = Math.max(maxLat, asset.latitude);
    minLng = Math.min(minLng, asset.longitude);
    maxLng = Math.max(maxLng, asset.longitude);
  }

  const midLat = (minLat + maxLat) / 2;
  const latPad = Math.max(PAD_METERS / 111_000, MIN_HALF_SPAN_DEG);
  // Longitude degrees shrink toward the poles; guard the cos against 0.
  const lngPad = Math.max(
    PAD_METERS / (111_000 * Math.max(Math.cos((midLat * Math.PI) / 180), 0.1)),
    MIN_HALF_SPAN_DEG,
  );

  return {
    ne: [maxLng + lngPad, maxLat + latPad],
    sw: [minLng - lngPad, minLat - latPad],
  };
}

/**
 * Depot "Prepare for Offline": warm the reference data + each active/assigned
 * visit's asset register and inspection templates, then auto-download a satellite
 * pack for every assigned Pencawang whose poles have coordinates — computing the
 * bounding box headlessly (the cached Substation has no lat/lng) and respecting
 * the device-wide 6,000-tile budget CUMULATIVELY. Pencawang without pole
 * coordinates are skipped (the crew can still frame + download them manually on
 * the Offline Maps screen). Best-effort throughout; returns a summary.
 */
export async function prepareAssignedAreasForOffline(
  token: string,
  onProgress: (progress: PrepareOfflineProgress) => void,
): Promise<PrepareOfflineSummary> {
  const summary: PrepareOfflineSummary = {
    areasCached: 0,
    mapsDownloaded: 0,
    mapsSkippedNoCoords: 0,
    mapsSkippedBudget: 0,
    mapsFailed: 0,
    mapsToken: hasMapboxToken(),
  };

  onProgress({ phase: 'warming', message: 'Saving your teams & Pencawang list…' });

  // 1) Check-In reference data.
  await Promise.all([
    cachedFetch('teams', undefined, () => api.getTeams(token)).catch(() => undefined),
    cachedFetch('substations', undefined, () => api.getSubstations(token)).catch(() => undefined),
    cachedFetch('mainheads', undefined, () => api.getMainheads(token)).catch(() => undefined),
  ]);

  // 2) Active/assigned visits + their registers/templates. Dedupe by Pencawang so
  //    two visits at the same substation don't queue two identical map downloads.
  const activeVisits = await cachedFetch('site-visits-active', undefined, () =>
    api.getActiveSiteVisits(token),
  )
    .then((result) => result.value)
    .catch(() => [] as SiteVisit[]);

  const bySubstation = new Map<string, { visit: SiteVisit; assets: Asset[] }>();

  for (const visit of activeVisits) {
    onProgress({
      phase: 'warming',
      message: `Saving ${visit.substation?.name ?? visit.pencawangName ?? 'visit'}…`,
    });

    const assets = await warmVisitOfflineCache(token, visit);
    summary.areasCached += 1;

    if (visit.substationId && !bySubstation.has(visit.substationId)) {
      bySubstation.set(visit.substationId, { visit, assets });
    }
  }

  // 3) Satellite maps, budget-checked cumulatively.
  if (!summary.mapsToken) {
    onProgress({ phase: 'done', message: 'Data saved. Map imagery isn’t configured for this build.' });
    return summary;
  }

  const existingPacks = await listOfflinePacks().catch(() => []);
  const existingIds = new Set(existingPacks.map((pack) => pack.id));
  let usedTiles = existingPacks.reduce((sum, pack) => sum + (pack.tileCount ?? 0), 0);

  for (const [substationId, { visit, assets }] of bySubstation) {
    const packId = `pencawang-${substationId}`;

    if (existingIds.has(packId)) {
      // Already downloaded for this Pencawang — leave it (delete/refresh via the
      // Offline Maps screen).
      continue;
    }

    const bbox = boundingBoxFor(assets);
    if (!bbox) {
      summary.mapsSkippedNoCoords += 1;
      continue;
    }

    const estimate = estimateTileCount(bbox.sw, bbox.ne, OFFLINE_MIN_ZOOM, OFFLINE_MAX_ZOOM);
    if (estimate > OFFLINE_TILE_LIMIT || usedTiles + estimate > OFFLINE_TILE_LIMIT) {
      summary.mapsSkippedBudget += 1;
      continue;
    }

    onProgress({
      phase: 'downloading',
      message: `Downloading map for ${visit.substation?.name ?? 'area'}…`,
    });

    try {
      await downloadOfflineRegion({
        id: packId,
        label: visit.substation?.name ?? visit.pencawangName ?? 'Pencawang',
        ne: bbox.ne,
        sw: bbox.sw,
      });
      usedTiles += estimate;
      summary.mapsDownloaded += 1;
    } catch {
      summary.mapsFailed += 1;
    }
  }

  onProgress({ phase: 'done', message: 'Ready for offline.' });
  return summary;
}
