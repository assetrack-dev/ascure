import { apiRequest } from "@/lib/api";
import type { SavtSpanSummary } from "@/types/reports";

/**
 * SAVT cable spans (TNB ask 2026-11-16): straight-line GPS distance from each
 * pole to its parent pole on the same route (API common/savt-spans.ts).
 */
export type SavtSpanFlag = "NO_GPS" | "GAP" | "SHORT" | "LONG";

export interface SavtSpan {
  fromAssetId: string;
  toAssetId: string;
  fromNoTiang: string;
  toNoTiang: string;
  /** Metres, 1 dp; null when either end has no GPS. */
  metres: number | null;
  branch: boolean;
  flag: SavtSpanFlag | null;
  /** GAP only: the No. Tiang range nobody recorded. */
  missing: [number, number] | null;
}

export interface SavtSpanPole {
  assetId: string;
  assetCode: string;
  noTiang: string;
  latitude: number | null;
  longitude: number | null;
  /** Latest KELEGAAN reading on this pole (it sits on the TO pole of a span). */
  kelegaan: string | null;
  shared: boolean;
}

export interface SavtRouteSpans {
  routeCode: string | null;
  /** null = no poles recorded on this route yet. */
  feederId: string | null;
  poles: SavtSpanPole[];
  spans: SavtSpan[];
  summary: SavtSpanSummary;
  thresholds: { shortMetres: number; longMinMetres: number; longMedianFactor: number };
}

export function fetchSavtRouteSpans(token: string, siteVisitId: string) {
  return apiRequest<SavtRouteSpans>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/savt-spans`,
    { token },
  );
}

/** "820 m" / "1.24 km". */
export function formatSpanLength(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(2)} km`
    : `${Math.round(metres)} m`;
}

export const SPAN_FLAG_LABEL: Record<SavtSpanFlag, string> = {
  GAP: "No. Tiang gap",
  LONG: "Long span",
  SHORT: "Very short",
  NO_GPS: "No GPS",
};

/** What to do about a flagged span, in one line. */
export function spanFlagHint(span: Pick<SavtSpan, "flag" | "missing">): string {
  switch (span.flag) {
    case "GAP":
      return span.missing
        ? `No. Tiang ${
            span.missing[0] === span.missing[1]
              ? span.missing[0]
              : `${span.missing[0]}–${span.missing[1]}`
          } not recorded — straight line, not counted in the length`
        : "Numbering out of sequence";
    case "LONG":
      return "Much longer than this route's usual span — check the GPS or the numbering";
    case "SHORT":
      return "Poles almost on top of each other — possibly the same pole twice";
    case "NO_GPS":
      return "One of the poles has no GPS fix";
    default:
      return "";
  }
}
