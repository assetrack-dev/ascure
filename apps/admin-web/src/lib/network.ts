import { apiRequest } from "@/lib/api";

export interface NetworkPole {
  id: string;
  noTiangRondaan: string;
  noTiangLama: string | null;
  latitude: number | null;
  longitude: number | null;
  fedFromAssetId: string | null;
  feeders: string[];
}

export interface RadialEdge {
  from: string;
  to: string;
  /** Feeder code this span belongs to — colours the edge; multi-feeder runs
   *  between the same pair appear as parallel, per-feeder lines. */
  feeder?: string;
}

export interface TieEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  switchState: string;
}

export interface SubstationNetwork {
  substation: { id: string; code: string; name: string };
  feeders: { id: string; code: string; name: string | null }[];
  poles: NetworkPole[];
  edges: { radial: RadialEdge[]; tie: TieEdge[] };
}

export interface IsolatedPole {
  id: string;
  noTiangRondaan: string;
  noTiangLama: string | null;
}

export interface BackfeedOption {
  tieEdgeId: string;
  kind: string;
  switchState: string;
  deEnergizedPole: IsolatedPole;
  sourcePole: IsolatedPole;
}

export interface FeederIsolation {
  feeder: { id: string; code: string; name: string | null };
  deEnergizedCount: number;
  deEnergized: IsolatedPole[];
  backfeed: BackfeedOption[];
}

export function fetchSubstationNetwork(token: string, substationId: string) {
  return apiRequest<SubstationNetwork>(
    `/network/substations/${encodeURIComponent(substationId)}`,
    { token },
  );
}

/** Per-pole attributes for the route drawing: the latest submitted
 *  inspection's checklist values, classified to canonical drawing keys
 *  (cable classes, jumlah_umbang, jumlah_blackbox, jumlah_service). */
export interface RouteDrawingPoleData {
  items: Record<string, string | number | boolean | unknown>;
}

export interface RouteDrawing extends SubstationNetwork {
  drawing: Record<string, RouteDrawingPoleData>;
}

export function fetchRouteDrawing(token: string, substationId: string) {
  return apiRequest<RouteDrawing>(
    `/network/substations/${encodeURIComponent(substationId)}/route-drawing`,
    { token },
  );
}

export function fetchFeederIsolation(token: string, feederId: string) {
  return apiRequest<FeederIsolation>(
    `/network/feeders/${encodeURIComponent(feederId)}/isolation`,
    { token },
  );
}

export function createTieEdge(
  token: string,
  body: { fromAssetId: string; toAssetId: string },
) {
  return apiRequest<{ id: string; switchState: string }>("/network/tie-edges", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

export function setTieEdgeState(token: string, id: string, switchState: "OPEN" | "CLOSED") {
  return apiRequest<{ id: string; switchState: string }>(
    `/network/tie-edges/${encodeURIComponent(id)}/state`,
    { method: "PATCH", token, body: JSON.stringify({ switchState }) },
  );
}
