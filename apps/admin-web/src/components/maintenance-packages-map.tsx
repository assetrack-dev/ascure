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
}

interface PackagesMapProps {
  points: PackageMapPoint[];
  /** Drag-a-box mode: map panning is off and a drag selects everything inside. */
  boxMode: boolean;
  onToggle: (id: string) => void;
  onBoxSelect: (ids: string[]) => void;
}

const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };

// Hundreds of PEs render fine as raw markers; past this the clusterer takes over
// so the tab never places thousands at once (same lesson as the asset map).
const CLUSTER_ABOVE = 600;

// Raster SVG icons (not google.maps.Symbol) keep marker optimisation on — see
// google-asset-map.tsx. Cached by (colour, selected, digits).
const iconCache = new Map<string, google.maps.Icon>();
function markerIcon(color: string, selected: boolean, digits: number): google.maps.Icon {
  const key = `${color}|${selected ? 1 : 0}|${digits}`;
  const cached = iconCache.get(key);
  if (cached) return cached;
  const size = (digits > 2 ? 34 : 28) + (selected ? 6 : 0);
  const c = size / 2;
  const ring = selected
    ? `<circle cx='${c}' cy='${c}' r='${c - 1.5}' fill='none' stroke='#0f172a' stroke-width='3'/>`
    : "";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${c - (selected ? 5 : 1.5)}' fill='${color}' stroke='#ffffff' stroke-width='2'/>` +
    ring +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
    labelOrigin: new google.maps.Point(c, c),
  };
  iconCache.set(key, icon);
  return icon;
}

function Layers({ points, boxMode, onToggle, onBoxSelect }: PackagesMapProps) {
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
      const label = {
        text: String(point.openCount),
        color: "#ffffff",
        fontSize: "11px",
        fontWeight: "700",
      };
      const icon = markerIcon(point.color, point.selected, String(point.openCount).length);
      const existing = markers.get(point.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setLabel(label);
        existing.setTitle(point.title);
        existing.setZIndex(point.selected ? 2 : 1);
        continue;
      }
      const marker = new google.maps.Marker({
        position: { lat: point.latitude, lng: point.longitude },
        icon,
        label,
        title: point.title,
        zIndex: point.selected ? 2 : 1,
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
          <Layers {...rest} />
        </GoogleMap>
      </APIProvider>
      <button
        type="button"
        onClick={() => setMapType((current) => (current === "hybrid" ? "roadmap" : "hybrid"))}
        className="absolute left-3 top-3 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
      >
        {mapType === "hybrid" ? "Map" : "Satellite"}
      </button>
    </div>
  );
}
