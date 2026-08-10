import { apiRequest } from "@/lib/api";

/**
 * The network owner's (TNB / CLIENT) read-only progress view.
 *
 * ⚠ Scope is by MAINHEAD, not by team or company — the client sees every survey
 * on their assigned Mainheads whichever contractor performed it. The API fails
 * closed (an org with no assignment sees nothing), so an empty result here is a
 * legitimate answer, not an error to retry.
 */

export interface ProgressGroup {
  id: string;
  name: string;
  total: number;
  inspected: number;
  percent: number;
  openDefects: number;
  emergency: number;
}

export interface ProgressLabelCount {
  label: string;
  value: number;
}

export interface ClientProgress {
  /** "mainhead" = the roll-up; "pencawang" = drilled into one Mainhead. */
  level: "mainhead" | "pencawang";
  mainheadId: string | null;
  total: number;
  inspected: number;
  percent: number;
  lastInspectionAt: string | null;
  groups: ProgressGroup[];
  /** Pencawang in scope, and how many are fully surveyed. */
  pencawang: {
    total: number;
    completed: number;
    percent: number;
  };
  defects: {
    open: number;
    emergency: number;
    bySeverity: ProgressLabelCount[];
    byCategory: ProgressLabelCount[];
  };
}

export interface ClientPole {
  id: string;
  assetCode: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  inspectionId: string | null;
  inspectedAt: string | null;
  visitId: string | null;
  lifecycleStatus: string | null;
  /** NOT_SURVEYED = registered but nobody has submitted it yet. */
  surveyState: "SURVEYED" | "NOT_SURVEYED";
  /** The survey has left the field (RONDAAN SELESAI onward). */
  isFinished: boolean;
  photoCount: number;
  defects: { id: string; label: string; severity: string | null }[];
}

export interface ClientPoleList {
  substation: { id: string; name: string };
  /** True count in the Pencawang — `poles` may be truncated by the API. */
  total: number;
  poles: ClientPole[];
}

/** One survey on the client's network, at ANY lifecycle stage. */
export interface ClientSurvey {
  id: string;
  pencawang: string;
  pencawangId: string | null;
  mainhead: string;
  mainheadId: string | null;
  lifecycleStatus: string | null;
  isFinished: boolean;
  startedAt: string | null;
  completedAt: string | null;
  poleCount: number;
  surveyedCount: number;
  openDefects: number;
  emergency: number;
}

export interface ClientVisitList {
  /** True count in scope — `visits` may be truncated by the API. */
  total: number;
  visits: ClientSurvey[];
}

export interface ClientVisitDetail {
  visit: ClientSurvey;
  /** True pole count on the survey — `poles` may be truncated by the API. */
  total: number;
  poles: ClientPole[];
}

export async function fetchClientProgress(
  token: string,
  mainheadId?: string,
): Promise<ClientProgress> {
  const query = mainheadId
    ? `?mainheadId=${encodeURIComponent(mainheadId)}`
    : "";
  return apiRequest<ClientProgress>(`/client/progress${query}`, { token });
}

export async function fetchClientMainheads(
  token: string,
): Promise<{ id: string; name: string }[]> {
  return apiRequest<{ id: string; name: string }[]>("/client/mainheads", {
    token,
  });
}

export async function fetchClientSurveys(
  token: string,
): Promise<ClientSurvey[]> {
  return apiRequest<ClientSurvey[]>("/client/surveys", { token });
}

export async function fetchClientPoles(
  token: string,
  substationId: string,
): Promise<ClientPoleList> {
  return apiRequest<ClientPoleList>(
    `/client/pencawang/${encodeURIComponent(substationId)}/poles`,
    { token },
  );
}

export async function fetchClientVisits(
  token: string,
  mainheadId?: string,
): Promise<ClientVisitList> {
  const query = mainheadId
    ? `?mainheadId=${encodeURIComponent(mainheadId)}`
    : "";
  return apiRequest<ClientVisitList>(`/client/visits${query}`, { token });
}

export async function fetchClientVisit(
  token: string,
  visitId: string,
): Promise<ClientVisitDetail> {
  return apiRequest<ClientVisitDetail>(
    `/client/visits/${encodeURIComponent(visitId)}`,
    { token },
  );
}
