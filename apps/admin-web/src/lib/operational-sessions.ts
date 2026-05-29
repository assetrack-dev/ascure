import { apiRequest } from "@/lib/api";
import type {
  BulkAssignSessionAssetsResult,
  CreateOperationalSessionPayload,
  OperationalSession,
  OperationalSessionAssignedAsset,
  OperationalSessionFilters,
} from "@/types/operational-sessions";

function compactPayload(payload: object) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""),
  );
}

function toQueryString(filters: OperationalSessionFilters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const queryString = params.toString();

  return queryString ? `?${queryString}` : "";
}

export function fetchOperationalSessions(
  token: string,
  filters: OperationalSessionFilters = {},
) {
  return apiRequest<OperationalSession[]>(
    `/operational-sessions${toQueryString(filters)}`,
    { token },
  );
}

export function fetchOperationalSessionDetail(token: string, sessionId: string) {
  return apiRequest<OperationalSession>(
    `/operational-sessions/${encodeURIComponent(sessionId)}`,
    { token },
  );
}

export function getSessionAssets(token: string, sessionId: string) {
  return apiRequest<OperationalSessionAssignedAsset[]>(
    `/operational-sessions/${encodeURIComponent(sessionId)}/assets`,
    { token },
  );
}

export function createOperationalSession(
  token: string,
  payload: CreateOperationalSessionPayload,
) {
  return apiRequest<OperationalSession>("/operational-sessions", {
    method: "POST",
    token,
    body: JSON.stringify(compactPayload(payload)),
  });
}

export function assignSessionAsset(
  token: string,
  sessionId: string,
  assetId: string,
  notes?: string,
) {
  return apiRequest<OperationalSessionAssignedAsset>(
    `/operational-sessions/${encodeURIComponent(sessionId)}/assets`,
    {
      method: "POST",
      token,
      body: JSON.stringify(
        compactPayload({
          assetId,
          notes,
        }),
      ),
    },
  );
}

export function bulkAssignSessionAssets(
  token: string,
  sessionId: string,
  assetIds: string[],
) {
  return apiRequest<BulkAssignSessionAssetsResult>(
    `/operational-sessions/${encodeURIComponent(sessionId)}/assets/bulk`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        assetIds,
      }),
    },
  );
}

export function removeSessionAsset(token: string, sessionId: string, assetId: string) {
  return apiRequest<OperationalSessionAssignedAsset>(
    `/operational-sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(
      assetId,
    )}`,
    {
      method: "DELETE",
      token,
    },
  );
}

export type OperationalSessionLifecycleAction =
  | "start"
  | "submit"
  | "send-to-qa"
  | "approve"
  | "request-amendment"
  | "reject"
  | "cancel";

export function runOperationalSessionLifecycleAction(
  token: string,
  sessionId: string,
  action: OperationalSessionLifecycleAction,
  remarks?: string,
) {
  return apiRequest<OperationalSession>(
    `/operational-sessions/${encodeURIComponent(sessionId)}/${action}`,
    {
      method: "POST",
      token,
      body:
        remarks === undefined
          ? undefined
          : JSON.stringify({
              remarks,
            }),
    },
  );
}
