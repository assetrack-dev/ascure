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
// Budget freeReadCacheSpace() shrinks to when a durable write is failing.
const EMERGENCY_CACHE_BYTES = 8 * 1024 * 1024; // 8MB → evicts down to ~6.4MB
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

// Android's CursorWindow can't hold a single row over 2MB: the setItem succeeds,
// but every later read of that row throws "Row too big to fit into CursorWindow".
// Before this, such a row (a big Pencawang's register) was cached-but-unreadable
// AND made the eviction's multiGet throw — so eviction silently stopped for good,
// the cache grew to the DB cap, and the next DURABLE write (the offline queue,
// i.e. every offline Save) failed with SQLITE_FULL. Values longer than this are
// split across rows; the main key then holds a small manifest.
const CHUNK_CHARS = 512 * 1024; // ≤1.5MB even if every char were 3-byte UTF-8
const PART_MARKER = '#part/';
// Prune reads entries a batch at a time so one unreadable row can't fail it all.
const PRUNE_READ_BATCH = 20;

type ChunkManifest = {
  __chunks: number;
  bytes: number;
  cachedAt: string;
};

function partKey(key: string, index: number) {
  return `${key}${PART_MARKER}${index}`;
}

function partsOf(key: string, keys: readonly string[]) {
  return keys.filter((candidate) => candidate.startsWith(`${key}${PART_MARKER}`));
}

function parseManifest(raw: string): ChunkManifest | null {
  if (!raw.startsWith('{"__chunks"')) {
    return null;
  }
  try {
    const manifest = JSON.parse(raw) as ChunkManifest;
    return typeof manifest.__chunks === 'number' ? manifest : null;
  } catch {
    return null;
  }
}

/** Remove an entry and every part row it may have. */
async function removeEntry(key: string) {
  await AsyncStorage.multiRemove([key, ...partsOf(key, await AsyncStorage.getAllKeys())]);
}

/** The full stored string for a cache key, reassembled from parts if chunked. */
async function readEntryRaw(key: string): Promise<string | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    // Unreadable (an oversized row an older build wrote). It can never be
    // served — drop it so it stops poisoning eviction.
    await removeEntry(key).catch(() => undefined);
    return null;
  }

  if (!raw) {
    return null;
  }

  const manifest = parseManifest(raw);
  if (!manifest) {
    return raw;
  }

  const partKeys = Array.from({ length: manifest.__chunks }, (_, index) => partKey(key, index));
  const parts = new Map(await AsyncStorage.multiGet(partKeys));
  const pieces: string[] = [];
  for (const part of partKeys) {
    const piece = parts.get(part);
    if (piece == null) {
      return null; // incomplete — treat as a miss
    }
    pieces.push(piece);
  }
  return pieces.join('');
}

