import { api } from './api';
import { cachedFetch } from './offlineCache';
import { isTempId } from './syncQueue';
import type { Asset, SiteVisit } from './types';

/**
 * Warm a visit's offline caches while online: its asset register + one inspection
 * template per distinct asset type. The template is keyed by SUBSTATION (matching
 * AssetDetailScreen.handleStartInspection) so an offline-started (temp) visit at
 * the same Pencawang reuses it. Best-effort — never throws. Returns the visit's
 * assets so callers (e.g. depot pre-download) can read the pole coordinates
 * without a second fetch.
 */
export async function warmVisitOfflineCache(token: string, visit: SiteVisit): Promise<Asset[]> {
  // Defense-in-depth: a temp (offline-created) visit's caches are already
  // populated locally; never send its non-UUID id to the server.
  if (isTempId(visit.id)) {
    return [];
  }

  try {
    const assets = await cachedFetch('site-visit-assets', visit.id, () =>
      api.getSiteVisitAssets(token, visit.id),
    )
      .then((result) => result.value)
      .catch(() => [] as Asset[]);

    if (visit.substationId) {
      await cachedFetch('assets', visit.substationId, () =>
        api.getAssets(token, visit.substationId as string),
      ).catch(() => undefined);
    }

    const seenTypes = new Set<string>();
    await Promise.all(
      assets.map((asset) => {
        if (!asset.assetTypeId || seenTypes.has(asset.assetTypeId)) {
          return Promise.resolve(undefined);
        }

        seenTypes.add(asset.assetTypeId);

        const templateSubstationId = asset.substationId ?? visit.substationId ?? '';

        return cachedFetch(
          'inspection-template',
          `${templateSubstationId}:none:${asset.assetTypeId}`,
          () =>
            api.resolveInspectionTemplate(token, {
              assetId: asset.id,
              assetTypeId: asset.assetTypeId,
              assetType: asset.assetType?.name,
              siteVisitId: visit.id,
            }),
        ).catch(() => undefined);
      }),
    );

    return assets;
  } catch {
    // Best-effort warm — never block or fail the caller.
    return [];
  }
}
