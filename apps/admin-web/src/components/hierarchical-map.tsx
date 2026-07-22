"use client";

import { useEffect, useRef } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import type { MutableRefObject } from "react";
import type { MapControls } from "@/components/asset-map-shared";
import {
  mapAssetMarkerColor,
  pencawangColor,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  type MapAsset,
  type MapBaseType,
  type MapBubble,
  type MapColorMode,
  type PencawangMarker,
} from "@/lib/map";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };

export interface HierarchicalMapProps {
  mode: "bubbles" | "points";
  bubbles: MapBubble[];
  points: MapAsset[];
  colorMode: MapColorMode;
  /** The drilled Pencawang's check-in location (points level only). */
  pencawang?: PencawangMarker | null;
  /** Click a group bubble → drill into it. */
  onDrill: (bubble: MapBubble) => void;
  /** Click an individual pole (leaf level). */
  onSelectPoint: (asset: MapAsset) => void;
  controlsRef?: MutableRefObject<MapControls | null>;
  /** Fires when the Street View panorama opens (true) or closes (false). */
  onStreetViewVisibleChange?: (visible: boolean) => void;
  /** Mainhead-wide "show all poles" overlap view: colour each pole by its
   *  Pencawang (plain dot, no NO-TIANG-RONDAAN label) so a pole among another
   *  Pencawang's cluster stands out. */
  colorByPencawang?: boolean;
  /** Don't auto-fit the camera to the point set — used by the Mainhead-wide view
   *  so a viewport-driven refetch doesn't yank the camera (fit→idle→refetch loop). */
  suppressAutoFit?: boolean;
  /** Fires (on map idle) with the viewport as "minLng,minLat,maxLng,maxLat" so
   *  the parent can refetch the poles in view. */
  onBoundsChange?: (bbox: string) => void;
  /** Fixed per-Pencawang anchor points for the overlap view (server centroids).
   *  Rendered as their own lightweight DOM markers, decoupled from the pole layer
   *  so they don't drift or churn the marker canvas as poles refetch on pan. */
  pencawangAnchors?: PencawangMarker[];
  /** The pole open in the asset panel. Drawn as a halo on its OWN marker layer —
   *  centring alone is easy to lose in a dense cluster. Kept off the pole layer
   *  so changing the selection never rebuilds (and repaints) the pole canvas. */
  selectedPoint?: MapAsset | null;
}

/** Serialize the map viewport as "minLng,minLat,maxLng,maxLat" (or null). */
function boundsToBbox(map: google.maps.Map): string | null {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return `${sw.lng()},${sw.lat()},${ne.lng()},${ne.lat()}`;
}

