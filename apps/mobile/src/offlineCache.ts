import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api';
import { isNetworkOffline } from './networkStatus';

// Persisted read-through cache for offline field use. Generalizes the in-memory
// SWR pattern (e.g. AssetDetailScreen.assetDetailCache) into an AsyncStorage
// store that survives a cold boot, so screens can render their last-known data
// when the device can't reach the API. Caching is strictly best-effort: it must
// never throw into a screen. When we BELIEVE we're online a fresh fetch always
// wins and refreshes the cache (never serving stale); when the shared network
// status says we're offline, cachedFetch serves the cached value immediately to
// avoid the per-read timeout hang (a brief NetInfo false-offline can therefore
// serve slightly-stale data until connectivity is re-confirmed — an accepted
// trade for not hanging every read in a no-coverage area).

const CACHE_PREFIX = '@ascure/mobile/cache/';

// Bound the offline read-cache by BOTH entry count AND total bytes so it can't
// fill the AsyncStorage/SQLite size cap and trip SQLITE_FULL[13] on the next
// write. Entry-count alone is NOT enough: a few large blobs (a big Pencawang's
// whole pole register, or the whole-tenant "all assets" map dump) blow the byte
// budget long before 300 entries. This bites ONLINE crews too — every successful
// online fetch refreshes (writes) its cache entry, so the store grows from normal
// online use. Keep the read-cache comfortably under the DB cap so the DURABLE
// write-queue (a different key prefix, never evicted here) always has room.
// Checked every Nth write (getAllKeys/multiGet aren't free), fire-and-forget so it
// never slows the write that triggered it.
const MAX_CACHE_ENTRIES = 300;
const MAX_CACHE_BYTES = 30 * 1024 * 1024; // 30MB — well under the 64MB DB cap
const EVICT_TO_RATIO = 0.8; // when over a limit, evict oldest down to 80% of it
// Refuse to cache any single value larger than this. Nothing a field screen needs
// offline is this big EXCEPT the whole-tenant global-map asset dump, which is far
// too costly (and low-value) to keep offline — skipping it protects every other
// cached view. A normal per-Pencawang register is well under this.
const MAX_ENTRY_BYTES = 3 * 1024 * 1024; // 3MB
const PRUNE_EVERY_N_WRITES = 25;
// Also prune after this many bytes written since the last prune, so a burst of a
// few large writes triggers eviction well before it can reach the DB cap (the
// on-failure self-heal below is the backstop, but this avoids even a transient
// SQLITE_FULL).
const PRUNE_BYTES_THRESHOLD = 8 * 1024 * 1024; // 8MB
let writesSincePrune = 0;
let bytesSincePrune = 0;

/** Approximate byte size of a stored string (UTF-16 units ≈ bytes for our JSON). */
function approxBytes(value: string) {
  return value.length;
}

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
  const key = cacheKey(namespace, id);

  let serialized: string;
  try {
    serialized = JSON.stringify({
      value,
      cachedAt: new Date().toISOString(),
    } satisfies CacheEnvelope<T>);
  } catch {
    return; // unserializable value — nothing to cache
  }

  // Don't let one oversized blob dominate the store (and repeatedly trip
  // SQLITE_FULL). Drop any prior copy so a stale value isn't served, then skip.
  if (approxBytes(serialized) > MAX_ENTRY_BYTES) {
    console.warn(
      `[offlineCache] skipping oversized entry "${namespace}${id ? `/${id}` : ''}" (~${Math.round(
        approxBytes(serialized) / 1024,
      )}KB > ${Math.round(MAX_ENTRY_BYTES / 1024)}KB per-entry cap)`,
    );
    await AsyncStorage.removeItem(key).catch(() => undefined);
    return;
  }

  try {
    await AsyncStorage.setItem(key, serialized);

    writesSincePrune += 1;
    bytesSincePrune += approxBytes(serialized);
    if (writesSincePrune >= PRUNE_EVERY_N_WRITES || bytesSincePrune >= PRUNE_BYTES_THRESHOLD) {
      writesSincePrune = 0;
      bytesSincePrune = 0;
      void pruneCacheIfNeeded();
    }
  } catch {
    // Write failed (likely SQLITE_FULL). Free space so the NEXT write — including
    // the durable sync-queue (same DB) — has room, then retry this one once.
    // Best-effort: an online screen re-fetches + re-caches anyway.
    await pruneCacheIfNeeded();
    await AsyncStorage.setItem(key, serialized).catch(() => undefined);
  }
}

/**
 * Evict the oldest read-cache entries (by cachedAt) when the cache exceeds EITHER
 * the entry-count OR the byte budget, down to ~80% of whichever limit(s) it broke.
 * Best-effort + fire-and-forget from writeCache; only touches the CACHE_PREFIX
 * keys, NEVER the offline write-queue (a different key prefix = durable field work).
 */
async function pruneCacheIfNeeded(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(CACHE_PREFIX),
    );
    if (keys.length === 0) {
      return;
    }

    const entries = await AsyncStorage.multiGet(keys);
    let totalBytes = 0;
    const dated = entries.map(([key, raw]) => {
      const bytes = raw ? approxBytes(raw) : 0;
      totalBytes += bytes;
      let cachedAt = 0;
      try {
        const parsed = raw ? (JSON.parse(raw) as CacheEnvelope<unknown>) : null;
        cachedAt = parsed?.cachedAt ? Date.parse(parsed.cachedAt) || 0 : 0;
      } catch {
        cachedAt = 0;
      }
      return { key, cachedAt, bytes };
    });

    // Nothing to do while under BOTH limits.
    if (keys.length <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_BYTES) {
      return;
    }

    dated.sort((a, b) => a.cachedAt - b.cachedAt); // oldest first

    const entryTarget = Math.floor(MAX_CACHE_ENTRIES * EVICT_TO_RATIO);
    const byteTarget = Math.floor(MAX_CACHE_BYTES * EVICT_TO_RATIO);
    const toRemove: string[] = [];
    let remainingCount = dated.length;
    let remainingBytes = totalBytes;

    // Evict oldest-first until BOTH the count and byte budgets are satisfied.
    for (const entry of dated) {
      if (remainingCount <= entryTarget && remainingBytes <= byteTarget) {
        break;
      }
      toRemove.push(entry.key);
      remainingCount -= 1;
      remainingBytes -= entry.bytes;
    }

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
 * FAIL-FAST OFFLINE: when the shared network status says we're offline (NetInfo
 * or the manual "Work Offline" toggle), serve the cached value IMMEDIATELY
 * without attempting the network — this is what avoids the ~20s request-timeout
 * hang on every read in a no-coverage area. If there's no cache while offline we
 * still throw a status-0 ApiError right away (no network wait). A fresh fetch is
 * only skipped while offline; the moment NetInfo reports reachable again, reads
 * revalidate and refresh the cache as before.
 */
export async function cachedFetch<T>(
  namespace: string,
  id: string | undefined,
  fetcher: () => Promise<T>,
): Promise<CachedResult<T>> {
  if (isNetworkOffline()) {
    const cached = await readCache<T>(namespace, id);

    if (cached) {
      return { value: cached.value, fromCache: true, cachedAt: cached.cachedAt };
    }

    throw new ApiError(
      'Offline — no cached data available yet for this view.',
      0,
      null,
    );
  }

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
