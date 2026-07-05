"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  INSPECTED_MARKER_COLOR,
  NOT_INSPECTED_MARKER_COLOR,
  EMERGENCY_DEFECT_MARKER_COLOR,
  OPEN_DEFECT_MARKER_COLOR,
  formatMaintenanceCategory,
  isMapAssetInspected,
  mapAssetMarkerColor,
  type MapAsset,
  type MapColorMode,
} from "@/lib/map";

interface GlobalAssetMapProps {
  assets: MapAsset[];
  colorMode: MapColorMode;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(asset: MapAsset): string {
  const inspected = isMapAssetInspected(asset);
  const rows: string[] = [];
  if (asset.name) {
    rows.push(escapeHtml(asset.name));
  }
  if (asset.assetType?.name) {
    rows.push(escapeHtml(asset.assetType.name));
  }
  if (asset.substation) {
    const sub = [asset.substation.code, asset.substation.name]
      .filter(Boolean)
      .join(" · ");
    if (sub) rows.push(escapeHtml(sub));
    if (asset.substation.location) rows.push(escapeHtml(asset.substation.location));
  }
  const meta = rows.length
    ? `<br/><span style="color:#475569">${rows.join("<br/>")}</span>`
    : "";
  const badge = inspected
    ? `<span style="color:${INSPECTED_MARKER_COLOR};font-weight:600">Inspected</span>`
    : `<span style="color:${NOT_INSPECTED_MARKER_COLOR};font-weight:600">Not inspected</span>`;
  let defectLine = "";
  if (asset.openDefectCount > 0) {
    const color = asset.hasEmergencyDefect
      ? EMERGENCY_DEFECT_MARKER_COLOR
      : OPEN_DEFECT_MARKER_COLOR;
    const emergency = asset.hasEmergencyDefect ? " · emergency" : "";
    const categories = asset.defectCategories
      .map(formatMaintenanceCategory)
      .join(", ");
    const categorySuffix = categories
      ? ` <span style="color:#475569">(${escapeHtml(categories)})</span>`
      : "";
    defectLine = `<br/><span style="color:${color};font-weight:600">${asset.openDefectCount} open defect${
      asset.openDefectCount === 1 ? "" : "s"
    }${emergency}</span>${categorySuffix}`;
  }
  return `<strong>${escapeHtml(asset.assetCode)}</strong>${meta}<br/>${badge}${defectLine}`;
}

/**
 * Global asset map — every located asset the user may see (role-scoped server
 * side), plotted over an OpenStreetMap basemap. Driven imperatively with plain
 * Leaflet (no react-leaflet) inside a component the parent loads `ssr: false`.
 * Pins follow the mobile convention: lime = inspected, red = not yet inspected.
 */
export default function GlobalAssetMap({ assets, colorMode }: GlobalAssetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  const locatedCount = assets.length;

  // Create the map + basemap once, on mount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) {
      return;
    }
    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true,
    });
    // Sensible default view (Peninsular Malaysia) until pins set the bounds.
    map.setView([4.2105, 101.9758], 7);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const timer = setTimeout(() => map.invalidateSize(), 0);
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // (Re)draw markers whenever the asset set OR the colour mode changes. Kept
  // separate from the fit-bounds effect so toggling colour doesn't snap the
  // viewport back (the pin set — and thus the bounds — hasn't changed).
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) {
      return;
    }
    overlay.clearLayers();

    for (const asset of assets) {
      L.circleMarker([asset.latitude, asset.longitude], {
        radius: 6,
        fillColor: mapAssetMarkerColor(asset, colorMode),
        fillOpacity: 1,
        color: "#ffffff",
        weight: 1.5,
      })
        .bindPopup(popupHtml(asset))
        .addTo(overlay);
    }
  }, [assets, colorMode]);

  // Fit the viewport to the pin set — only when the pins change, not on a
  // colour-mode toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || locatedCount === 0) {
      return;
    }
    const bounds = L.latLngBounds(
      assets.map((asset) => [asset.latitude, asset.longitude] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 17 });
  }, [assets, locatedCount]);

  return (
    <div
      ref={containerRef}
      style={{ height: 560, borderRadius: 12 }}
      role="img"
      aria-label="Global asset map"
    />
  );
}
