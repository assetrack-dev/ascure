import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { freeReadCacheSpace } from './offlineCache';

// Keeps the phone (and the AsyncStorage SQLite DB) from filling up in the field.
//
// SQLITE_FULL[13] "database or disk is full" has two causes on a crew phone:
//  1. the AsyncStorage DB hit its size cap (gradle.properties) — bounded by the
//     read-cache eviction in offlineCache.ts;
//  2. the PHONE's storage is full — SQLite can't grow its file. The big leak
//     here was our own: expo-camera writes every full-size capture to
//     <cache>/Camera/ and nothing ever deleted it (a few MB per photo, hundreds
//     of photos a day). The stamped copy is what we upload; the raw capture is
//     dead weight once the photo is taken. sweepTempPhotoFiles() clears it.
//
// setItemWithRecovery() is for DURABLE writes (the sync queue, the maintenance
// overlay): on SQLITE_FULL it frees space (read-cache + temp photos) and retries
// before failing with a message the crew can act on.

// Native modules that write into the app cache dir and never clean up after
// themselves. (react-native-view-shot cleans its own snapshots on app start.)
const TEMP_PHOTO_DIRS = ['Camera/', 'ImageManipulator/'];

// At cold start no screen holds a photo in memory, so anything older than this
// that no durable store references is garbage.
const STARTUP_SWEEP_MIN_AGE_MS = 12 * 60 * 60 * 1000;
// Mid-session (a write just failed) a form may still be holding a recent
// capture — only take files well past any plausible open form.
const RECOVERY_SWEEP_MIN_AGE_MS = 2 * 60 * 60 * 1000;

const CACHE_KEY_PREFIX = '@ascure/mobile/cache/';
const LOW_DISK_BYTES = 300 * 1024 * 1024;

export function isStorageFullError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /SQLITE_FULL|database or disk is full|disk is full|ENOSPC|No space left/i.test(message);
}

// Android's CursorWindow can't READ a single row over 2MB ("Row too big to fit
// into CursorWindow") even though the write succeeded. The offline queue is one
// value (~15KB per queued inspection), so a crew offline for a few days crossed
// 2MB and the queue became unreadable — nothing could enqueue or sync. Durable
// values are therefore split across rows: the key holds a small manifest and the
// text lives in `<key>#part/<n>` rows written in ONE multiSet (one SQLite
// transaction — all rows land or none do).
const DURABLE_CHUNK_CHARS = 512 * 1024; // ≤1.5MB even if every char were 3-byte UTF-8
const PART_MARKER = '#part/';

type DurableManifest = {
  __chunks: number;
  length: number;
};

function partKey(key: string, index: number) {
  return `${key}${PART_MARKER}${index}`;
}

function parseDurableManifest(raw: string): DurableManifest | null {
  if (!raw.startsWith('{"__chunks"')) return null;
  try {
    const manifest = JSON.parse(raw) as DurableManifest;
    return typeof manifest.__chunks === 'number' && typeof manifest.length === 'number'
      ? manifest
      : null;
  } catch {
    return null;
  }
}

/**
 * Read a value written by writeDurable (or a legacy single-row value). THROWS
 * when it can't be read whole — the caller must never mistake an unreadable
 * queue for an empty one and overwrite it.
 */
export async function readDurable(key: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  const manifest = parseDurableManifest(raw);
  if (!manifest) return raw; // legacy single row

  const partKeys = Array.from({ length: manifest.__chunks }, (_, index) => partKey(key, index));
  const parts = new Map(await AsyncStorage.multiGet(partKeys));
  const pieces = partKeys.map((part) => parts.get(part));
  if (pieces.some((piece) => piece == null)) {
    throw new Error(`Stored data "${key}" is incomplete (missing parts).`);
  }

  const value = pieces.join('');
  if (value.length !== manifest.length) {
    throw new Error(`Stored data "${key}" is incomplete (length mismatch).`);
  }
  return value;
}

