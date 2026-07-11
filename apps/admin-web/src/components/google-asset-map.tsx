"use client";

import { useEffect, useRef } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { AssetMapProps } from "@/components/asset-map-shared";
import {
  formatMaintenanceCategory,
  isMapAssetInspected,
  mapAssetDefectState,
  mapAssetMarkerColor,
  type MapAsset,
} from "@/lib/map";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };

// Above this many individual markers, Pins mode routes through the clusterer so
// the renderer never places thousands of markers at once (that froze the tab at
// ~2.3k assets). Below it, Pins shows raw individual markers.
const PIN_LIMIT = 1000;

// A colour-by-state circle icon rendered as a tiny SVG data-URI — a RASTER icon,
// NOT a google.maps.Symbol. Symbol icons disable Google's marker optimisation, so
// every marker gets its own <canvas>; at ~2.3k assets that's ~2.3k canvases and
// the tab freezes. A url icon keeps optimisation on (markers batch onto a few
// shared canvases). Icons are cached by (colour, selected) — ~12 distinct total.
const iconCache = new Map<string, google.maps.Icon>();
function markerIcon(
  asset: MapAsset,
  colorMode: AssetMapProps["colorMode"],
  selected: boolean,
): google.maps.Icon {
  const color = mapAssetMarkerColor(asset, colorMode);
  const key = `${color}|${selected ? 1 : 0}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const size = selected ? 22 : 15;
  const stroke = selected ? "#2563eb" : "#ffffff";
  const sw = selected ? 3 : 1.5;
  const c = size / 2;
  const r = c - sw;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${r}' fill='${color}' stroke='${stroke}' stroke-width='${sw}'/></svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
  };
  iconCache.set(key, icon);
  return icon;
}

function infoHtml(asset: MapAsset): string {
  const rows: string[] = [];
  const add = (label: string, value: string) =>
    rows.push(`<div style="display:flex;gap:6px;font-size:12px;line-height:18px"><span style="color:#64748b;min-width:64px">${label}</span><span style="color:#0f172a">${value}</span></div>`);
  if (asset.assetType) add("Type", asset.assetType.name);
  if (asset.substation) add("Pencawang", asset.substation.name);
  if (asset.mainhead) add("Mainhead", asset.mainhead.name);
  if (asset.team) add("Team", asset.team.name);
  add("Status", isMapAssetInspected(asset) ? "Inspected" : "Not inspected");
  if (asset.openDefectCount > 0) {
    add("Defects", `${asset.openDefectCount} open${asset.hasEmergencyDefect ? " · emergency" : ""}`);
    if (asset.defectCategories.length > 0) {
      add("Category", asset.defectCategories.map(formatMaintenanceCategory).join(", "));
    }
  }
  const href = `/assets/${encodeURIComponent(asset.id)}?from=${encodeURIComponent("/map")}`;
  return `<div style="min-width:180px;font-family:system-ui,sans-serif">
    <div style="font-weight:700;font-size:14px;color:#0f172a">${asset.assetCode}</div>
    ${asset.name ? `<div style="font-size:12px;color:#475569;margin-bottom:4px">${asset.name}</div>` : ""}
    <div style="margin-top:4px;display:grid;gap:2px">${rows.join("")}</div>
    <a href="${href}" style="display:inline-block;margin-top:8px;font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">Open asset →</a>
  </div>`;
}

function Layers({ assets, colorMode, viewMode, selectedId, onSelect, onVisibleChange, controlsRef }: AssetMapProps) {
  const map = useMap();
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  // `visualization` library types aren't bundled with @types/google.maps; type
  // the heat layer by the one method we call.
  const heatRef = useRef<{ setMap(map: google.maps.Map | null): void } | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const didFitRef = useRef<string>("");

  const assetsRef = useRef(assets);
  const onSelectRef = useRef(onSelect);
  const onVisibleRef = useRef(onVisibleChange);
  const selectedIdRef = useRef(selectedId);
  const prevSelectedRef = useRef<string | null>(null);
  assetsRef.current = assets;
  onSelectRef.current = onSelect;
  onVisibleRef.current = onVisibleChange;
  selectedIdRef.current = selectedId;

  // Bounds → in-view ids, plus imperative zoom controls.
  useEffect(() => {
    if (!map) return;
    const emit = () => {
      const bounds = map.getBounds();
      if (!bounds || !onVisibleRef.current) return;
      const ids: string[] = [];
      for (const asset of assetsRef.current) {
        if (bounds.contains({ lat: asset.latitude, lng: asset.longitude })) ids.push(asset.id);
      }
      onVisibleRef.current(ids);
    };
    const listener = map.addListener("idle", emit);
    if (controlsRef) {
      controlsRef.current = {
        zoomIn: () => map.setZoom((map.getZoom() ?? 7) + 1),
        zoomOut: () => map.setZoom((map.getZoom() ?? 7) - 1),
        recenter: () => {
          const list = assetsRef.current;
          if (list.length === 0) return;
          const bounds = new google.maps.LatLngBounds();
          list.forEach((a) => bounds.extend({ lat: a.latitude, lng: a.longitude }));
          map.fitBounds(bounds, 60);
        },
      };
    }
    return () => {
      google.maps.event.removeListener(listener);
      if (controlsRef) controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Build the marker / cluster / heat layer for the current view.
  useEffect(() => {
    if (!map) return;

    // Tear down previous layers.
    for (const marker of markersRef.current.values()) marker.setMap(null);
    markersRef.current.clear();
    clustererRef.current?.clearMarkers();
    clustererRef.current = null;
    if (heatRef.current) {
      heatRef.current.setMap(null);
      heatRef.current = null;
    }

    if (viewMode === "heat") {
      // HeatmapLayer is a deprecated visualization-library class and throws on
      // some Maps builds. Guard it so a failure degrades to pins instead of
      // white-screening the map; the Leaflet renderer keeps a native heat layer.
      const viz = (google.maps as unknown as { visualization?: { HeatmapLayer?: new (opts: unknown) => { setMap(map: google.maps.Map | null): void } } }).visualization;
      if (viz?.HeatmapLayer) {
        try {
          const points = assets.map((a) => ({
            location: new google.maps.LatLng(a.latitude, a.longitude),
            weight: a.hasEmergencyDefect ? 1 : a.openDefectCount > 0 ? 0.7 : 0.4,
          }));
          heatRef.current = new viz.HeatmapLayer({ data: points, radius: 26, opacity: 0.7 });
          heatRef.current.setMap(map);
          return;
        } catch {
          heatRef.current = null;
          // fall through to pins
        }
      }
      // No heat support → render pins so the view is never blank.
    }

    const markers: google.maps.Marker[] = [];
    for (const asset of assets) {
      const marker = new google.maps.Marker({
        position: { lat: asset.latitude, lng: asset.longitude },
        icon: markerIcon(asset, colorMode, asset.id === selectedIdRef.current),
        title: asset.assetCode,
        optimized: true,
      });
      marker.addListener("click", () => onSelectRef.current(asset.id));
      markersRef.current.set(asset.id, marker);
      markers.push(marker);
    }

    // Cluster in Clusters mode, and also when Pins would place too many markers
    // at once — thousands of individual markers freeze the renderer.
    if (viewMode === "clusters" || markers.length > PIN_LIMIT) {
      clustererRef.current = new MarkerClusterer({ map, markers });
    } else {
      for (const marker of markers) marker.setMap(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, assets, colorMode, viewMode]);

  // Selection restyle — update only the affected markers, never rebuild all.
  // (Rebuilding every marker on each selection is what stalled the map.)
  useEffect(() => {
    const markers = markersRef.current;
    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedId) {
      const marker = markers.get(prev);
      const asset = assetsRef.current.find((a) => a.id === prev);
      if (marker && asset) marker.setIcon(markerIcon(asset, colorMode, false));
    }
    if (selectedId) {
      const marker = markers.get(selectedId);
      const asset = assetsRef.current.find((a) => a.id === selectedId);
      if (marker && asset) marker.setIcon(markerIcon(asset, colorMode, true));
    }
    prevSelectedRef.current = selectedId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, colorMode]);

  // Fit to the pin set only when the membership changes.
  useEffect(() => {
    if (!map || assets.length === 0) return;
    const key = assets.map((a) => a.id).sort().join("|");
    if (didFitRef.current === key) return;
    didFitRef.current = key;
    const bounds = new google.maps.LatLngBounds();
    assets.forEach((a) => bounds.extend({ lat: a.latitude, lng: a.longitude }));
    map.fitBounds(bounds, 60);
    const listener = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 17) map.setZoom(17);
    });
    return () => google.maps.event.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, assets]);

  // Selection → InfoWindow + pan.
  useEffect(() => {
    if (!map) return;
    if (!infoRef.current) infoRef.current = new google.maps.InfoWindow();
    const info = infoRef.current;
    if (!selectedId) {
      info.close();
      return;
    }
    const asset = assets.find((a) => a.id === selectedId);
    if (!asset) return;
    info.setContent(infoHtml(asset));
    info.setPosition({ lat: asset.latitude, lng: asset.longitude });
    info.open(map);
    map.panTo({ lat: asset.latitude, lng: asset.longitude });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedId]);

  return null;
}

/** Google Maps renderer — legacy markers with raster SVG icons (optimised), clustering, and heatmap. */
export default function GoogleAssetMap({ apiKey, onLoadError, ...rest }: AssetMapProps & { apiKey: string; onLoadError?: () => void }) {
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => onLoadError?.();
    return () => {
      window.gm_authFailure = prev;
    };
  }, [onLoadError]);

  return (
    <div className="h-full w-full">
      <APIProvider apiKey={apiKey} libraries={["visualization"]} onError={() => onLoadError?.()}>
        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={7}
          gestureHandling="greedy"
          clickableIcons={false}
          disableDefaultUI
          style={{ width: "100%", height: "100%" }}
        >
          <Layers {...rest} />
        </GoogleMap>
      </APIProvider>
    </div>
  );
}
