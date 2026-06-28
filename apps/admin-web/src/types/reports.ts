export interface ReportSubstation {
  id: string;
  code: string;
  name: string;
  location: string | null;
  /** Derived from the Pencawang's most recent site visit; null if none/unknown. */
  mainhead: string | null;
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
}