export async function readCache<T>(namespace: string, id?: string): Promise<CacheEnvelope<T> | null> {
  try {
    const raw = await readEntryRaw(cacheKey(namespace, id));

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

/** Rows to multiSet for one entry: the value itself, or a manifest + its parts. */
function entryRows(key: string, serialized: string, cachedAt: string): [string, string][] {
  if (serialized.length <= CHUNK_CHARS) {
    return [[key, serialized]];
  }

  const parts: [string, string][] = [];
  for (let offset = 0; offset < serialized.length; offset += CHUNK_CHARS) {
    parts.push([partKey(key, parts.length), serialized.slice(offset, offset + CHUNK_CHARS)]);
  }
  const manifest: ChunkManifest = {
    __chunks: parts.length,
    bytes: approxBytes(serialized),
    cachedAt,
  };
  return [[key, JSON.stringify(manifest)], ...parts];
}

/** multiSet is one SQLite transaction — the manifest and its parts land together. */
async function writeEntry(key: string, rows: [string, string][]) {
  await AsyncStorage.multiSet(rows);
  // Drop parts left over from a previous, longer value of this key.
  const written = new Set(rows.map(([rowKey]) => rowKey));
  const stale = partsOf(key, await AsyncStorage.getAllKeys()).filter(
    (part) => !written.has(part),
  );
  if (stale.length > 0) {
    await AsyncStorage.multiRemove(stale);
  }
}

export async function writeCache<T>(namespace: string, id: string | undefined, value: T): Promise<void> {
  const key = cacheKey(namespace, id);
  const cachedAt = new Date().toISOString();

  let serialized: string;
  try {
    serialized = JSON.stringify({
      value,
      cachedAt,
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
    await removeEntry(key).catch(() => undefined);
    return;
  }

  const rows = entryRows(key, serialized, cachedAt);

  try {
    await writeEntry(key, rows);

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
    await writeEntry(key, rows).catch(() => undefined);
  }
}

/** cachedAt (ms) of a stored entry — envelope or manifest — without a full parse. */
function entryCachedAt(raw: string): number {
  const manifest = parseManifest(raw);
  if (manifest) {
    return Date.parse(manifest.cachedAt) || 0;
  }
  // JSON.stringify({ value, cachedAt }) always ends with the cachedAt field.
  const match = /"cachedAt":"([^"]+)"\}$/.exec(raw.slice(-80));
  return match ? Date.parse(match[1]) || 0 : 0;
}

/** Read entries in small batches; a batch that throws is retried key by key. */
async function readForPrune(keys: string[]) {
  const readable: [string, string | null][] = [];
  const unreadable: string[] = [];

  for (let start = 0; start < keys.length; start += PRUNE_READ_BATCH) {
    const batch = keys.slice(start, start + PRUNE_READ_BATCH);
    try {
      readable.push(...(await AsyncStorage.multiGet(batch)));
    } catch {
      for (const key of batch) {
        try {
          readable.push([key, await AsyncStorage.getItem(key)]);
        } catch {
          unreadable.push(key);
        }
      }
    }
  }

  return { readable, unreadable };
}

/**
 * Evict the oldest read-cache entries (by cachedAt) when the cache exceeds EITHER
 * the entry-count OR the byte budget, down to ~80% of whichever limit(s) it broke.
 * Also always drops unreadable rows and orphaned part rows. Best-effort +
 * fire-and-forget from writeCache; only touches the CACHE_PREFIX keys, NEVER the
 * offline write-queue (a different key prefix = durable field work).
 */
async function pruneCacheIfNeeded(byteBudget: number = MAX_CACHE_BYTES): Promise<void> {
  try {
    const cacheKeys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(CACHE_PREFIX),
    );
    if (cacheKeys.length === 0) {
      return;
    }

    const entryKeys = cacheKeys.filter((key) => !key.includes(PART_MARKER));
    const entrySet = new Set(entryKeys);
    const toRemove = cacheKeys.filter(
      (key) => key.includes(PART_MARKER) && !entrySet.has(key.slice(0, key.indexOf(PART_MARKER))),
    );

    const { readable, unreadable } = await readForPrune(entryKeys);
    for (const key of unreadable) {
      toRemove.push(key, ...partsOf(key, cacheKeys));
    }

    let totalBytes = 0;
    const dated = readable.map(([key, raw]) => {
      const manifest = raw ? parseManifest(raw) : null;
      const bytes = manifest ? manifest.bytes : raw ? approxBytes(raw) : 0;
      totalBytes += bytes;
      return { key, cachedAt: raw ? entryCachedAt(raw) : 0, bytes };
    });

    // Evict only while over EITHER limit.
    if (dated.length > MAX_CACHE_ENTRIES || totalBytes > byteBudget) {
      dated.sort((a, b) => a.cachedAt - b.cachedAt); // oldest first

      const entryTarget = Math.floor(MAX_CACHE_ENTRIES * EVICT_TO_RATIO);
      const byteTarget = Math.floor(byteBudget * EVICT_TO_RATIO);
      let remainingCount = dated.length;
      let remainingBytes = totalBytes;

      // Evict oldest-first until BOTH the count and byte budgets are satisfied.
      for (const entry of dated) {
        if (remainingCount <= entryTarget && remainingBytes <= byteTarget) {
          break;
        }
        toRemove.push(entry.key, ...partsOf(entry.key, cacheKeys));
        remainingCount -= 1;
        remainingBytes -= entry.bytes;
      }
    }

    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch {
    // best-effort — eviction failing must never surface
  }
}

/**
 * Emergency shrink when a DURABLE write (the sync queue, maintenance overlay) hit
 * SQLITE_FULL: evict the oldest read-cache entries down to a small budget so the
 * freed SQLite pages can take the durable write. Keeps the newest ~6MB so the
 * crew's current Pencawang still renders offline. Everything evicted is
 * re-fetchable; the durable work is not.
 */
export async function freeReadCacheSpace(): Promise<void> {
  await pruneCacheIfNeeded(EMERGENCY_CACHE_BYTES);
}

export async function removeCache(namespace: string, id?: string): Promise<void> {
  try {
    await removeEntry(cacheKey(namespace, id));
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
