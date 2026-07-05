"use client";

import { useEffect, useMemo, useState } from "react";
import {
  APIProvider,
  Map,
  Marker,
  InfoWindow,
  useMap,
  useApiIsLoaded,
} from "@vis.gl/react-google-maps";
import {
  formatMaintenanceCategory,
  isMapAssetInspected,
  mapAssetMarkerColor,
  type MapAsset,
  type MapColorMode,
} from "@/lib/map";

declare global {
  interface Window {
    // Google Maps JS calls this global on auth failure (bad / restricted key).
    gm_authFailure?: () => void;
  }
}

interface GoogleAssetMapProps {
  assets: MapAsset[];
  colorMode: MapColorMode;
  apiKey: string;
  /** Called if Google Maps fails to load (e.g. key restricted / API not enabled). */
  onLoadError?: () => void;
}

// Peninsular Malaysia default view until pins set the bounds.
const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };

/** Fits the map to the current pin set when its membership changes. */
function FitBounds({ assets }: { assets: MapAsset[] }) {
  const map = useMap();
  // Re-fit only when the SET OF PINS changes — filter toggles and refetches hand
  // us a fresh array with the same pins, and re-fitting on every identity change
  // would clobber the user's manual pan/zoom.
  const idsKey = useMemo(
    () =>
      assets
        .map((a) => a.id)
        .sort()
        .join("|"),
    [assets],
  );
  useEffect(() => {
    if (!map || assets.length === 0) {
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    assets.forEach((a) => bounds.extend({ lat: a.latitude, lng: a.longitude }));
    map.fitBounds(bounds, 48);
    // Don't zoom in too far when all pins share (nearly) one coordinate.
    const listener = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > 17) {
        map.setZoom(17);
      }
    });
    return () => google.maps.event.removeListener(listener);
    // idsKey is the stable membership signature derived from assets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, idsKey]);
  return null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 12, lineHeight: "18px" }}>
      <span style={{ color: "#64748b", minWidth: 64 }}>{label}</span>
      <span style={{ color: "#0f172a" }}>{value}</span>
    </div>
  );
}

function MapLayers({
  assets,
  colorMode,
  selectedId,
  onSelect,
  onClose,
}: {
  assets: MapAsset[];
  colorMode: MapColorMode;
  selectedId: string | null;
  onSelect: (a: MapAsset) => void;
  onClose: () => void;
}) {
  const apiLoaded = useApiIsLoaded();
  if (!apiLoaded) {
    // `google` global isn't ready yet; rendering markers/icons would throw.
    return null;
  }

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <>
      <FitBounds assets={assets} />
      {assets.map((asset) => (
        <Marker
          key={asset.id}
          position={{ lat: asset.latitude, lng: asset.longitude }}
          onClick={() => onSelect(asset)}
          title={asset.assetCode}
          icon={{
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: mapAssetMarkerColor(asset, colorMode),
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 1.5,
          }}
        />
      ))}
      {selected ? (
        <InfoWindow
          position={{ lat: selected.latitude, lng: selected.longitude }}
          onCloseClick={onClose}
        >
          <div style={{ minWidth: 180, fontFamily: "system-ui, sans-serif" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
              {selected.assetCode}
            </div>
            {selected.name ? (
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 4 }}>
                {selected.name}
              </div>
            ) : null}
            <div style={{ marginTop: 4, display: "grid", gap: 2 }}>
              {selected.assetType ? (
                <InfoRow label="Type" value={selected.assetType.name} />
              ) : null}
              {selected.substation ? (
                <InfoRow label="Pencawang" value={selected.substation.name} />
              ) : null}
              {selected.mainhead ? (
                <InfoRow label="Mainhead" value={selected.mainhead.name} />
              ) : null}
              {selected.team ? (
                <InfoRow label="Team" value={selected.team.name} />
              ) : null}
              <InfoRow
                label="Status"
                value={isMapAssetInspected(selected) ? "Inspected" : "Not inspected"}
              />
              {selected.openDefectCount > 0 ? (
                <>
                  <InfoRow
                    label="Defects"
                    value={`${selected.openDefectCount} open${
                      selected.hasEmergencyDefect ? " · emergency" : ""
                    }`}
                  />
                  {selected.defectCategories.length > 0 ? (
                    <InfoRow
                      label="Category"
                      value={selected.defectCategories
                        .map(formatMaintenanceCategory)
                        .join(", ")}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
            <a
              href={`/assets/${encodeURIComponent(selected.id)}`}
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "#2563eb",
                textDecoration: "none",
              }}
            >
              Open asset →
            </a>
          </div>
        </InfoWindow>
      ) : null}
    </>
  );
}

/**
 * Google Maps renderer for the asset map (interactive: click a pin for details).
 * Pins follow the mobile convention: lime = inspected, red = not yet inspected.
 * Falls back via onLoadError when the key is missing the Maps JavaScript API or
 * is referrer-restricted.
 */
export default function GoogleAssetMap({
  assets,
  colorMode,
  apiKey,
  onLoadError,
}: GoogleAssetMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Google signals auth failures (bad/restricted key) via window.gm_authFailure,
  // which APIProvider.onError does not surface — hook both. Note: gm_authFailure
  // is a single global slot, so this component must not be mounted more than once
  // on a page (map-client renders exactly one instance).
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => onLoadError?.();
    return () => {
      window.gm_authFailure = prev;
    };
  }, [onLoadError]);

  return (
    <div style={{ height: 560, borderRadius: 12, overflow: "hidden" }}>
      <APIProvider apiKey={apiKey} onError={() => onLoadError?.()}>
        <Map
          defaultCenter={DEFAULT_CENTER}
          defaultZoom={7}
          gestureHandling="greedy"
          clickableIcons={false}
          disableDefaultUI={false}
          style={{ width: "100%", height: "100%" }}
        >
          <MapLayers
            assets={assets}
            colorMode={colorMode}
            selectedId={selectedId}
            onSelect={(a) => setSelectedId(a.id)}
            onClose={() => setSelectedId(null)}
          />
        </Map>
      </APIProvider>
    </div>
  );
}
