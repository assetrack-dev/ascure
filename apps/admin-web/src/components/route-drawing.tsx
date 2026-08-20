"use client";

/**
 * Lukisan Laluan — the TNB-style LV route drawing, rendered live from the
 * network graph + each pole's latest submitted checklist answers. Mirrors the
 * conventions of the DC's manual CAD sheet (docs/PE LOT 522 BUKIT SEKILAU.dxf):
 * spans coloured by cable type, pole numbers, consumer-count circles, LVPT and
 * blackbox markers, stay (umbang) counts, and open defects as orange notes.
 */

import { useMemo, useState } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import type { RouteDrawing as RouteDrawingData } from "@/lib/network";

/** Cable classes in the order the dominant-cable pick prefers them.
 *  Keys are the SAVR-KLB checklist item keys; labels match the DC's layers. */
const CABLE_CLASSES: Array<{ key: string; label: string; color: string }> = [
  { key: "cable_185_nmp", label: "ABC 185", color: "#DC2626" },
  { key: "cable_95_nmp", label: "ABC 95", color: "#2563EB" },
  { key: "cable_3x16_nmp", label: "ABC 3×16", color: "#16A34A" },
  { key: "cable_1x16_nmp", label: "ABC 1×16", color: "#9333EA" },
  { key: "cable_pvc_9064_4_cable", label: "PVC 9064", color: "#0891B2" },
  { key: "cable_pvc_7083_2_cable_1_cable", label: "PVC 7083", color: "#CA8A04" },
  { key: "cable_pvc_7044", label: "PVC 7044", color: "#C026D3" },
  { key: "bare_7173", label: "BARE 7173", color: "#475569" },
  { key: "bare_7122", label: "BARE 7122", color: "#64748B" },
];
const NO_CABLE = { label: "Tiada Data Kabel", color: "#94A3B8" };

const CANVAS_W = 1500;
const MARGIN = 90;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return String(value);
}

/** The dominant cable class recorded at a pole (largest count wins;
 *  class-order breaks ties), or null when nothing is recorded. */
function dominantCable(items: Record<string, unknown> | undefined) {
  if (!items) return null;
  let best: { label: string; color: string } | null = null;
  let bestCount = 0;
  for (const cls of CABLE_CLASSES) {
    const count = toNumber(items[cls.key]);
    if (count > bestCount) {
      best = cls;
      bestCount = count;
    }
  }
  return best;
}

