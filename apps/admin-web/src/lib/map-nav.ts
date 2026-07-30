/**
 * Hand-off from an asset's full page to the Asset Map ("Show on Map").
 *
 * The map remembers its view in sessionStorage (drill + filters + open panel)
 * so a round-trip to a pole's page comes back to the same place. This module
 * owns that storage key and lets OTHER pages write a focus target into it:
 * drill straight to the pole's Pencawang, clear the filters (a remembered
 * filter could hide the pole), and ask the map to open that pole's panel once
 * its points load. The map page reads it on mount exactly like its own
 * remembered view — no URL contract needed.
 */

export const MAP_VIEW_STORAGE_KEY = "ascure.map.view";

/**
 * Same hand-off at the Pencawang level ("Show on Map" on the Site Visit page):
 * drill straight to the visit's Pencawang with filters cleared, but no pole
 * panel — the map lands on the Pencawang's points view.
 */
export function focusPencawangOnMap(target: {
  pencawangId: string;
  pencawangName: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      MAP_VIEW_STORAGE_KEY,
      JSON.stringify({
        drill: {
          pencawang: { id: target.pencawangId, name: target.pencawangName },
        },
        // Empty object on purpose: the map merges over its filter defaults, so
        // this resets any remembered filters that could hide the poles.
        filters: {},
        showAllPoles: false,
        selectedId: null,
      }),
    );
  } catch {
    // A full / blocked sessionStorage must never break navigation — the map
    // simply opens on its remembered (or top-level) view instead.
  }
}

export function focusAssetOnMap(target: {
  assetId: string;
  pencawangId: string;
  pencawangName: string;
}): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      MAP_VIEW_STORAGE_KEY,
      JSON.stringify({
        drill: {
          pencawang: { id: target.pencawangId, name: target.pencawangName },
        },
        // Empty object on purpose: the map merges over its filter defaults, so
        // this resets any remembered filters that could exclude the pole.
        filters: {},
        showAllPoles: false,
        selectedId: target.assetId,
      }),
    );
  } catch {
    // A full / blocked sessionStorage must never break navigation — the map
    // simply opens on its remembered (or top-level) view instead.
  }
}
