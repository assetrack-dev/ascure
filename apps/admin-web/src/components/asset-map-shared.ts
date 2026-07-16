import type { MutableRefObject } from "react";
import type { MapAsset, MapColorMode, MapViewMode } from "@/lib/map";

/** Imperative handle a renderer exposes so the chrome's zoom box can drive it. */
export interface MapControls {
  zoomIn(): void;
  zoomOut(): void;
  recenter(): void;
  /** Current viewport as "minLng,minLat,maxLng,maxLat", or null if unavailable.
   *  Used to seed the Mainhead-wide "show all poles" viewport query. Optional —
   *  only the hierarchical (Google) renderer implements it. */
  getBounds?(): string | null;
}

/** The contract both the Google and Leaflet renderers implement. */
export interface AssetMapProps {
  assets: MapAsset[];
  colorMode: MapColorMode;
  viewMode: MapViewMode;
  /** Lifted selection — the in-view list and the map stay in sync. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Fires on pan/zoom with the ids currently inside the viewport. */
  onVisibleChange?: (visibleIds: string[]) => void;
  /** Populated by the renderer so the chrome can call zoom in/out/recenter. */
  controlsRef?: MutableRefObject<MapControls | null>;
}
