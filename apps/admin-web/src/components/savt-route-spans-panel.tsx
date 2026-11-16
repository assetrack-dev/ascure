"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Ruler, Search, X } from "lucide-react";
import {
  Card,
  CardHead,
  Chip,
  Seg,
  tableCellClass,
  tableHeadCellClass,
  tableHeadClass,
  tableMonoCellClass,
  tableRowClass,
  type Tone,
} from "@/components/ui";
import {
  fetchSavtRouteSpans,
  formatSpanLength,
  SPAN_FLAG_LABEL,
  SPAN_MAP_COLOR,
  spanFlagHint,
  spanKey,
  type SavtRouteSpans,
  type SavtSpan,
  type SavtSpanFlag,
} from "@/lib/savt-spans";

const FLAG_TONE: Record<SavtSpanFlag, Tone> = {
  GAP: "neutral",
  LONG: "high",
  SHORT: "monitor",
  NO_GPS: "critical",
};

const FLAG_STROKE: Record<SavtSpanFlag | "OK", string> = {
  OK: "var(--brand)",
  GAP: "var(--muted)",
  LONG: "var(--high)",
  SHORT: "var(--monitor)",
  NO_GPS: "var(--critical)",
};

type SpanFilter = "FLAGGED" | "ALL";

// Google Maps loads only in the browser, only when the card shows.
const SavtRouteSpansMap = dynamic(() => import("@/components/savt-route-spans-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
      Loading map…
    </div>
  ),
});

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** "149", "12/1" — compare No. Tiang typed in the search box. */
function normaliseNoTiang(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
      {(["OK", "LONG", "SHORT", "GAP"] as const).map((flag) => (
        <span key={flag} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line
              x1="1"
              y1="3"
              x2="17"
              y2="3"
              stroke={flag === "GAP" ? "var(--muted)" : SPAN_MAP_COLOR[flag]}
              strokeWidth={3}
              strokeDasharray={flag === "GAP" ? "4 3" : undefined}
            />
          </svg>
          {flag === "OK" ? "Span" : SPAN_FLAG_LABEL[flag]}
        </span>
      ))}
      <span className="ml-auto">
        Click a span for its row · metres on every span from street zoom
      </span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5" title={hint}>
      <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-0.5 truncate text-lg font-bold text-[var(--foreground)]">{value}</p>
    </div>
  );
}

/**
 * Schematic of the route drawn from the poles' own GPS (no base map): each span
 * is a line from the parent pole to the pole, coloured by its flag. Hover a
 * line for its distance; click it to pick that span in the table.
 */
