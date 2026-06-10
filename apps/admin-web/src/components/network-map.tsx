"use client";

import type { SubstationNetwork } from "@/lib/network";

interface NetworkMapProps {
  network: SubstationNetwork;
  deEnergizedIds: Set<string>;
  backfeedEdgeIds: Set<string>;
  colorForFeeder: (code: string) => string;
}

const WIDTH = 760;
const HEIGHT = 470;
const PAD = 54;

/**
 * GPS map mode — poles plotted at their captured coordinates using a simple
 * equirectangular projection into the viewport (north up), with the radial
 * spans and NOP ties drawn between them. Dependency-free (a tiled basemap can
 * layer in later); reuses the isolation overlay (red = de-energized, amber =
 * back-feed tie).
 */
export default function NetworkMap({
  network,
  deEnergizedIds,
  backfeedEdgeIds,
  colorForFeeder,
}: NetworkMapProps) {
  const located = network.poles.filter(
    (pole) => pole.latitude != null && pole.longitude != null,
  );

  if (located.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--muted)]">
        No poles have GPS coordinates for this Pencawang.
      </p>
    );
  }

  const lats = located.map((pole) => pole.latitude as number);
  const lngs = located.map((pole) => pole.longitude as number);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;

  const project = (lat: number, lng: number): [number, number] => [
    PAD + ((lng - minLng) / spanLng) * (WIDTH - 2 * PAD),
    PAD + ((maxLat - lat) / spanLat) * (HEIGHT - 2 * PAD),
  ];
  const posById = new Map<string, [number, number]>(
    located.map((pole) => [pole.id, project(pole.latitude as number, pole.longitude as number)]),
  );

  return (
    <div className="overflow-auto p-3">
      <svg
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`GPS map for ${network.substation.code}`}
        style={{ background: "#EEF2F7", borderRadius: 12 }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="#DCE3EC" strokeWidth={1}>
            <line x1={PAD + f * (WIDTH - 2 * PAD)} y1={PAD} x2={PAD + f * (WIDTH - 2 * PAD)} y2={HEIGHT - PAD} />
            <line x1={PAD} y1={PAD + f * (HEIGHT - 2 * PAD)} x2={WIDTH - PAD} y2={PAD + f * (HEIGHT - 2 * PAD)} />
          </g>
        ))}

        {network.edges.radial.map((edge) => {
          const a = posById.get(edge.from);
          const b = posById.get(edge.to);
          if (!a || !b) return null;
          return (
            <line
              key={`r-${edge.from}-${edge.to}`}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="#64748B"
              strokeWidth={2.5}
            />
          );
        })}

        {network.edges.tie.map((edge) => {
          const a = posById.get(edge.from);
          const b = posById.get(edge.to);
          if (!a || !b) return null;
          const lit = backfeedEdgeIds.has(edge.id);
          return (
            <line
              key={`t-${edge.id}`}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={lit ? "#F59E0B" : "#94A3B8"}
              strokeWidth={lit ? 3 : 2}
              strokeDasharray="6 6"
            />
          );
        })}

        {located.map((pole) => {
          const pos = posById.get(pole.id);
          if (!pos) return null;
          const dead = deEnergizedIds.has(pole.id);
          return (
            <g key={pole.id}>
              <circle
                cx={pos[0]}
                cy={pos[1]}
                r={7}
                fill={dead ? "#DC2626" : colorForFeeder(pole.feeders[0] ?? "")}
                stroke="#ffffff"
                strokeWidth={2}
              />
              <text
                x={pos[0] + 10}
                y={pos[1] + 4}
                fontSize={11}
                fill={dead ? "#DC2626" : "#0F172A"}
                fontWeight={dead ? 700 : 500}
              >
                {pole.noTiangRondaan}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 px-1 text-xs text-[var(--muted)]">
        Poles positioned by captured GPS (north up) · {located.length} of {network.poles.length}{" "}
        located.
      </p>
    </div>
  );
}
