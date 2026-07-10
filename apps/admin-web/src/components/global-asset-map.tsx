"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat";
import type { AssetMapProps } from "@/components/asset-map-shared";
import {
  mapAssetDefectState,
  mapAssetMarkerColor,
  type MapAsset,
} from "@/lib/map";

const DEFAULT_CENTER: [number, number] = [4.2105, 101.9758];

function markerIcon(asset: MapAsset, colorMode: AssetMapProps["colorMode"], selected: boolean): L.DivIcon {
  const color = mapAssetMarkerColor(asset, colorMode);
  const emergency = mapAssetDefectState(asset) === "emergency";
  const cls = `ascure-mk${selected ? " sel" : ""}${emergency ? " emg" : ""}`;
  const size = selected ? 22 : 16;
  return L.divIcon({
    className: "ascure-mk-wrap",
    html: `<div class="${cls}" style="background:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Leaflet/OpenStreetMap renderer — the fallback when Google Maps is unavailable.
 * Full parity with the Google renderer: state-coloured divIcon markers, pins /
 * clusters / heat view modes, lifted selection, an imperative zoom handle, and
 * viewport → "in view" reporting.
 */
export default function GlobalAssetMap({
  assets,
  colorMode,
  viewMode,
  selectedId,
  onSelect,
  onVisibleChange,
  controlsRef,
}: AssetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinLayerRef = useRef<L.LayerGroup | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const heatRef = useRef<L.HeatLayer | null>(null);
  const markerById = useRef<Map<string, L.Marker>>(new Map());
  // Latest props for the (stable) event handlers.
  const assetsRef = useRef(assets);
  const onSelectRef = useRef(onSelect);
  const onVisibleRef = useRef(onVisibleChange);
  assetsRef.current = assets;
  onSelectRef.current = onSelect;
  onVisibleRef.current = onVisibleChange;

  const emitVisible = () => {
    const map = mapRef.current;
    if (!map || !onVisibleRef.current) return;
    const bounds = map.getBounds();
    const ids: string[] = [];
    for (const asset of assetsRef.current) {
      if (bounds.contains([asset.latitude, asset.longitude])) ids.push(asset.id);
    }
    onVisibleRef.current(ids);
  };

  // Create the map + basemap once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    const map = L.map(container, {
      zoomControl: false, // custom zoom box lives in the chrome
      attributionControl: true,
      scrollWheelZoom: true,
    });
    map.setView(DEFAULT_CENTER, 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    pinLayerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48 });
    mapRef.current = map;

    map.on("moveend", emitVisible);
    map.on("zoomend", emitVisible);

    if (controlsRef) {
      controlsRef.current = {
        zoomIn: () => map.setZoom(map.getZoom() + 1),
        zoomOut: () => map.setZoom(map.getZoom() - 1),
        recenter: () => {
          const list = assetsRef.current;
          if (list.length > 0) {
            map.fitBounds(L.latLngBounds(list.map((a) => [a.latitude, a.longitude] as [number, number])), {
              padding: [60, 60],
              maxZoom: 17,
            });
          }
        },
      };
    }

    const timer = setTimeout(() => map.invalidateSize(), 0);
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      pinLayerRef.current = null;
      clusterRef.current = null;
      heatRef.current = null;
      markerById.current.clear();
      if (controlsRef) controlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw the marker layer whenever assets / colour / view / selection change.
  useEffect(() => {
    const map = mapRef.current;
    const pinLayer = pinLayerRef.current;
    const cluster = clusterRef.current;
    if (!map || !pinLayer || !cluster) return;

    // Tear down every layer first, then build the one the view mode wants.
    pinLayer.clearLayers();
    cluster.clearLayers();
    map.removeLayer(cluster);
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    markerById.current.clear();

    if (viewMode === "heat") {
      const points = assets.map(
        (a) => [a.latitude, a.longitude, a.hasEmergencyDefect ? 1 : a.openDefectCount > 0 ? 0.7 : 0.4] as [number, number, number],
      );
      heatRef.current = L.heatLayer(points, { radius: 24, blur: 18, maxZoom: 17 }).addTo(map);
      return;
    }

    const target: L.LayerGroup = viewMode === "clusters" ? cluster : pinLayer;
    for (const asset of assets) {
      const marker = L.marker([asset.latitude, asset.longitude], {
        icon: markerIcon(asset, colorMode, asset.id === selectedId),
        title: asset.assetCode,
      });
      marker.on("click", () => onSelectRef.current(asset.id));
      marker.addTo(target);
      markerById.current.set(asset.id, marker);
    }
    if (viewMode === "clusters") {
      map.addLayer(cluster);
    }
    emitVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, colorMode, viewMode, selectedId]);

  // Fit to the pin set only when the SET changes (not on colour/selection).
  const idsKey = assets.map((a) => a.id).sort().join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || assets.length === 0) return;
    map.fitBounds(L.latLngBounds(assets.map((a) => [a.latitude, a.longitude] as [number, number])), {
      padding: [60, 60],
      maxZoom: 17,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Pan to a selection made from the in-view list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const asset = assets.find((a) => a.id === selectedId);
    if (asset) {
      map.panTo([asset.latitude, asset.longitude]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // `isolate` (isolation: isolate) makes this div its own stacking context.
  // Without it, Leaflet's internal panes (z-index 400) and controls (800-1000)
  // leak into the parent stacking context and paint OVER the map chrome that
  // sits alongside this div (filter dock z-20, view/colour toggles + zoom z-10),
  // which made the filters look like they'd disappeared.
  return (
    <div ref={containerRef} className="isolate h-full w-full" role="img" aria-label="Global asset map" />
  );
}
