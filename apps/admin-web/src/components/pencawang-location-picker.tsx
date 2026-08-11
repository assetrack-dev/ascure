"use client";

import { useEffect } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  Marker,
  useMap,
  type MapMouseEvent,
} from "@vis.gl/react-google-maps";

// Malaysia-wide view for a Pencawang with no coordinate yet (matches the
// hierarchical map's default).
const DEFAULT_CENTER = { lat: 4.2105, lng: 101.9758 };
const PICK_ZOOM = 18; // ~rooftop level — enough to tell the station from its neighbour

/** Pans (never jumps zoom) to follow coordinates typed into the form. */
function FollowTypedCoordinate({
  position,
}: {
  position: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map || !position) {
      return;
    }
    map.panTo(position);
    // Only lift a wide default view up to pick zoom — never fight the user's
    // own zooming while they fine-tune.
    const zoom = map.getZoom();
    if (zoom != null && zoom < 12) {
      map.setZoom(PICK_ZOOM);
    }
  }, [map, position?.lat, position?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Click-to-place picker for the Pencawang edit dialog. Click anywhere (or drag
 * the pin) to set the coordinate; typed lat/lng in the form pans the map. The
 * satellite base is deliberate — the office fixes a pin by recognising the
 * station's roof, not a street name.
 */
export default function PencawangLocationPicker({
  apiKey,
  position,
  onPick,
  onLoadError,
}: {
  apiKey: string;
  /** Current coordinate (parsed from the form), or null when blank/invalid. */
  position: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
  onLoadError?: () => void;
}) {
  useEffect(() => {
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => onLoadError?.();
    return () => {
      window.gm_authFailure = prev;
    };
  }, [onLoadError]);

  const handleMapClick = (event: MapMouseEvent) => {
    const latLng = event.detail.latLng;
    if (latLng) {
      onPick(latLng.lat, latLng.lng);
    }
  };

  return (
    <APIProvider apiKey={apiKey} onError={() => onLoadError?.()}>
      <GoogleMap
        defaultCenter={position ?? DEFAULT_CENTER}
        defaultZoom={position ? PICK_ZOOM : 6}
        mapTypeId="hybrid"
        gestureHandling="greedy"
        clickableIcons={false}
        disableDefaultUI
        zoomControl
        onClick={handleMapClick}
        style={{ width: "100%", height: "100%" }}
      >
        {position ? (
          <Marker
            position={position}
            draggable
            onDragEnd={(event) => {
              const latLng = event.latLng;
              if (latLng) {
                onPick(latLng.lat(), latLng.lng());
              }
            }}
          />
        ) : null}
        <FollowTypedCoordinate position={position} />
      </GoogleMap>
    </APIProvider>
  );
}
