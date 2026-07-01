export interface ReportSubstation {
  id: string;
  code: string;
  name: string;
  location: string | null;
  /** Derived from the Pencawang's most recent site visit; null if none/unknown. */
  mainhead: string | null;
  /** Distinct survey lifecycle statuses across this Pencawang's visits (for the status filter). */
  statuses: string[];
  /** Poles/assets registered under this Pencawang (0 = empty; used to hide empties). */
  assetCount: number;
}

/** A SAVT route (one KOD TIANG, From → To) — the SAVT report's grouping unit. */
export interface ReportSavtRoute {
  routeCode: string;
  fromName: string;
  fromCode: string;
  fromFunctionalLocation: string;
  toName: string;
  toCode: string;
  /** Distinct inspected poles on this route. */
  poleCount: number;
  /** Distinct survey lifecycle statuses across this route's visits (for the status filter). */
  statuses: string[];
}
