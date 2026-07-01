import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api';

// Persisted read-through cache for offline field use. Generalizes the in-memory
// SWR pattern (e.g. AssetDetailScreen.assetDetailCache) into an AsyncStorage
// store that survives a cold boot, so screens can render their last-known data
// when the device can't reach the API. Caching is strictly best-effort: it must
// never throw into a screen, and it must never serve a stale value when the
// server IS reachable (a fresh fetch always wins + refreshes the cache).

const CACHE_PREFIX = '@ascure/mobile/cache/';

// Bound the offline read-cache so it can't grow unbounded over weeks of field
// use (a key driver of the SQLITE_FULL[13] the DB size cap now backstops). When
// the entry count exceeds MAX, evict the oldest by cachedAt. Checked only every
// Nth write (getAllKeys/multiGet aren't free) and run fire-and-forget so it never
// slows the write that triggered it.
const MAX_CACHE_ENTRIES = 300;
const PRUNE_EVERY_N_WRITES = 25;
let writesSincePrune = 0;

type CacheEnvelope<T> = {
  value: T;
  cachedAt: string;
};

export type CachedResult<T> = {
  value: T;
  fromCache: boolean;
  cachedAt: string | null;
};

function cacheKey(namespace: string, id?: string) {
  return id ? `${CACHE_PREFIX}${namespace}/${id}/v1` : `${CACHE_PREFIX}${namespace}/v1`;
}

export async function readCache<T>(namespace: string, id?: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(namespace, id));

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;

    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function writeCache<T>(namespace: string, id: string | undefined, value: T): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = {
      value,
      cachedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(cacheKey(namespace, id), JSON.stringify(envelope));

    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_EVERY_N_WRITES) {
      writesSincePrune = 0;
      void pruneCacheIfNeeded();
    }
  } catch {
    // Best-effort: a full disk / serialization failure must not break the screen.
  }
}

/**
 * Evict the oldest read-cache entries (by cachedAt) when the cache exceeds
 * MAX_CACHE_ENTRIES, down to ~80% of the cap. Best-effort + fire-and-forget from
 * writeCache; only touches the CACHE_PREFIX keys, never the offline write-queue.
 */
async function pruneCacheIfNeeded(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(CACHE_PREFIX),
    );
    if (keys.length <= MAX_CACHE_ENTRIES) {
      return;
    }

    const target = Math.floor(MAX_CACHE_ENTRIES * 0.8);
    const entries = await AsyncStorage.multiGet(keys);
    const dated = entries.map(([key, raw]) => {
      let cachedAt = 0;
      try {
        const parsed = raw ? (JSON.parse(raw) as CacheEnvelope<unknown>) : null;
        cachedAt = parsed?.cachedAt ? Date.parse(parsed.cachedAt) || 0 : 0;
      } catch {
        cachedAt = 0;
      }
      return { key, cachedAt };
    });
    dated.sort((a, b) => a.cachedAt - b.cachedAt); // oldest first

    const toRemove = dated.slice(0, keys.length - target).map((entry) => entry.key);
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {
    // best-effort — eviction failing must never surface
  }
}

export async function removeCache(namespace: string, id?: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(namespace, id));
  } catch {
    // ignore
  }
}

/**
 * Optimistically prepend an item to a cached list (dedupe by identity), so an
 * offline-created entity shows up immediately in list/map screens that read this
 * cache. Replaced by real server data on the next successful online fetch.
 */
export async function prependToCachedArray<T>(
  namespace: string,
  id: string | undefined,
  item: T,
  identify: (entry: T) => string,
): Promise<void> {
  const cached = await readCache<T[]>(namespace, id);
  const existing = Array.isArray(cached?.value) ? (cached?.value as T[]) : [];
  const itemId = identify(item);
  const deduped = existing.filter((entry) => identify(entry) !== itemId);

  await writeCache(namespace, id, [item, ...deduped]);
}

/** Remove an item from a cached list by identity (e.g. dropping an unsynced temp entity). */
export async function removeFromCachedArray<T>(
  namespace: string,
  id: string | undefined,
  itemId: string,
  identify: (entry: T) => string,
): Promise<void> {
  const cached = await readCache<T[]>(namespace, id);

  if (!cached || !Array.isArray(cached.value)) {
    return;
  }

  await writeCache(
    namespace,
    id,
    cached.value.filter((entry) => identify(entry) !== itemId),
  );
}

/**
 * Wipe every offline read-cache entry. Called on sign-out so a different user on
 * the same device can never be served the previous user's cached visits / assets
 * / capabilities / forms while offline. Does NOT touch the offline write-queue
 * (different key prefix) — unsynced field work must survive.
 */
export async function clearAllCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const ours = keys.filter((key) => key.startsWith(CACHE_PREFIX));

    if (ours.length > 0) {
      await AsyncStorage.multiRemove(ours);
    }
  } catch {
    // best-effort
  }
}

/**
 * Stale-while-revalidate read. Always attempts the network fetch first; on
 * success it refreshes the cache and returns fresh data. ONLY when the server
 * is unreachable (`ApiError.status === 0` — offline / request timeout, thrown by
 * api.ts `request()`) does it fall back to the cached value, if one exists.
 *
 * Any other failure (401, other 4xx, 5xx) and an unreachable-with-no-cache both
 * re-throw, so the caller's existing error handling (sign-out on 401, error
 * banner otherwise) is preserved unchanged.
 *
 * NOTE: it deliberately does NOT consult SyncContext.isOffline — NetInfo can be
 * stale at call time, so we always try the network and decide on the real
 * outcome.
 */
export async function cachedFetch<T>(
  namespace: string,
  id: string | undefined,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T>> {
  try {
    const value = await fetcher();
    await writeCache(namespace, id, value);

    return { value, fromCache: false, cachedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      const cached = await readCache<T>(namespace, id);

      if (cached) {
        return { value: cached.value, fromCache: true, cachedAt: cached.cachedAt };
      }
    }

    throw error;
  }
}