/** Durable write: split if large, free space + retry on SQLITE_FULL, fail loud. */
export async function writeDurable(key: string, value: string): Promise<void> {
  const rows: [string, string][] = [];
  if (value.length <= DURABLE_CHUNK_CHARS) {
    rows.push([key, value]);
  } else {
    const parts: [string, string][] = [];
    for (let offset = 0; offset < value.length; offset += DURABLE_CHUNK_CHARS) {
      parts.push([partKey(key, parts.length), value.slice(offset, offset + DURABLE_CHUNK_CHARS)]);
    }
    const manifest: DurableManifest = { __chunks: parts.length, length: value.length };
    rows.push([key, JSON.stringify(manifest)], ...parts);
  }

  await multiSetWithRecovery(rows);

  // Parts beyond the new count are unreachable (the manifest says how many);
  // removing them only reclaims space, so it's best-effort.
  try {
    const written = new Set(rows.map(([rowKey]) => rowKey));
    const stale = (await AsyncStorage.getAllKeys()).filter(
      (candidate) => candidate.startsWith(`${key}${PART_MARKER}`) && !written.has(candidate),
    );
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch {
    // ignore
  }
}

/**
 * Every non-cache AsyncStorage value as one string (split values reassembled),
 * so a file the sync queue (or any other durable store) still points at is never
 * swept. Null when anything can't be read — the caller must then sweep nothing.
 */
async function loadDurableReferences(): Promise<string | null> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(
      (key) => !key.startsWith(CACHE_KEY_PREFIX) && !key.includes(PART_MARKER),
    );
    const values: string[] = [];
    for (const key of keys) {
      values.push((await readDurable(key)) ?? '');
    }
    return values.join('\n');
  } catch {
    return null;
  }
}

/**
 * Delete temp photo files the native camera / image manipulator left in the app
 * cache dir. Skips anything younger than minAgeMs and anything a durable store
 * still references (e.g. an offline queued photo whose durable copy failed).
 */
export async function sweepTempPhotoFiles(
  minAgeMs: number = STARTUP_SWEEP_MIN_AGE_MS,
): Promise<{ deleted: number; freedBytes: number }> {
  const result = { deleted: 0, freedBytes: 0 };
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) return result;

  const references = await loadDurableReferences();
  if (references === null) return result;

  const cutoffSeconds = (Date.now() - minAgeMs) / 1000;

  for (const dir of TEMP_PHOTO_DIRS) {
    const dirUri = `${cacheDirectory}${dir}`;
    let names: string[];
    try {
      names = await FileSystem.readDirectoryAsync(dirUri);
    } catch {
      continue; // directory doesn't exist yet
    }

    for (const name of names) {
      if (references.includes(name)) continue;
      const uri = `${dirUri}${name}`;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || info.isDirectory) continue;
        if (info.modificationTime > cutoffSeconds) continue;
        await FileSystem.deleteAsync(uri, { idempotent: true });
        result.deleted += 1;
        result.freedBytes += info.size ?? 0;
      } catch {
        // best-effort — one stuck file must not stop the sweep
      }
    }
  }

  return result;
}

/** Free what we safely can after a SQLITE_FULL: read-cache rows + stale temp photos. */
export async function recoverStorageSpace(): Promise<void> {
  await freeReadCacheSpace();
  await sweepTempPhotoFiles(RECOVERY_SWEEP_MIN_AGE_MS).catch(() => undefined);
}

/** What the crew should do when storage is still full after recovery. */
export async function storageFullMessage(): Promise<string> {
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);

  if (freeBytes !== null && freeBytes < LOW_DISK_BYTES) {
    return (
      `Phone storage is full (${Math.round(freeBytes / (1024 * 1024))} MB free). ` +
      'Delete old videos, photos or WhatsApp media, then tap Save again. ' +
      'Your unsynced work is safe — do NOT clear the ASCURE app data.'
    );
  }

  return (
    'ASCURE offline storage is full. Get signal and tap Save again — it saves ' +
    'straight to the server. Your unsynced work is safe — do NOT clear the ASCURE app data.'
  );
}

/**
 * setItem for durable field work. On SQLITE_FULL: free space and retry; any other
 * failure: retry once after a short delay (write contention). A failure that
 * survives that throws — durable work must fail loud, never silently drop — and a
 * storage-full one throws the actionable message instead of the raw SQLite text.
 */
export async function setItemWithRecovery(key: string, value: string): Promise<void> {
  await multiSetWithRecovery([[key, value]]);
}

async function multiSetWithRecovery(rows: [string, string][]): Promise<void> {
  try {
    await AsyncStorage.multiSet(rows);
    return;
  } catch (error) {
    if (isStorageFullError(error)) {
      await recoverStorageSpace();
    } else {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  try {
    await AsyncStorage.multiSet(rows);
  } catch (error) {
    if (isStorageFullError(error)) {
      throw new Error(await storageFullMessage());
    }
    throw error;
  }
}
