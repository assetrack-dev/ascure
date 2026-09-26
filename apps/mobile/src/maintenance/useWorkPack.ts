import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useSession } from '../context/AuthContext';
import { cachedFetch } from '../offlineCache';
import { deleteRepairPhotoFile } from '../syncQueue';
import {
  loadMaintenanceLocal,
  reconcileWithPack,
  subscribeMaintenanceLocal,
  type LocalCompletion,
  type LocalRepairPhoto,
} from './maintenanceLocal';
import type { WorkPackageDetail } from './types';

export const WORK_CACHE_NAMESPACE = 'maintenance-work';

type LocalStore = { photos: LocalRepairPhoto[]; completions: LocalCompletion[] };

/**
 * One package's work pack — server data (network, or the cached copy when
 * offline) plus the device's own not-yet-confirmed repair work.
 */
export function useWorkPack(siteVisitId: string) {
  const { token, handleUnauthorized } = useSession();
  const [pack, setPack] = useState<WorkPackageDetail | null>(null);
  const [local, setLocal] = useState<LocalStore>({ photos: [], completions: [] });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshLocal = useCallback(async () => {
    setLocal(await loadMaintenanceLocal());
  }, []);

  const reload = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await cachedFetch(WORK_CACHE_NAMESPACE, siteVisitId, () =>
        api.getMaintenanceWorkPackage(token, siteVisitId),
      );
      setPack(result.value);
      setFromCache(result.fromCache);
      setCachedAt(result.cachedAt);
      if (!result.fromCache) {
        // A fresh pack confirms synced photos/completions — drop them locally.
        const removable = await reconcileWithPack(result.value);
        await Promise.all(removable.map((uri) => deleteRepairPhotoFile(uri).catch(() => undefined)));
      }
      await refreshLocal();
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 401) {
        await handleUnauthorized(loadError);
        return;
      }
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this package.');
    } finally {
      setIsLoading(false);
    }
  }, [handleUnauthorized, refreshLocal, siteVisitId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => subscribeMaintenanceLocal(() => void refreshLocal()), [refreshLocal]);

  return { pack, local, fromCache, cachedAt, isLoading, error, reload };
}
