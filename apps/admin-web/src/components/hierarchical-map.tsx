"use client";

import { useEffect, useRef } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import type { MutableRefObject } from "react";
import type { MapControls } from "@/components/asset-map-shared";
import {
  mapAssetMarkerColor,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  type MapAsset,
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

const dotIconCache = new Map<string, google.maps.Icon>();
function dotIcon(color: string): google.maps.Icon {
  const cached = dotIconCache.get(color);
  if (cached) return cached;
  const size = 15;
  const c = size / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${c - 1.5}' fill='${color}' stroke='#ffffff' stroke-width='1.5'/></svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(c, c),
  };
  dotIconCache.set(color, icon);
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

function Layers({
  mode,
  bubbles,
  points,
  colorMode,
  pencawang,
  onDrill,
  onSelectPoint,
  controlsRef,
}: HierarchicalMapProps) {
  const map = useMap();
  const markersRef = useRef<google.maps.Marker[]>([]);
  const positionsRef = useRef<google.maps.LatLngLiteral[]>([]);
  const fitKeyRef = useRef<string>("");
  const onDrillRef = useRef(onDrill);
  const onSelectRef = useRef(onSelectPoint);
  onDrillRef.current = onDrill;
  onSelectRef.current = onSelectPoint;

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
    };
    return () => {
      if (controlsRef) controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          icon: dotIcon(mapAssetMarkerColor(asset, colorMode)),
          title: asset.assetCode,
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
    if (fitKey !== fitKeyRef.current && positions.length > 0) {
      fitKeyRef.current = fitKey;
      fitToPositions(map);
      const listener = google.maps.event.addListenerOnce(map, "idle", () => {
        const max = mode === "points" ? 17 : 12;
        if ((map.getZoom() ?? 0) > max) map.setZoom(max);
      });
      return () => google.maps.event.removeListener(listener);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode, bubbles, points, colorMode, pencawang]);

  return null;
}

/** Google Maps renderer for the hierarchical map — count discs, then poles. */
export default function HierarchicalMap({
  apiKey,
  onLoadError,
  ...rest
}: HierarchicalMapProps & { apiKey: string; onLoadError?: () => void }) {
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