export function RouteDrawingView({ data }: { data: RouteDrawingData }) {
  const [zoom, setZoom] = useState(1);

  // Continuous cable runs (DC-sheet convention): a pole with no recorded
  // cable inherits the type of the run feeding it — colours only break where
  // the crews actually recorded a different cable, never into grey gaps.
  // Iterative walk with a seen-set: the graph can contain loops.
  const resolveCable = useMemo(() => {
    const parentOf = new Map<string, string>();
    for (const edge of data.edges.radial) {
      if (!parentOf.has(edge.to)) parentOf.set(edge.to, edge.from);
    }
    const memo = new Map<string, { label: string; color: string } | null>();
    return (poleId: string) => {
      const path: string[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined = poleId;
      let found: { label: string; color: string } | null = null;
      while (cursor && !seen.has(cursor)) {
        if (memo.has(cursor)) {
          found = memo.get(cursor) ?? null;
          break;
        }
        const own = dominantCable(data.drawing[cursor]?.items);
        if (own) {
          found = own;
          break;
        }
        seen.add(cursor);
        path.push(cursor);
        cursor = parentOf.get(cursor);
      }
      for (const id of path) memo.set(id, found);
      return found;
    };
  }, [data]);

  const scene = useMemo(() => {
    const located = data.poles.filter(
      (pole): pole is typeof pole & { latitude: number; longitude: number } =>
        pole.latitude != null && pole.longitude != null,
    );
    if (located.length === 0) return null;

    const lats = located.map((p) => p.latitude);
    const lngs = located.map((p) => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const kx = Math.cos(midLatRad);

    // Metres per degree (spherical approximation) — for the scale bar.
    const mPerDegLat = 111_320;
    const spanX = Math.max((maxLng - minLng) * kx, 1e-9);
    const spanY = Math.max(maxLat - minLat, 1e-9);
    const drawW = CANVAS_W - 2 * MARGIN;
    const scale = drawW / Math.max(spanX, spanY);
    const height = Math.ceil(spanY * scale) + 2 * MARGIN + 120; // header + legend room
    const metresPerUnit = mPerDegLat / scale;

    const positions = new Map<string, { x: number; y: number }>();
    for (const pole of located) {
      positions.set(pole.id, {
        x: MARGIN + (pole.longitude - minLng) * kx * scale,
        y: MARGIN + 60 + (maxLat - pole.latitude) * scale,
      });
    }

    // A nice round scale-bar length (…10/20/50/100 m) around an eighth of the width.
    const targetMetres = (drawW / 8) * metresPerUnit;
    const niceSteps = [10, 20, 50, 100, 200, 500, 1000];
    const barMetres =
      niceSteps.find((step) => step >= targetMetres) ??
      niceSteps[niceSteps.length - 1];
    const barPx = barMetres / metresPerUnit;

    const centreLat = (minLat + maxLat) / 2;
    const centreLng = (minLng + maxLng) / 2;

    return { located, positions, height, barMetres, barPx, centreLat, centreLng };
  }, [data]);

  if (!scene) {
    return (
      <p className="p-6 text-sm text-[var(--muted)]">
        No GPS-located poles for this Pencawang yet — the route drawing needs
        pole coordinates.
      </p>
    );
  }

  const { positions, height, barMetres, barPx, centreLat, centreLng } = scene;

  // Legend: cable classes actually drawn (incl. inherited runs) + the
  // no-data class when some run never resolved.
  const presentCables = new Set<string>();
  let hasNoCable = false;
  for (const edge of data.edges.radial) {
    const cls = resolveCable(edge.to);
    if (cls) presentCables.add(cls.label);
    else hasNoCable = true;
  }
  const legendCables = CABLE_CLASSES.filter((cls) => presentCables.has(cls.label));

  const width = CANVAS_W * zoom;

  return (
    <div className="relative h-full">
      <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-md border border-[var(--line)] bg-[var(--panel)] p-0.5 shadow-[var(--shadow-soft)]">
        <button
          type="button"
          aria-label="Zoom in"
          className="rounded p-1.5 hover:bg-[var(--panel-muted)]"
          onClick={() => setZoom((z) => Math.min(6, z * 1.4))}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className="rounded p-1.5 hover:bg-[var(--panel-muted)]"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.4))}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label="Fit"
          className="rounded p-1.5 hover:bg-[var(--panel-muted)]"
          onClick={() => setZoom(1)}
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <svg
        width={width}
        height={height * zoom}
        viewBox={`0 0 ${CANVAS_W} ${height}`}
        role="img"
        aria-label={`Lukisan laluan for ${data.substation.code}`}
        style={{ background: "#ffffff" }}
      >
        {/* Header — Pencawang name + centre coordinate, DC-sheet style. */}
        <text x={MARGIN} y={40} fontSize={20} fontWeight={700} fill="#0F172A">
          {data.substation.name?.toUpperCase() || data.substation.code}
        </text>
        <text x={MARGIN} y={62} fontSize={13} fill="#334155">
          ({centreLat.toFixed(6)}° N {centreLng.toFixed(6)}° E)
        </text>

        {/* North arrow (drawing is north-up). */}
        <g transform={`translate(${CANVAS_W - 60}, 46)`}>
          <polygon points="0,-18 7,10 0,4 -7,10" fill="#0F172A" />
          <text x={0} y={26} fontSize={12} textAnchor="middle" fill="#0F172A" fontWeight={700}>
            U
          </text>
        </g>

        {/* Spans — coloured by the fed pole's cable run (recorded, or
            inherited from upstream so runs stay continuous). */}
        {data.edges.radial.map((edge, index) => {
          const a = positions.get(edge.from);
          const b = positions.get(edge.to);
          if (!a || !b) return null;
          const cls = resolveCable(edge.to);
          return (
            <line
              key={`r-${edge.from}-${edge.to}-${edge.feeder ?? index}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={(cls ?? NO_CABLE).color}
              strokeWidth={2.4}
              strokeDasharray={cls ? undefined : "5 4"}
            />
          );
        })}

        {/* NOP ties. */}
        {data.edges.tie.map((edge) => {
          const a = positions.get(edge.from);
          const b = positions.get(edge.to);
          if (!a || !b) return null;
          return (
            <line
              key={`t-${edge.id}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#CBD5E1"
              strokeWidth={2}
              strokeDasharray="7 5"
            />
          );
        })}

        {/* Poles + annotations. */}
        {data.poles.map((pole) => {
          const pos = positions.get(pole.id);
          if (!pos) return null;
          const info = data.drawing[pole.id];
          const services = toNumber(info?.items["jumlah_service"]);
          const umbang = toNumber(info?.items["jumlah_umbang"]);
          const blackbox = toText(info?.items["jumlah_blackbox"]);
          const cable = dominantCable(info?.items);
          const saiz = toText(info?.items["saiz_tiang"]);
          // Stacked label: shared poles render each feeder line on its own
          // row, "&" kept at the end of every line but the last (DC style).
          const labelLines = pole.noTiangRondaan.split(" & ");
          return (
            <g key={pole.id}>
              <title>
                {[
                  pole.noTiangRondaan,
                  saiz ? `Saiz tiang: ${saiz}` : "",
                  cable ? `Kabel: ${cable.label}` : "Kabel: tiada data",
                  services ? `Servis: ${services}` : "",
                  umbang ? `Umbang: ${umbang}` : "",
                  blackbox ? `Blackbox: ${blackbox}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")}
              </title>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={4.5}
                fill="#ffffff"
                stroke="#0F172A"
                strokeWidth={1.6}
              />
              <text x={pos.x + 8} y={pos.y - 6} fontSize={10.5} fontWeight={600} fill="#0F172A">
                {labelLines.map((line, i) => (
                  <tspan key={i} x={pos.x + 8} dy={i === 0 ? 0 : 11}>
                    {line}
                    {i < labelLines.length - 1 ? " &" : ""}
                  </tspan>
                ))}
              </text>
              {services > 0 ? (
                <g>
                  <circle
                    cx={pos.x - 13}
                    cy={pos.y + 12}
                    r={7}
                    fill="#ffffff"
                    stroke="#0F172A"
                    strokeWidth={1.2}
                  />
                  <text
                    x={pos.x - 13}
                    y={pos.y + 15}
                    fontSize={8.5}
                    textAnchor="middle"
                    fill="#0F172A"
                  >
                    {services}
                  </text>
                </g>
              ) : null}
              {blackbox ? (
                <text x={pos.x + 8} y={pos.y + 16} fontSize={8.5} fill="#334155">
                  {blackbox}
                </text>
              ) : null}
              {umbang > 0 ? (
                <g stroke="#0F172A" strokeWidth={1.4}>
                  <line x1={pos.x - 5} y1={pos.y - 5} x2={pos.x - 14} y2={pos.y - 14} />
                  <polygon
                    points={`${pos.x - 14},${pos.y - 14} ${pos.x - 9.5},${pos.y - 12} ${pos.x - 12},${pos.y - 9.5}`}
                    fill="#0F172A"
                    stroke="none"
                  />
                  {umbang > 1 ? (
                    <text
                      x={pos.x - 18}
                      y={pos.y - 17}
                      fontSize={8.5}
                      fill="#0F172A"
                      stroke="none"
                    >
                      ×{umbang}
                    </text>
                  ) : null}
                </g>
              ) : null}
            </g>
          );
        })}

        {/* Scale bar (bottom-left). */}
        <g transform={`translate(${MARGIN}, ${height - 28})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} stroke="#0F172A" strokeWidth={2.5} />
          <line x1={0} y1={-5} x2={0} y2={5} stroke="#0F172A" strokeWidth={2} />
          <line x1={barPx} y1={-5} x2={barPx} y2={5} stroke="#0F172A" strokeWidth={2} />
          <text x={barPx / 2} y={-8} fontSize={11} textAnchor="middle" fill="#0F172A">
            {barMetres} m
          </text>
        </g>

        {/* Legend (bottom-right): cable classes present + core symbols. */}
        <g transform={`translate(${CANVAS_W - 250}, ${height - 46 - (legendCables.length + (hasNoCable ? 1 : 0)) * 16})`}>
          <text x={0} y={-8} fontSize={11} fontWeight={700} fill="#0F172A">
            PETUNJUK
          </text>
          {legendCables.map((cls, i) => (
            <g key={cls.key} transform={`translate(0, ${i * 16})`}>
              <line x1={0} y1={4} x2={30} y2={4} stroke={cls.color} strokeWidth={2.6} />
              <text x={38} y={8} fontSize={10.5} fill="#0F172A">
                {cls.label}
              </text>
            </g>
          ))}
          {hasNoCable ? (
            <g transform={`translate(0, ${legendCables.length * 16})`}>
              <line
                x1={0}
                y1={4}
                x2={30}
                y2={4}
                stroke={NO_CABLE.color}
                strokeWidth={2.6}
                strokeDasharray="5 4"
              />
              <text x={38} y={8} fontSize={10.5} fill="#0F172A">
                {NO_CABLE.label}
              </text>
            </g>
          ) : null}
          <g transform={`translate(130, 0)`}>
            <circle cx={7} cy={4} r={6} fill="#fff" stroke="#0F172A" strokeWidth={1.2} />
            <text x={7} y={7} fontSize={7.5} textAnchor="middle" fill="#0F172A">
              n
            </text>
            <text x={20} y={8} fontSize={10.5} fill="#0F172A">
              Bil. servis
            </text>
            <g stroke="#0F172A" strokeWidth={1.4}>
              <line x1={2} y1={22} x2={11} y2={13} />
              <polygon points="11,13 6.5,15 9,17.5" fill="#0F172A" stroke="none" />
            </g>
            <text x={20} y={24} fontSize={10.5} fill="#0F172A">
              Umbang
            </text>
            <text x={0} y={40} fontSize={9} fill="#334155">
              1 x 160A
            </text>
            <text x={50} y={40} fontSize={10.5} fill="#0F172A">
              Blackbox
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
