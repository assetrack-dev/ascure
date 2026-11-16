"use client";

import { useEffect, useRef, useState } from "react";
import { APIProvider, Map as GoogleMap, useMap } from "@vis.gl/react-google-maps";
import {
  formatSpanLength,
  SPAN_MAP_COLOR,
  spanKey,
  type SavtSpan,
  type SavtSpanPole,
} from "@/lib/savt-spans";

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

/**
 * Satellite map of ONE SAVT route for the visit page's "Route spans" card
 * (TNB ask 2026-11-16): each span is a line coloured by its flag, with its
 * distance in metres on a label. Zoomed out only flagged spans carry a label
 * (a 300-pole route stays readable); from street level every span does.
 * Click a span to pick it in the table; picking a row zooms here.
 * Only this card — the main Asset Map is unchanged.
 */

/** Every span gets a label from this zoom in; below it, only flagged ones. */
const ALL_LABELS_FROM_ZOOM = 18;

interface SpansMapProps {
  poles: SavtSpanPole[];
  spans: SavtSpan[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function hasFix(pole: SavtSpanPole | undefined): pole is SavtSpanPole & { latitude: number; longitude: number } {
  return (
    !!pole &&
    pole.latitude != null &&
    pole.longitude != null &&
    !(pole.latitude === 0 && pole.longitude === 0)
  );
}

// Pill labels as raster SVG icons (cached), readable on any imagery.
const labelCache = new Map<string, google.maps.Icon>();
function labelIcon(text: string, color: string, selected: boolean): google.maps.Icon {
  const key = `${text}|${color}|${selected ? 1 : 0}`;
  const cached = labelCache.get(key);
  if (cached) return cached;
  const fontSize = selected ? 13 : 11;
  const width = Math.round(text.length * fontSize * 0.62 + 12);
  const height = fontSize + 9;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
    `<rect x='0.75' y='0.75' width='${width - 1.5}' height='${height - 1.5}' rx='${height / 2 - 1}' fill='#0f172a' fill-opacity='0.86' stroke='${color}' stroke-width='${selected ? 2.5 : 1.5}'/>` +
    `<text x='50%' y='50%' dy='0.35em' text-anchor='middle' font-family='Arial, sans-serif' font-size='${fontSize}' font-weight='700' fill='#ffffff'>${text}</text>` +
    `</svg>`;
  const icon: google.maps.Icon = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, height / 2),
  };
  labelCache.set(key, icon);
  return icon;
}

function labelText(span: SavtSpan) {
  return span.metres == null ? "no GPS" : span.metres >= 1000 ? formatSpanLength(span.metres) : `${Math.round(span.metres)} m`;
}

