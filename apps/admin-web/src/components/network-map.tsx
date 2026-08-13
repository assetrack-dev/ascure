"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { SubstationNetwork } from "@/lib/network";

interface NetworkMapProps {
  network: SubstationNetwork;
  deEnergizedIds: Set<string>;
  backfeedEdgeIds: Set<string>;
  colorForFeeder: (code: string) => string;
}

/**
 * GPS map mode — a real slippy map: poles plotted at their captured coordinates
 * over an OpenStreetMap street basemap, with the radial spans and NOP ties drawn
 * between them. Driven imperatively with plain Leaflet (no react-leaflet) inside
 * a component the parent loads `ssr: false`, so there is no SSR/peer-version
 * coupling to fight. Reuses the isolation overlay (red = de-energized, amber =
 * back-feed tie).
 */
export default function NetworkMap({
  network,
  deEnergizedIds,
  backfeedEdgeIds,
  colorForFeeder,
}: NetworkMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  const located = network.poles.filter(
    (pole) => pole.latitude != null && pole.longitude != null,
  );
  const locatedCount = located.length;

  // Create the map + basemap once, on mount. The parent only mounts this
  // component when the Map tab is active, so the container already has its
  // layout size — invalidateSize() on the next tick covers any race.
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const timer = setTimeout(() => map.invalidateSize(), 0);
    // The container now fills a flexible stage (viewport-height layout), so its
    // size changes without a window resize (Leaflet only tracks window resize).
    // Watch the element itself and reflow the tiles.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // (Re)draw the network overlay whenever the graph or isolation state changes.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) {
      return;
    }
    overlay.clearLayers();

    const posById = new Map<string, [number, number]>(
      located.map((pole) => [
        pole.id,
        [pole.latitude as number, pole.longitude as number],
      ]),
    );

    for (const edge of network.edges.radial) {
      const a = posById.get(edge.from);
      const b = posById.get(edge.to);
      if (!a || !b) continue;
      L.polyline([a, b], { color: "#64748B", weight: 3, opacity: 0.9 }).addTo(overlay);
    }

    for (const edge of network.edges.tie) {
      const a = posById.get(edge.from);
      const b = posById.get(edge.to);
      if (!a || !b) continue;
      const lit = backfeedEdgeIds.has(edge.id);
      L.polyline([a, b], {
        color: lit ? "#F59E0B" : "#94A3B8",
        weight: lit ? 4 : 2.5,
        opacity: lit ? 1 : 0.8,
        dashArray: "6 6",
      }).addTo(overlay);
    }

    for (const pole of located) {
      const pos = posById.get(pole.id);
      if (!pos) continue;
      const dead = deEnergizedIds.has(pole.id);
      const color = dead ? "#DC2626" : colorForFeeder(pole.feeders[0] ?? "");
      L.circleMarker(pos, {
        radius: 7,
        fillColor: color,
        fillOpacity: 1,
        color: "#ffffff",
        weight: 2,
      })
        .bindTooltip(pole.noTiangRondaan, {
          permanent: true,
          direction: "right",
          offset: [9, 0],
          className: `ascure-pole-label${dead ? " ascure-pole-label--dead" : ""}`,
        })
        .bindPopup(
          `<strong>${pole.noTiangRondaan}</strong>${
            pole.noTiangLama ? ` &middot; ${pole.noTiangLama}` : ""
          }${dead ? "<br/><span style=\"color:#DC2626\">De-energized</span>" : ""}`,
        )
        .addTo(overlay);
    }

    if (locatedCount > 0) {
      const bounds = L.latLngBounds(
        located.map((pole) => [pole.latitude as number, pole.longitude as number]),
      );
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 18 });
    }
  }, [network, deEnergizedIds, backfeedEdgeIds, colorForFeeder, located, locatedCount]);

  if (locatedCount === 0) {
    return (
      <p className="p-6 text-sm text-[var(--muted)]">
        No poles have GPS coordinates for this Pencawang.
      </p>
    );
  }

  return (
    // Fill whatever the parent stage gives us — the page sizes the stage to the
    // viewport so the map is as large as the screen allows.
    <div className="flex h-full min-h-[420px] flex-col p-2">
      <style>{`
        .ascure-pole-label {
          background: transparent;
          border: none;
          box-shadow: none;
          padding: 0;
          color: #0F172A;
          font-weight: 500;
          font-size: 12px;
          white-space: nowrap;
        }
        .ascure-pole-label::before { display: none; }
        .ascure-pole-label--dead { color: #DC2626; font-weight: 700; }
      `}</style>
      <div
        ref={containerRef}
        className="min-h-0 flex-1"
        style={{ borderRadius: 10 }}
        role="img"
        aria-label={`GPS map for ${network.substation.code}`}
      />
      <p className="mt-1.5 shrink-0 px-1 text-xs text-[var(--muted)]">
        Poles on an OpenStreetMap basemap, positioned by captured GPS · {locatedCount} of{" "}
        {network.poles.length} located.
      </p>
    </div>
  );
}
