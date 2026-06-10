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
