"use client";

import { useEffect, useRef, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

/** One Pencawang on the assign map (docs/PLAN-maintenance-flow.md §12.4). */
export interface PackageMapPoint {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  openCount: number;
  color: string;
  selected: boolean;
  /** Matches the search box — drawn with a blue halo. */
  highlighted?: boolean;
  /** Text on the marker (default: the open count) — plan §15 shows done/total. */
  label?: string;
  /** Hollow marker: work with no team yet. */
  hollow?: boolean;
  /** Faded: outside the focus team. */
  dimmed?: boolean;
  /** 0–1 share closed, drawn as a green arc around the marker. */
  progress?: number;
}

interface PackagesMapProps {
  points: PackageMapPoint[];
  /** Drag-a-box mode: map panning is off and a drag selects everything inside. */
  boxMode: boolean;
  onToggle: (id: string) => void;
  onBoxSelect: (ids: string[]) => void;
  /**
   * Search matches to fly to. The map zooms to them when the set changes and
   * STAYS there when it empties (clearing the search keeps the view), so the
   * neighbouring Pencawang remain in sight.
   */
  focusIds?: string[];
}

const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };

// Hundreds of PEs render fine as raw markers; past this the clusterer takes over
// so the tab never places thousands at once (same lesson as the asset map).
const CLUSTER_ABOVE = 600;

// Raster SVG icons (not google.maps.Symbol) keep marker optimisation on — see
// google-asset-map.tsx. Cached by (colour, selected, digits).
const iconCache = new Map<string, google.maps.Icon>();
function markerIcon(
  color: string,
  selected: boolean,
  digits: number,
  highlighted = false,
  options: { hollow?: boolean; dimmed?: boolean; progress?: number } = {},
): google.maps.Icon {
  const tenths = options.progress === undefined ? -1 : Math.round(options.progress * 10);
  const key = `${color}|${selected ? 1 : 0}|${digits}|${highlighted ? 1 : 0}|${options.hollow ? 1 : 0}|${options.dimmed ? 1 : 0}|${tenths}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const halo = highlighted ? 8 : 0;
  const arc = tenths >= 0 ? 4 : 0;
  const size = Math.min(56, Math.max(28, 12 + digits * 6)) + (selected ? 6 : 0) + halo * 2 + arc * 2;
  const c = size / 2;
  const body = c - halo - arc - (selected ? 5 : 1.5);
  const haloRing = highlighted
    ? `<circle cx='${c}' cy='${c}' r='${c - 2}' fill='#2563eb' fill-opacity='0.25' stroke='#2563eb' stroke-width='3'/>`
    : "";
  const ring = selected
    ? `<circle cx='${c}' cy='${c}' r='${c - halo - arc - 1.5}' fill='none' stroke='#0f172a' stroke-width='3'/>`
    : "";
  // % closed: a green arc on a white track, clockwise from 12 o'clock.
  const arcRadius = c - halo - arc / 2 - 0.5;
  const circumference = 2 * Math.PI * arcRadius;
  const progressArc =
    tenths >= 0
      ? `<circle cx='${c}' cy='${c}' r='${arcRadius}' fill='none' stroke='#ffffff' stroke-opacity='0.85' stroke-width='${arc}'/>` +
        (tenths > 0
          ? `<circle cx='${c}' cy='${c}' r='${arcRadius}' fill='none' stroke='#16a34a' stroke-width='${arc}' stroke-dasharray='${((tenths / 10) * circumference).toFixed(1)} ${circumference.toFixed(1)}' transform='rotate(-90 ${c} ${c})'/>`
          : "")
      : "";
  const bodyCircle = options.hollow
    ? `<circle cx='${c}' cy='${c}' r='${body - 1}' fill='#ffffff' stroke='${color}' stroke-width='3.5'/>`
    : `<circle cx='${c}' cy='${c}' r='${body}' fill='${color}' stroke='#ffffff' stroke-width='2'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<g opacity='${options.dimmed ? 0.35 : 1}'>` +
    haloRing +
    progressArc +
    bodyCircle +
    ring +
    `</g></svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
    labelOrigin: new google.maps.Point(c, c),
  };
  iconCache.set(key, icon);
  return icon;
}

