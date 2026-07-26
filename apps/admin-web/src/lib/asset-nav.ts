/**
 * Prev/Next pole navigation context for the Asset Detail page.
 *
 * The `/assets/[id]` route only carries a single asset id, so the list pages
 * (Assets, Site Visit Linked Assets, Map, Progress) stash their current
 * ordered id list here (sessionStorage — per-tab, survives client-side
 * navigation) just before opening an asset. The detail page then knows its
 * siblings and can step through them without going back to the list.
 *
 * The context is keyed by the same `from` return path the entry point puts in
 * the URL ("" for the Assets list, which uses no `from`). A detail page only
 * honours a context whose `from` matches its own — this stops a stale list
 * from one page powering Prev/Next on an asset opened from somewhere else.
 */

export type AssetNavContext = {
  ids: string[];
  from: string;
};

const STORAGE_KEY = "ascure.asset-nav";

/** Storage cap — a windowed slice around the opened asset keeps the payload
 *  far below the sessionStorage quota even on a 100k-pole Assets list. */
const MAX_IDS = 5000;

export function storeAssetNavContext(
  ids: string[],
  from: string,
  currentId: string,
): void {
  try {
    let stored = ids;

    if (ids.length > MAX_IDS) {
      const index = Math.max(0, ids.indexOf(currentId));
      const start = Math.max(
        0,
        Math.min(index - Math.floor(MAX_IDS / 2), ids.length - MAX_IDS),
      );
      stored = ids.slice(start, start + MAX_IDS);
    }

    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ids: stored, from }),
    );
  } catch {
    // Best-effort — a full or unavailable storage just means no Prev/Next.
  }
}

export function readAssetNavContext(from: string): AssetNavContext | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AssetNavContext>;

    if (!Array.isArray(parsed.ids) || typeof parsed.from !== "string") {
      return null;
    }

    if (parsed.from !== from) {
      return null;
    }

    const ids = parsed.ids.filter((id): id is string => typeof id === "string");

    return { ids, from: parsed.from };
  } catch {
    return null;
  }
}