function Layers({ poles, spans, selectedKey, onSelect, fitAllSignal }: SpansMapProps & { fitAllSignal: number }) {
  const map = useMap();
  const [zoom, setZoom] = useState(0);
  const linesRef = useRef(new Map<string, google.maps.Polyline>());
  const labelsRef = useRef(new Map<string, google.maps.Marker>());
  const polesRef = useRef<google.maps.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Build the route once per data set.
  useEffect(() => {
    if (!map) return;
    const byId = new Map(poles.map((pole) => [pole.assetId, pole]));
    const bounds = new google.maps.LatLngBounds();

    for (const pole of poles) {
      if (!hasFix(pole)) continue;
      const position = { lat: pole.latitude, lng: pole.longitude };
      bounds.extend(position);
      polesRef.current.push(
        new google.maps.Marker({
          map,
          position,
          title: `No. Tiang ${pole.noTiang}`,
          zIndex: 5,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 3.2,
            fillColor: "#ffffff",
            fillOpacity: 1,
            strokeColor: "#0f172a",
            strokeWeight: 1.2,
          },
        }),
      );
    }

    for (const span of spans) {
      const from = byId.get(span.fromAssetId);
      const to = byId.get(span.toAssetId);
      if (!hasFix(from) || !hasFix(to)) continue;
      const key = spanKey(span);
      const color = SPAN_MAP_COLOR[span.flag ?? "OK"];
      const path = [
        { lat: from.latitude, lng: from.longitude },
        { lat: to.latitude, lng: to.longitude },
      ];
      const dashed = span.flag === "GAP";
      const line = new google.maps.Polyline({
        map,
        path,
        strokeColor: color,
        strokeOpacity: dashed ? 0 : 0.95,
        strokeWeight: span.flag ? 4 : 3,
        // A GAP is drawn dashed: no real cable was surveyed there.
        icons: dashed
          ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: color, scale: 3 }, offset: "0", repeat: "12px" }]
          : undefined,
        zIndex: span.flag ? 3 : 2,
      });
      line.addListener("click", () => onSelectRef.current(key));
      linesRef.current.set(key, line);

      const label = new google.maps.Marker({
        position: { lat: (from.latitude + to.latitude) / 2, lng: (from.longitude + to.longitude) / 2 },
        icon: labelIcon(labelText(span), color, false),
        title: `${span.fromNoTiang} → ${span.toNoTiang}`,
        zIndex: span.flag ? 8 : 6,
      });
      label.addListener("click", () => onSelectRef.current(key));
      labelsRef.current.set(key, label);
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 40);
    }
    const zoomListener = map.addListener("zoom_changed", () => setZoom(map.getZoom() ?? 0));
    setZoom(map.getZoom() ?? 0);

    const lines = linesRef.current;
    const labels = labelsRef.current;
    return () => {
      zoomListener.remove();
      for (const line of lines.values()) line.setMap(null);
      for (const label of labels.values()) label.setMap(null);
      for (const marker of polesRef.current) marker.setMap(null);
      lines.clear();
      labels.clear();
      polesRef.current = [];
    };
  }, [map, poles, spans]);

  // Which labels show, and how the selected span stands out.
  useEffect(() => {
    if (!map) return;
    const showAll = zoom >= ALL_LABELS_FROM_ZOOM;
    for (const span of spans) {
      const key = spanKey(span);
      const label = labelsRef.current.get(key);
      const line = linesRef.current.get(key);
      const selected = key === selectedKey;
      const color = SPAN_MAP_COLOR[span.flag ?? "OK"];
      if (line) {
        line.setOptions({
          strokeWeight: selected ? 8 : span.flag ? 4 : 3,
          zIndex: selected ? 10 : span.flag ? 3 : 2,
        });
      }
      if (label) {
        const visible = selected || showAll || span.flag != null;
        label.setIcon(labelIcon(labelText(span), color, selected));
        label.setZIndex(selected ? 20 : span.flag ? 8 : 6);
        if (visible && label.getMap() !== map) label.setMap(map);
        if (!visible && label.getMap()) label.setMap(null);
      }
    }
  }, [map, spans, zoom, selectedKey]);

  // Picking a span (map or table) brings it into view.
  useEffect(() => {
    if (!map || !selectedKey) return;
    const line = linesRef.current.get(selectedKey);
    const path = line?.getPath();
    if (!path || path.getLength() < 2) return;
    const bounds = new google.maps.LatLngBounds();
    path.forEach((point) => bounds.extend(point));
    if (!map.getBounds()?.contains(bounds.getCenter()) || (map.getZoom() ?? 0) < 17) {
      map.fitBounds(bounds, 120);
      if ((map.getZoom() ?? 0) > 19) map.setZoom(19);
    }
  }, [map, selectedKey]);

  // "Whole route" button.
  useEffect(() => {
    if (!map || fitAllSignal === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const pole of poles) {
      if (hasFix(pole)) bounds.extend({ lat: pole.latitude, lng: pole.longitude });
    }
    if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
  }, [map, poles, fitAllSignal]);

  return null;
}

const HIDE_PLACES: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export default function SavtRouteSpansMap({
  apiKey,
  onLoadError,
  ...rest
}: SpansMapProps & { apiKey: string; onLoadError?: () => void }) {
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
          defaultCenter={{ lat: 4.2105, lng: 101.9758 }}
          defaultZoom={7}
          mapTypeId={mapType}
          gestureHandling="cooperative"
          clickableIcons={false}
          disableDefaultUI
          zoomControl
          fullscreenControl
          // Shops/places compete with the span labels — keep roads only.
          styles={HIDE_PLACES}
          style={{ width: "100%", height: "100%" }}
        >
          <Layers {...rest} fitAllSignal={fitAllSignal} />
        </GoogleMap>
      </APIProvider>
      <div className="absolute left-3 top-3 flex gap-2">
        <button
          type="button"
          onClick={() => setMapType((current) => (current === "hybrid" ? "roadmap" : "hybrid"))}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {mapType === "hybrid" ? "Map" : "Satellite"}
        </button>
        <button
          type="button"
          onClick={() => setFitAllSignal((count) => count + 1)}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Whole route
        </button>
      </div>
    </div>
  );
}