function Layers({
  points,
  boxMode,
  onToggle,
  onBoxSelect,
  focusIds,
  fitAllSignal,
}: PackagesMapProps & { fitAllSignal: number }) {
  const map = useMap();
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const didFitRef = useRef("");
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const onBoxSelectRef = useRef(onBoxSelect);
  onBoxSelectRef.current = onBoxSelect;

  // Rebuild markers when the point set changes; restyle in place otherwise.
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const point of points) {
      seen.add(point.id);
      const text = point.label ?? String(point.openCount);
      const label = {
        text,
        color: point.hollow ? "#0f172a" : "#ffffff",
        fontSize: text.length > 4 ? "10px" : "11px",
        fontWeight: "700",
      };
      const icon = markerIcon(point.color, point.selected, text.length, point.highlighted, {
        hollow: point.hollow,
        dimmed: point.dimmed,
        progress: point.progress,
      });
      const existing = markers.get(point.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setLabel(label);
        existing.setTitle(point.title);
        existing.setZIndex(point.highlighted ? 3 : point.selected ? 2 : 1);
        continue;
      }
      const marker = new google.maps.Marker({
        position: { lat: point.latitude, lng: point.longitude },
        icon,
        label,
        title: point.title,
        zIndex: point.highlighted ? 3 : point.selected ? 2 : 1,
      });
      marker.addListener("click", () => onToggleRef.current(point.id));
      markers.set(point.id, marker);
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.setMap(null);
        clustererRef.current?.removeMarker(marker, true);
        markers.delete(id);
      }
    }

    const all = [...markers.values()];
    if (all.length > CLUSTER_ABOVE) {
      if (!clustererRef.current) {
        clustererRef.current = new MarkerClusterer({ map });
      }
      clustererRef.current.clearMarkers(true);
      clustererRef.current.addMarkers(all);
    } else {
      clustererRef.current?.clearMarkers(true);
      clustererRef.current = null;
      for (const marker of all) {
        if (marker.getMap() !== map) marker.setMap(map);
      }
    }
  }, [map, points]);

  // Unmount: drop every marker.
  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      clustererRef.current?.clearMarkers();
      for (const marker of markers.values()) marker.setMap(null);
      markers.clear();
    };
  }, []);

  // Fit to the PEs only when the membership changes (not on every restyle).
  useEffect(() => {
    if (!map || points.length === 0) return;
    const key = points.map((point) => point.id).sort().join("|");
    if (didFitRef.current === key) return;
    didFitRef.current = key;
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend({ lat: point.latitude, lng: point.longitude }));
    map.fitBounds(bounds, 60);
    const listener = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 16) map.setZoom(16);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map, points]);

  // Fly to the search matches (debounced so typing doesn't jitter the map).
  // An empty set does nothing — the view stays where the last search left it.
  const focusKey = (focusIds ?? []).slice().sort().join("|");
  useEffect(() => {
    if (!map || !focusKey) return;
    const timer = window.setTimeout(() => {
      const ids = new Set(focusKey.split("|"));
      const targets = pointsRef.current.filter((point) => ids.has(point.id));
      if (targets.length === 0) return;
      if (targets.length === 1) {
        map.panTo({ lat: targets[0].latitude, lng: targets[0].longitude });
        if ((map.getZoom() ?? 0) < 15) map.setZoom(15);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      targets.forEach((point) => bounds.extend({ lat: point.latitude, lng: point.longitude }));
      map.fitBounds(bounds, 80);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [map, focusKey]);

  // "Show all" — zoom back out to every Pencawang on the map.
  useEffect(() => {
    if (!map || fitAllSignal === 0 || pointsRef.current.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    pointsRef.current.forEach((point) => bounds.extend({ lat: point.latitude, lng: point.longitude }));
    map.fitBounds(bounds, 60);
  }, [map, fitAllSignal]);

  // Box select: with panning off, a drag draws a rectangle; release selects
  // every PE inside it (added to the current selection).
  useEffect(() => {
    if (!map || !boxMode) return;
    map.setOptions({ draggable: false, draggableCursor: "crosshair" });
    let start: google.maps.LatLng | null = null;
    let rect: google.maps.Rectangle | null = null;

    const finish = () => {
      if (rect) {
        const bounds = rect.getBounds();
        rect.setMap(null);
        rect = null;
        if (bounds) {
          onBoxSelectRef.current(
            pointsRef.current
              .filter((point) => bounds.contains({ lat: point.latitude, lng: point.longitude }))
              .map((point) => point.id),
          );
        }
      }
      start = null;
    };

    const listeners = [
      map.addListener("mousedown", (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        start = event.latLng;
        rect = new google.maps.Rectangle({
          map,
          bounds: new google.maps.LatLngBounds(start, start),
          strokeColor: "#2563eb",
          strokeWeight: 2,
          fillColor: "#2563eb",
          fillOpacity: 0.12,
          clickable: false,
        });
      }),
      map.addListener("mousemove", (event: google.maps.MapMouseEvent) => {
        if (!start || !rect || !event.latLng) return;
        rect.setBounds(
          new google.maps.LatLngBounds(
            {
              lat: Math.min(start.lat(), event.latLng.lat()),
              lng: Math.min(start.lng(), event.latLng.lng()),
            },
            {
              lat: Math.max(start.lat(), event.latLng.lat()),
              lng: Math.max(start.lng(), event.latLng.lng()),
            },
          ),
        );
      }),
      map.addListener("mouseup", finish),
    ];

    return () => {
      listeners.forEach((listener) => listener.remove());
      rect?.setMap(null);
      map.setOptions({ draggable: true, draggableCursor: null });
    };
  }, [map, boxMode]);

  return null;
}

/** Google satellite map of Pencawang for multi-select assignment. */
export default function MaintenancePackagesMap({
  apiKey,
  onLoadError,
  ...rest
}: PackagesMapProps & { apiKey: string; onLoadError?: () => void }) {
  const [mapType, setMapType] = useState<"hybrid" | "roadmap">("hybrid");
  const [fitAllSignal, setFitAllSignal] = useState(0);

  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => onLoadError?.();
    return () => {
      window.gm_authFailure = prev;
    };
  }, [onLoadError]);

  return (
    <div className="relative h-full w-full">
      <APIProvider apiKey={apiKey} onError={() => onLoadError?.()}>
        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={7}
          mapTypeId={mapType}
          gestureHandling="greedy"
          clickableIcons={false}
          disableDefaultUI
          zoomControl
          style={{ width: "100%", height: "100%" }}
        >
          <Layers {...rest} fitAllSignal={fitAllSignal} />
        </GoogleMap>
      </APIProvider>
      <button
        type="button"
        onClick={() => setMapType((current) => (current === "hybrid" ? "roadmap" : "hybrid"))}
        className="absolute left-3 top-3 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        {mapType === "hybrid" ? "Map" : "Satellite"}
      </button>
      <button
        type="button"
        onClick={() => setFitAllSignal((count) => count + 1)}
        className="absolute left-3 top-12 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        Show all
      </button>
    </div>
  );
}
