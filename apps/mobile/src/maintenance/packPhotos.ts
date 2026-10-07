import { useCallback, useEffect, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { toAbsoluteUrl } from './maintenanceLocal';
import type { WorkPackageDetail } from './types';

/**
 * Survey + repair photos of a work pack saved to the app's own storage, so the
 * crew still sees them with no signal (docs/PLAN-maintenance-flow.md §14, I28).
 * The image cache (Fresco, ~40 MB) evicts most of a big Pencawang, so photos
 * live as files: one folder per package, file name = hash of the photo URL.
 */

const ROOT = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}ascure-maintenance-photos/` : null;

/** Used for the size estimate when the server does not know a photo's size. */
const ESTIMATED_PHOTO_BYTES = 1_500_000;
const DOWNLOAD_CONCURRENCY = 3;

export type PackPhotoPlan = {
  photos: Array<{ url: string; sizeBytes: number | null }>;
  totalBytes: number;
};

export type PackPhotoResult = { saved: number; alreadySaved: number; failed: number; bytes: number };

function packDirectory(siteVisitId: string) {
  return ROOT ? `${ROOT}${siteVisitId.replace(/[^a-zA-Z0-9_-]/g, '_')}/` : null;
}

/** Stable file name for a photo URL (two 32-bit string hashes + extension). */
export function packPhotoFileName(url: string) {
  const absolute = toAbsoluteUrl(url);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let index = 0; index < absolute.length; index += 1) {
    const code = absolute.charCodeAt(index);
    fnv = Math.imul(fnv ^ code, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + code) >>> 0;
  }
  const extension = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(absolute)?.[1]?.toLowerCase() ?? 'jpg';
  return `${fnv.toString(16).padStart(8, '0')}${djb.toString(16).padStart(8, '0')}.${extension}`;
}

/**
 * What "Save for offline" downloads (I28): every photo on poles with work
 * (pole, survey and repair photos) + the first pole photo on the other poles.
 */
export function planPackPhotos(pack: WorkPackageDetail): PackPhotoPlan {
  const byUrl = new Map<string, number | null>();
  const add = (photo: { url: string; sizeBytes?: number | null }) => {
    if (!photo.url || /^file:/i.test(photo.url) || byUrl.has(photo.url)) return;
    byUrl.set(photo.url, photo.sizeBytes ?? null);
  };
  const workPoleIds = new Set<string>();
  for (const pole of pack.poles) {
    workPoleIds.add(pole.assetId);
    (pole.photos ?? []).forEach(add);
    for (const item of pole.kejanggalan) {
      item.surveyPhotos.forEach(add);
      item.photos.BEFORE.forEach(add);
      item.photos.DURING.forEach(add);
      item.photos.AFTER.forEach(add);
    }
  }
  for (const pole of pack.surveyedPoles ?? []) {
    if (workPoleIds.has(pole.assetId)) continue;
    const first = pole.photos?.[0];
    if (first) add(first);
  }
  const photos = [...byUrl.entries()].map(([url, sizeBytes]) => ({ url, sizeBytes }));
  return {
    photos,
    totalBytes: photos.reduce((sum, photo) => sum + (photo.sizeBytes ?? ESTIMATED_PHOTO_BYTES), 0),
  };
}

export async function downloadPackPhotos(
  siteVisitId: string,
  plan: PackPhotoPlan,
  onProgress: (done: number, total: number) => void,
): Promise<PackPhotoResult> {
  const directory = packDirectory(siteVisitId);
  if (!directory) throw new Error('This phone has no app storage for offline photos.');
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);
  const existing = new Set(await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]));

  const result: PackPhotoResult = { saved: 0, alreadySaved: 0, failed: 0, bytes: 0 };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < plan.photos.length) {
      const photo = plan.photos[next];
      next += 1;
      const name = packPhotoFileName(photo.url);
      const target = `${directory}${name}`;
      if (existing.has(name)) {
        result.alreadySaved += 1;
      } else {
        try {
          const response = await FileSystem.downloadAsync(toAbsoluteUrl(photo.url), target);
          if (response.status >= 200 && response.status < 300) {
            result.saved += 1;
            const info = await FileSystem.getInfoAsync(target);
            if (info.exists && !info.isDirectory) result.bytes += info.size ?? 0;
          } else {
            result.failed += 1;
            await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
          }
        } catch {
          result.failed += 1;
          await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
        }
      }
      done += 1;
      onProgress(done, plan.photos.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, plan.photos.length) }, worker));
  return result;
}

/** Remove saved photos of packages the crew no longer has. */
export async function prunePackPhotos(keepSiteVisitIds: string[]) {
  if (!ROOT) return;
  const keep = new Set(keepSiteVisitIds.map((id) => id.replace(/[^a-zA-Z0-9_-]/g, '_')));
  const folders = await FileSystem.readDirectoryAsync(ROOT).catch(() => [] as string[]);
  await Promise.all(
    folders
      .filter((folder) => !keep.has(folder))
      .map((folder) => FileSystem.deleteAsync(`${ROOT}${folder}`, { idempotent: true }).catch(() => undefined)),
  );
}

/**
 * Resolves a photo URL to its saved file when the package was saved for
 * offline, else to the server URL (local repair photos pass through).
 */
export function usePackPhotos(siteVisitId: string) {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const directory = packDirectory(siteVisitId);
    if (!directory) return;
    const names = await FileSystem.readDirectoryAsync(directory).catch(() => [] as string[]);
    setSaved(new Set(names));
  }, [siteVisitId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resolve = useCallback(
    (url: string) => {
      if (/^file:/i.test(url)) return url;
      const name = packPhotoFileName(url);
      const directory = packDirectory(siteVisitId);
      return directory && saved.has(name) ? `${directory}${name}` : toAbsoluteUrl(url);
    },
    [saved, siteVisitId],
  );

  return { resolve, savedCount: saved.size, refresh };
}

export function formatBytes(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
