import type { DisplayStatus } from "@/types/site-visits";

export interface ReportSubstation {
  id: string;
  code: string;
  name: string;
  location: string | null;
  /** The Pencawang's coordinate — its most recent visit's check-in GPS (null if none). */
  latitude: number | null;
  longitude: number | null;
  /** Derived from the Pencawang's most recent site visit; null if none/unknown. */
  mainhead: string | null;
  /** The current survey's unified status (most recent visit); null if no survey yet. */
  displayStatus: DisplayStatus | null;
  displayStatusLabel: string | null;
  /** Distinct survey lifecycle statuses across this Pencawang's visits (legacy filter). */
  statuses: string[];
  /** Poles/assets registered under this Pencawang (0 = empty; used to hide empties). */
  assetCount: number;
  /** The current (most recent) survey's start (ISO); null = never surveyed. */
  surveyStartedAt: string | null;
  /** That same survey's Complete Visit time (ISO); null = never surveyed / still open. */
  surveyCompletedAt: string | null;
  /**
   * The most recent visit that actually HAS a compiled visual report — not simply
   * the most recent visit (a re-survey in progress has none while an older cycle
   * still holds the PDF). Null when nothing has been compiled yet.
   */
  reportVisitId: string | null;
  hasReport: boolean;
}

/** A SAVT route (one KOD TIANG, From → To) — the SAVT report's grouping unit. */
/** GPS span totals for a SAVT route (API common/savt-spans.ts). */
export interface SavtSpanSummary {
  poleCount: number;
  /** Measured spans (everything except GAP and NO_GPS). */
  spanCount: number;
  /** Sum of the measured spans, metres. */
  measuredLength: number;
  medianSpan: number | null;
  longest: { metres: number; fromNoTiang: string; toNoTiang: string } | null;
  flaggedCount: number;
  gapCount: number;
  /** Straight-line metres across No. Tiang gaps (under-reads the cable). */
  gapLength: number;
  noGpsCount: number;
}

export interface ReportSavtRoute {
  /** "<From Pencawang id>:<KOD TIANG>" — the KOD TIANG alone is not unique. */
  routeKey: string;
  routeCode: string;
  fromName: string;
  fromCode: string;
  fromFunctionalLocation: string;
  toName: string;
  toCode: string;
  /** Derived from the route's most recent visit; null if none/unknown. */
  mainhead: string | null;
  /** Distinct inspected poles on this route. */
  poleCount: number;
  /** The route's coordinate — its most recent visit's check-in GPS (null if none). */
  latitude: number | null;
  longitude: number | null;
  /** The current survey's unified status (most recent visit); null if none. */
  displayStatus: DisplayStatus | null;
  displayStatusLabel: string | null;
  /** Distinct survey lifecycle statuses across this route's visits (legacy filter). */
  statuses: string[];
  /** The current (most recent) survey's start (ISO); null = never started. */
  surveyStartedAt: string | null;
  /** That same survey's Complete Visit time (ISO); null = still open. */
  surveyCompletedAt: string | null;
  /** Newest visit on the route carrying a compiled visual report; null if none. */
  reportVisitId: string | null;
  hasReport: boolean;
  /** GPS span totals; null when the route has no poles on record yet. */
  spanSummary: SavtSpanSummary | null;
}