function RouteSketch({
  data,
  selected,
  onSelect,
}: {
  data: SavtRouteSpans;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const geometry = useMemo(() => {
    const located = data.poles.filter(
      (pole) =>
        pole.latitude != null &&
        pole.longitude != null &&
        !(pole.latitude === 0 && pole.longitude === 0),
    );
    if (located.length < 2) {
      return null;
    }
    const lats = located.map((pole) => pole.latitude as number);
    const lngs = located.map((pole) => pole.longitude as number);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    // Equirectangular: a degree of longitude is cos(lat) of a degree of latitude.
    const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const spanX = Math.max((maxLng - minLng) * kx, 1e-9);
    const spanY = Math.max(maxLat - minLat, 1e-9);
    const width = 800;
    const pad = 18;
    // Keep the route's real proportions; cap the height for long straight routes.
    const height = Math.min(320, Math.max(140, ((width - pad * 2) * spanY) / spanX + pad * 2));
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const offsetX = (width - spanX * scale) / 2;
    const offsetY = (height - spanY * scale) / 2;
    const point = new Map<string, { x: number; y: number }>();
    for (const pole of located) {
      point.set(pole.assetId, {
        x: offsetX + ((pole.longitude as number) - minLng) * kx * scale,
        y: height - (offsetY + ((pole.latitude as number) - minLat) * scale),
      });
    }
    return { width, height, point, located };
  }, [data.poles]);

  if (!geometry) {
    return null;
  }
  const { width, height, point, located } = geometry;
  const first = located[0];
  const last = located[located.length - 1];
  return (
    <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel-muted)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`Route sketch of ${data.poles.length} poles from GPS`}
      >
        {data.spans.map((span) => {
          const a = point.get(span.fromAssetId);
          const b = point.get(span.toAssetId);
          if (!a || !b) {
            return null;
          }
          const key = spanKey(span);
          const isSelected = key === selected;
          return (
            <g key={key} className="cursor-pointer" onClick={() => onSelect(key)}>
              <title>
                {`${span.fromNoTiang} → ${span.toNoTiang} · ${
                  span.metres != null ? formatSpanLength(span.metres) : "no GPS"
                }${span.flag ? ` · ${SPAN_FLAG_LABEL[span.flag]}` : ""}`}
              </title>
              {/* Wide transparent hit area so thin lines are easy to click. */}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={FLAG_STROKE[span.flag ?? "OK"]}
                strokeWidth={isSelected ? 5 : span.flag && span.flag !== "GAP" ? 3 : 2}
                strokeDasharray={span.flag === "GAP" ? "6 5" : undefined}
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {located.map((pole) => {
          const p = point.get(pole.assetId)!;
          return (
            <circle key={pole.assetId} cx={p.x} cy={p.y} r={2.6} fill="var(--foreground-soft)">
              <title>{`No. Tiang ${pole.noTiang}`}</title>
            </circle>
          );
        })}
        {[
          [first, located[1]],
          [last, located[located.length - 2]],
        ].map(([pole, neighbour], index) => {
          const p = point.get(pole.assetId)!;
          const q = point.get(neighbour.assetId)!;
          // Put the end label on the far side from its neighbour, off the line.
          const length = Math.hypot(p.x - q.x, p.y - q.y) || 1;
          const dx = (p.x - q.x) / length;
          const dy = (p.y - q.y) / length;
          const x = Math.min(width - 4, Math.max(4, p.x + dx * 10));
          const y = Math.min(height - 4, Math.max(12, p.y + dy * 10 + 4));
          return (
            <text
              key={`label-${index}`}
              x={x}
              y={y}
              textAnchor={dx < -0.3 ? "end" : dx > 0.3 ? "start" : "middle"}
              fontSize={12}
              fontWeight={700}
              fill="var(--foreground)"
            >
              {pole.noTiang}
            </text>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-[11.5px] text-[var(--muted)]">
        {(["OK", "LONG", "SHORT", "GAP"] as const).map((flag) => (
          <span key={flag} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="1"
                y1="3"
                x2="17"
                y2="3"
                stroke={FLAG_STROKE[flag]}
                strokeWidth={flag === "OK" || flag === "GAP" ? 2 : 3}
                strokeDasharray={flag === "GAP" ? "4 3" : undefined}
              />
            </svg>
            {flag === "OK" ? "Span" : SPAN_FLAG_LABEL[flag]}
          </span>
        ))}
        <span className="ml-auto">Drawn from pole GPS · north is up</span>
      </div>
    </div>
  );
}

/**
 * "Route spans" on a SAVT route survey (TNB ask 2026-11-16): the GPS distance
 * between consecutive poles on this line, the route totals, and the spans to
 * check (No. Tiang gap / unusually long / very short / no GPS).
 */
export function SavtRouteSpansPanel({
  token,
  siteVisitId,
}: {
  token: string | null;
  siteVisitId: string;
}) {
  const [data, setData] = useState<SavtRouteSpans | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<SpanFilter | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mapError, setMapError] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const onMapError = useCallback(() => setMapError(true), []);

  useEffect(() => {
    if (!token) {
      return;
    }
    let cancelled = false;
    fetchSavtRouteSpans(token, siteVisitId)
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setFailed(false);
        }
      })
      .catch(() => {
        // Supplementary view — never block the visit page on it.
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, siteVisitId]);

  const poleById = useMemo(
    () => new Map((data?.poles ?? []).map((pole) => [pole.assetId, pole])),
    [data],
  );

  // A span picked on the map: make sure its row is listed, then scroll to it.
  const pickFromMap = useCallback(
    (key: string) => {
      setSelected(key);
      const span = data?.spans.find((item) => spanKey(item) === key);
      if (span && !span.flag) {
        setFilter("ALL");
      }
      setQuery("");
    },
    [data],
  );
  useEffect(() => {
    if (selected) {
      rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected, filter, query]);

  if (failed) {
    return null;
  }
  if (!data) {
    return (
      <Card>
        <CardHead title={<PanelTitle />} />
        <p className="mt-3 text-sm text-[var(--muted)]">Measuring spans…</p>
      </Card>
    );
  }

  const { summary, spans } = data;
  const flagged = spans.filter((span) => span.flag != null);
  // Default to the spans that need a look, when there are any.
  const activeFilter: SpanFilter = filter ?? (flagged.length > 0 ? "FLAGGED" : "ALL");
  // The No. Tiang search looks across ALL spans (either end matches).
  const needle = normaliseNoTiang(query);
  const rows = needle
    ? spans.filter(
        (span) =>
          normaliseNoTiang(span.toNoTiang).startsWith(needle) ||
          normaliseNoTiang(span.fromNoTiang).startsWith(needle),
      )
    : activeFilter === "FLAGGED"
      ? flagged
      : spans;

  if (spans.length === 0) {
    return (
      <Card>
        <CardHead title={<PanelTitle />} />
        <p className="mt-3 text-sm text-[var(--muted)]">
          {data.poles.length === 0
            ? "No poles recorded on this route yet."
            : "Only one pole on this route so far — spans appear from pole 2."}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHead
        title={<PanelTitle />}
        hint="Straight-line GPS distance from each pole to the one before it on this route"
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Length"
          value={formatSpanLength(summary.measuredLength)}
          hint="Sum of the measured spans. GAP spans are left out; real cable is a little longer (sag, bends)."
        />
        <Stat
          label="Spans"
          value={String(summary.spanCount)}
          hint="Measured spans (No. Tiang gaps and spans without GPS are not counted)"
        />
        <Stat
          label="Typical"
          value={summary.medianSpan != null ? formatSpanLength(summary.medianSpan) : "—"}
          hint="Median trunk span on this route"
        />
        <Stat
          label="Longest"
          value={summary.longest ? formatSpanLength(summary.longest.metres) : "—"}
          hint={
            summary.longest
              ? `No. Tiang ${summary.longest.fromNoTiang} → ${summary.longest.toNoTiang}`
              : undefined
          }
        />
        <Stat label="To check" value={String(summary.flaggedCount)} />
        <Stat
          label="Gaps"
          value={
            summary.gapCount > 0
              ? `${summary.gapCount} · ${formatSpanLength(summary.gapLength)}`
              : "0"
          }
          hint="No. Tiang jumps — the straight line across them is not counted in the length"
        />
      </div>

      {GOOGLE_MAPS_API_KEY && !mapError ? (
        <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--line)]">
          <div className="h-[460px] w-full">
            <SavtRouteSpansMap
              apiKey={GOOGLE_MAPS_API_KEY}
              onLoadError={onMapError}
              poles={data.poles}
              spans={data.spans}
              selectedKey={selected}
              onSelect={pickFromMap}
            />
          </div>
          <MapLegend />
        </div>
      ) : (
        // No Maps key / the map failed to load: the GPS sketch instead.
        <RouteSketch data={data} selected={selected} onSelect={pickFromMap} />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Seg<SpanFilter>
          aria-label="Which spans to list"
          value={activeFilter}
          onChange={(next) => {
            setFilter(next);
            setQuery("");
          }}
          options={[
            { value: "FLAGGED", label: `To check (${flagged.length})` },
            { value: "ALL", label: `All spans (${spans.length})` },
          ]}
        />
        <label className="relative flex h-[38px] min-w-[180px] flex-1 items-center sm:max-w-[240px]">
          <Search size={14} className="pointer-events-none absolute left-3 text-[var(--muted)]" />
          <input
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              // An exact No. Tiang picks the span INTO that pole (map zooms).
              const exact = spans.find(
                (span) => normaliseNoTiang(span.toNoTiang) === normaliseNoTiang(next),
              );
              if (exact) {
                setSelected(spanKey(exact));
              }
            }}
            placeholder="Find No. Tiang, e.g. 149"
            aria-label="Find a span by No. Tiang"
            className="h-full w-full rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--panel)] pl-8 pr-8 text-[13px] text-[var(--foreground)] placeholder:text-[var(--muted-2)] focus:border-[var(--brand)] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 rounded p-1 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          {needle
            ? `No span with No. Tiang ${query.trim()} on this route.`
            : "Nothing to check — every span on this route looks normal."}
        </p>
      ) : (
        <div className="mt-3 max-h-[420px] overflow-auto rounded-[var(--radius-control)] border border-[var(--line)]">
          <table className="w-full min-w-[560px] border-collapse">
            <thead className={`${tableHeadClass} sticky top-0 z-[1]`}>
              <tr>
                <th className={tableHeadCellClass}>Span (No. Tiang)</th>
                <th className={`${tableHeadCellClass} text-right`}>Distance</th>
                <th className={tableHeadCellClass} title="Recorded on the TO pole of the span">
                  Kelegaan
                </th>
                <th className={tableHeadCellClass}>Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((span) => {
                const key = spanKey(span);
                const to = poleById.get(span.toAssetId);
                return (
                  <tr
                    key={key}
                    ref={(row) => {
                      if (row) rowRefs.current.set(key, row);
                      else rowRefs.current.delete(key);
                    }}
                    onClick={() => setSelected(key)}
                    className={`${tableRowClass} cursor-pointer ${
                      key === selected ? "bg-[var(--brand-tint)]" : ""
                    }`}
                  >
                    <td className={tableMonoCellClass}>
                      {span.fromNoTiang} →{" "}
                      <Link
                        href={`/assets/${span.toAssetId}`}
                        className="font-semibold text-[var(--foreground)] hover:text-[var(--brand)]"
                        title={to?.assetCode}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {span.toNoTiang}
                      </Link>
                      {span.branch ? (
                        <span className="ml-1.5 text-[11px] text-[var(--muted)]">branch</span>
                      ) : null}
                    </td>
                    <td className={`${tableMonoCellClass} text-right`}>
                      {span.metres != null ? `${span.metres.toFixed(1)} m` : "—"}
                    </td>
                    <td className={tableMonoCellClass}>{to?.kelegaan ?? "—"}</td>
                    <td className={tableCellClass}>
                      {span.flag ? (
                        <div className="flex flex-col items-start gap-1">
                          <Chip tone={FLAG_TONE[span.flag]}>{SPAN_FLAG_LABEL[span.flag]}</Chip>
                          <span className="text-[12px] text-[var(--muted)]">{spanFlagHint(span)}</span>
                        </div>
                      ) : (
                        <span className="text-[12px] text-[var(--muted-2)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[12px] text-[var(--muted)]">
        Long = over {data.thresholds.longMinMetres} m and over{" "}
        {data.thresholds.longMedianFactor}× this route&apos;s typical span. Very short = under{" "}
        {data.thresholds.shortMetres} m. Pole 1 has no span (the From Pencawang has no stored
        location). The same columns are in the route&apos;s checklist download.
      </p>
    </Card>
  );
}

function PanelTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <Ruler size={16} className="text-[var(--brand)]" />
      Route spans
    </span>
  );
}