/** Short count label — 2,268 → "2.3k" so it fits inside the disc. */
function abbreviate(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Bubble fill: defect state wins in defect mode; else inspection completeness. */
function bubbleColor(bubble: MapBubble, mode: MapColorMode): string {
  if (mode === "defect") {
    if (bubble.emergency > 0) return EMERGENCY_DEFECT_MARKER_COLOR;
    if (bubble.openDefects > 0) return OPEN_DEFECT_MARKER_COLOR;
  }
  if (bubble.count > 0 && bubble.inspected >= bubble.count) {
    return INSPECTED_MARKER_COLOR;
  }
  if (bubble.inspected === 0) return NOT_INSPECTED_MARKER_COLOR;
  return "#2563eb";
}

/** Disc grows with the log of the count so 5 and 5,000 stay distinguishable. */
function bubbleSize(count: number): number {
  return 30 + Math.min(34, Math.round(Math.log10(count + 1) * 16));
}

/** Escape XML special chars so DB names are safe inside the SVG <text>. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The count is drawn INTO the SVG (not a google.maps.Marker label) so it is
// always perfectly centred; the group NAME sits in a pill below the disc so the
// user can read what each bubble is at a glance.
const bubbleIconCache = new Map<string, google.maps.Icon>();
function bubbleIcon(
  color: string,
  size: number,
  countLabel: string,
  name: string,
): google.maps.Icon {
  const key = `${color}|${size}|${countLabel}|${name}`;
  const cached = bubbleIconCache.get(key);
  if (cached) return cached;
  const label = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  const nameFs = 11;
  const pillH = 18;
  const gap = 4;
  const pillW = Math.min(200, Math.max(size, label.length * 6.4 + 14));
  const w = Math.max(size, pillW);
  const h = size + gap + pillH;
  const cx = w / 2;
  const discCy = size / 2;
  const r = size / 2 - 2;
  const fs = Math.round(size * 0.34);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<circle cx='${cx}' cy='${discCy}' r='${r}' fill='${color}' fill-opacity='0.92' stroke='#ffffff' stroke-width='2'/>` +
    `<text x='${cx}' y='${discCy}' text-anchor='middle' dominant-baseline='central' font-family='system-ui,sans-serif' font-size='${fs}' font-weight='700' fill='#ffffff'>${countLabel}</text>` +
    `<rect x='${(w - pillW) / 2}' y='${size + gap}' width='${pillW}' height='${pillH}' rx='${pillH / 2}' fill='#0b0e12' fill-opacity='0.82'/>` +
    `<text x='${cx}' y='${size + gap + pillH / 2 + 0.5}' text-anchor='middle' dominant-baseline='central' font-family='system-ui,sans-serif' font-size='${nameFs}' font-weight='600' fill='#ffffff'>${escapeXml(label)}</text>` +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(cx, discCy),
  };
  bubbleIconCache.set(key, icon);
  return icon;
}

// Individual pole dot WITH its NO TIANG RONDAAN drawn beside it (into the SVG,
// same approach as the Pencawang/bubble labels) so the code reads at a glance at
// the pole level without hovering. A translucent dark pill keeps the white text
// legible over the satellite basemap; the dot stays the geographic anchor. Poles
// with no code fall back to a bare dot.
const dotLabelIconCache = new Map<string, google.maps.Icon>();
function dotLabelIcon(color: string, code: string): google.maps.Icon {
  const trimmed = code.trim();
  const key = `${color}|${trimmed}`;
  const cached = dotLabelIconCache.get(key);
  if (cached) return cached;
  const dot = 15;
  const c = dot / 2;
  const r = c - 1.5;

  if (!trimmed) {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='${dot}' height='${dot}'>` +
      `<circle cx='${c}' cy='${c}' r='${r}' fill='${color}' stroke='#ffffff' stroke-width='1.5'/></svg>`;
    const icon: google.maps.Icon = {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(dot, dot),
      anchor: new google.maps.Point(c, c),
    };
    dotLabelIconCache.set(key, icon);
    return icon;
  }

  const label = trimmed.length > 20 ? `${trimmed.slice(0, 19)}…` : trimmed;
  const fs = 11;
  const padX = 5;
  const gap = 3;
  const pillH = 16;
  const pillW = Math.round(label.length * 6.2 + padX * 2);
  const w = dot + gap + pillW;
  const h = Math.max(dot, pillH);
  const cy = h / 2;
  const pillX = dot + gap;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect x='${pillX}' y='${cy - pillH / 2}' width='${pillW}' height='${pillH}' rx='${pillH / 2}' fill='#0b0e12' fill-opacity='0.78'/>` +
    `<text x='${pillX + pillW / 2}' y='${cy + 0.5}' text-anchor='middle' dominant-baseline='central' font-family='system-ui,sans-serif' font-size='${fs}' font-weight='600' fill='#ffffff'>${escapeXml(label)}</text>` +
    `<circle cx='${c}' cy='${cy}' r='${r}' fill='${color}' stroke='#ffffff' stroke-width='1.5'/>` +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(c, cy),
  };
  dotLabelIconCache.set(key, icon);
  return icon;
}

// The drilled Pencawang's own check-in location: a blue SQUARE (clearly NOT one
// of the round pole dots) with its name in a pill below.
const pencawangIconCache = new Map<string, google.maps.Icon>();
function pencawangMarkerIcon(name: string): google.maps.Icon {
  const cached = pencawangIconCache.get(name);
  if (cached) return cached;
  const box = 22;
  const label = name.length > 24 ? `${name.slice(0, 23)}…` : name;
  const nameFs = 11;
  const pillH = 18;
  const gap = 4;
  const pillW = Math.min(220, Math.max(box, label.length * 6.4 + 14));
  const w = Math.max(box, pillW);
  const h = box + gap + pillH;
  const cx = w / 2;
  const bx = (w - box) / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect x='${bx}' y='0' width='${box}' height='${box}' rx='5' fill='#2563eb' stroke='#ffffff' stroke-width='2'/>` +
    `<rect x='${bx + box / 2 - 4.5}' y='${box / 2 - 4.5}' width='9' height='9' rx='1.5' fill='#ffffff'/>` +
    `<rect x='${(w - pillW) / 2}' y='${box + gap}' width='${pillW}' height='${pillH}' rx='${pillH / 2}' fill='#2563eb' fill-opacity='0.95'/>` +
    `<text x='${cx}' y='${box + gap + pillH / 2 + 0.5}' text-anchor='middle' dominant-baseline='central' font-family='system-ui,sans-serif' font-size='${nameFs}' font-weight='700' fill='#ffffff'>${escapeXml(label)}</text>` +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(cx, box / 2),
  };
  pencawangIconCache.set(name, icon);
  return icon;
}

// Pencawang anchor for the Mainhead-wide overlap view: a rounded square in the
// PENCAWANG's own colour (so it ties to its coloured pole dots) with the name in
// a dark pill below. Distinct from the round pole dots. One per Pencawang, drawn
// at the centroid of its visible poles.
const pencawangAnchorIconCache = new Map<string, google.maps.Icon>();
function pencawangAnchorIcon(name: string, color: string): google.maps.Icon {
  const key = `${color}|${name}`;
  const cached = pencawangAnchorIconCache.get(key);
  if (cached) return cached;
  const box = 20;
  const label = name.length > 22 ? `${name.slice(0, 21)}…` : name;
  const nameFs = 11;
  const pillH = 17;
  const gap = 4;
  const pillW = Math.min(220, Math.max(box, label.length * 6.4 + 14));
  const w = Math.max(box, pillW);
  const h = box + gap + pillH;
  const cx = w / 2;
  const bx = (w - box) / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<rect x='${bx}' y='0' width='${box}' height='${box}' rx='5' fill='${color}' stroke='#ffffff' stroke-width='2.5'/>` +
    `<rect x='${(w - pillW) / 2}' y='${box + gap}' width='${pillW}' height='${pillH}' rx='${pillH / 2}' fill='#0b0e12' fill-opacity='0.82'/>` +
    `<text x='${cx}' y='${box + gap + pillH / 2 + 0.5}' text-anchor='middle' dominant-baseline='central' font-family='system-ui,sans-serif' font-size='${nameFs}' font-weight='700' fill='#ffffff'>${escapeXml(label)}</text>` +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(cx, box / 2),
  };
  pencawangAnchorIconCache.set(key, icon);
  return icon;
}

// The halo marking the pole open in the asset panel: a hollow ring wide enough
// to read against a dense cluster, with a white outline so it stands out over
// both the satellite imagery and any pole colour. Drawn UNDER nothing — it sits
// above every other layer — and centred on the pole's own dot.
const SELECTED_HALO_COLOR = "#facc15"; // amber-400 — unused by any status palette
function selectedHaloIcon(): google.maps.Icon {
  const size = 40;
  const c = size / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${c - 3}' fill='none' stroke='#ffffff' stroke-width='6' stroke-opacity='0.55'/>` +
    `<circle cx='${c}' cy='${c}' r='${c - 3}' fill='none' stroke='${SELECTED_HALO_COLOR}' stroke-width='3'/>` +
    `</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
  };
}

function Layers({
  mode,
  bubbles,
  points,
  colorMode,
  pencawang,
  onDrill,
  onSelectPoint,
  controlsRef,
  onStreetViewVisibleChange,
  colorByPencawang,
  suppressAutoFit,
  onBoundsChange,
  pencawangAnchors,
  selectedPoint,
}: HierarchicalMapProps) {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const anchorsRef = useRef<google.maps.Marker[]>([]);
  const haloRef = useRef<google.maps.Marker | null>(null);
  const positionsRef = useRef<google.maps.LatLngLiteral[]>([]);
  const fitKeyRef = useRef<string>("");
  const onDrillRef = useRef(onDrill);
  const onSelectRef = useRef(onSelectPoint);
  const onSvVisibleRef = useRef(onStreetViewVisibleChange);
  const onBoundsRef = useRef(onBoundsChange);
  onDrillRef.current = onDrill;
  onSelectRef.current = onSelectPoint;
  onSvVisibleRef.current = onStreetViewVisibleChange;
  onBoundsRef.current = onBoundsChange;

  const fitToPositions = (target: google.maps.Map) => {
    const positions = positionsRef.current;
    if (positions.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    positions.forEach((p) => bounds.extend(p));
    target.fitBounds(bounds, 80);
  };

  // Imperative zoom controls for the chrome's zoom box.
  useEffect(() => {
    if (!map || !controlsRef) return;
    controlsRef.current = {
      zoomIn: () => map.setZoom((map.getZoom() ?? 7) + 1),
      zoomOut: () => map.setZoom((map.getZoom() ?? 7) - 1),
      recenter: () => fitToPositions(map),
      getBounds: () => boundsToBbox(map),
      panTo: (latitude, longitude) => map.panTo({ lat: latitude, lng: longitude }),
    };
    return () => {
      if (controlsRef) controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Bring back the native draggable Street View pegman — drag it onto a road to
  // open Street View. `disableDefaultUI` hides every built-in control, so
  // re-enable just this one at RIGHT_BOTTOM; globals.css strips its white box and
  // lifts it to sit just above the custom zoom box (see `.gm-svpc`).
  useEffect(() => {
    if (!map) return;
    map.setOptions({
      streetViewControl: true,
      streetViewControlOptions: {
        position: google.maps.ControlPosition.RIGHT_BOTTOM,
      },
    });
  }, [map]);

  // Report Street View open/close so the chrome can hide the map overlays — the
  // auto-hide docks would otherwise slide over the panorama's own controls (its
  // top-left "back to map" button in particular).
  useEffect(() => {
    if (!map) return;
    const panorama = map.getStreetView();
    const listener = panorama.addListener("visible_changed", () => {
      onSvVisibleRef.current?.(panorama.getVisible());
    });
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  // Report the viewport whenever the camera settles, so the Mainhead-wide view
  // can refetch the poles in view. The parent guards + debounces; a no-op when
  // no handler is set (bubble / single-Pencawang levels).
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const bbox = boundsToBbox(map);
      if (bbox) onBoundsRef.current?.(bbox);
    });
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  // Rebuild the marker layer whenever the items or colour change.
  useEffect(() => {
    if (!map) return;
    for (const marker of markersRef.current) marker.setMap(null);
    markersRef.current = [];
    const positions: google.maps.LatLngLiteral[] = [];

    if (mode === "bubbles") {
      for (const bubble of bubbles) {
        const position = { lat: bubble.latitude, lng: bubble.longitude };
        const marker = new google.maps.Marker({
          position,
          icon: bubbleIcon(
            bubbleColor(bubble, colorMode),
            bubbleSize(bubble.count),
            abbreviate(bubble.count),
            bubble.name,
          ),
          title: `${bubble.name} — ${bubble.count}`,
          optimized: true,
          zIndex: Math.round(bubble.count),
        });
        marker.addListener("click", () => onDrillRef.current(bubble));
        marker.setMap(map);
        markersRef.current.push(marker);
        positions.push(position);
      }
    } else {
      for (const asset of points) {
        const position = { lat: asset.latitude, lng: asset.longitude };
        const marker = new google.maps.Marker({
          position,
          // Mainhead-wide overlap view: a plain dot coloured by Pencawang (labels
          // would be an unreadable, heavy mess at this density). Otherwise the
          // labelled dot coloured by inspection/defect status.
          icon: colorByPencawang
            ? dotLabelIcon(pencawangColor(asset.substation?.id), "")
            : dotLabelIcon(mapAssetMarkerColor(asset, colorMode), asset.assetCode),
          title: colorByPencawang
            ? `${asset.assetCode} · ${asset.substation?.name ?? "—"}`
            : asset.assetCode,
          optimized: true,
        });
        marker.addListener("click", () => onSelectRef.current(asset));
        marker.setMap(map);
        markersRef.current.push(marker);
        positions.push(position);
      }
      if (pencawang) {
        const position = { lat: pencawang.latitude, lng: pencawang.longitude };
        const marker = new google.maps.Marker({
          position,
          icon: pencawangMarkerIcon(pencawang.name),
          title: `Pencawang: ${pencawang.name}`,
          optimized: true,
          zIndex: 100000,
        });
        marker.setMap(map);
        markersRef.current.push(marker);
        positions.push(position);
      }
    }
    positionsRef.current = positions;

    // Fit the view only when the SET changes (not on a recolour).
    const fitKey =
      mode +
      "|" +
      (mode === "bubbles"
        ? bubbles.map((b) => b.id).join(",")
        : points.map((p) => p.id).join(",") + "|" + (pencawang?.id ?? ""));
    if (!suppressAutoFit && fitKey !== fitKeyRef.current && positions.length > 0) {
      fitKeyRef.current = fitKey;
      fitToPositions(map);
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        const max = mode === "points" ? 17 : 12;
        if ((map.getZoom() ?? 0) > max) map.setZoom(max);
      });
      return () => google.maps.event.removeListener(listener);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode, bubbles, points, colorMode, pencawang, colorByPencawang, suppressAutoFit]);

  // Pencawang anchors (overlap view): their OWN marker layer, rebuilt only when
  // the anchor set / mode changes — NOT on every pole refetch, so panning doesn't
  // churn them. `optimized:false` renders them as DOM overlays off the pole
  // canvas (the pole layer kept the WebGL renderer redrawing), and the fixed
  // server centroids mean they never drift.
  useEffect(() => {
    for (const marker of anchorsRef.current) marker.setMap(null);
    anchorsRef.current = [];
    if (!map || !colorByPencawang || !pencawangAnchors) {
      return;
    }
    for (const anchor of pencawangAnchors) {
      const marker = new google.maps.Marker({
        position: { lat: anchor.latitude, lng: anchor.longitude },
        icon: pencawangAnchorIcon(anchor.name, pencawangColor(anchor.id)),
        title: `Pencawang: ${anchor.name}`,
        optimized: false,
        zIndex: 50000,
      });
      marker.setMap(map);
      anchorsRef.current.push(marker);
    }
    return () => {
      for (const marker of anchorsRef.current) marker.setMap(null);
      anchorsRef.current = [];
    };
  }, [map, colorByPencawang, pencawangAnchors]);

  // Halo on the pole open in the asset panel. Its OWN single-marker layer keyed
  // only on the selected pole, so stepping through poles never rebuilds the pole
  // canvas (the Deploy-89 repaint lesson); `optimized:false` renders it as a DOM
  // overlay above the pole layer.
  useEffect(() => {
    haloRef.current?.setMap(null);
    haloRef.current = null;
    if (!map || !selectedPoint) {
      return;
    }
    const marker = new google.maps.Marker({
      position: { lat: selectedPoint.latitude, lng: selectedPoint.longitude },
      icon: selectedHaloIcon(),
      // Not clickable — the pole's own dot underneath keeps handling clicks.
      clickable: false,
      optimized: false,
      zIndex: 200000,
    });
    marker.setMap(map);
    haloRef.current = marker;
    return () => {
      marker.setMap(null);
      haloRef.current = null;
    };
  }, [map, selectedPoint]);

  return null;
}

/** Google Maps renderer for the hierarchical map — count discs, then poles. */
export default function HierarchicalMap({
  apiKey,
  onLoadError,
  baseType,
  ...rest
}: HierarchicalMapProps & {
  apiKey: string;
  onLoadError?: () => void;
  baseType: MapBaseType;
}) {
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => onLoadError?.();
    return () => {
      window.gm_authFailure = prev;
    };
  }, [onLoadError]);

  return (
    <div className="h-full w-full">
      <APIProvider apiKey={apiKey} onError={() => onLoadError?.()}>
        <GoogleMap
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={6}
          mapTypeId={baseType}
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
