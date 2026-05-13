import { apiRequest } from "@/lib/api";
import type {
  DefectActor,
  DefectAssignedTeam,
  DefectDetail,
  DefectEvidenceImage,
  DefectListItem,
  DefectSeverity,
  DefectSlaState,
  DefectStatus,
  DefectTimelineEntry,
  DefectTimelineEventType,
  DefectWorkflowStatus,
} from "@/types/defects";

type ApiRecord = Record<string, unknown>;

function asRecord(value: unknown): ApiRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiRecord)
    : null;
}

function readString(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function firstString(record: ApiRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = readString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function nestedRecord(record: ApiRecord | null, key: string) {
  return asRecord(record?.[key]);
}

function readArray(record: ApiRecord | null, key: string) {
  const value = record?.[key];

  return Array.isArray(value) ? value : [];
}

function readNumber(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  return null;
}

function readBoolean(record: ApiRecord | null, key: string) {
  if (!record || !(key in record)) {
    return null;
  }

  const value = record[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return null;
}

function normalizeSeverity(value: string | null): DefectSeverity | null {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue === "CRIT" || normalizedValue === "SEVERE") {
    return "CRITICAL";
  }

  if (normalizedValue === "MAJOR") {
    return "HIGH";
  }

  if (normalizedValue === "MODERATE" || normalizedValue === "MED") {
    return "MEDIUM";
  }

  if (normalizedValue === "MINOR") {
    return "LOW";
  }

  if (
    normalizedValue === "CRITICAL" ||
    normalizedValue === "HIGH" ||
    normalizedValue === "MEDIUM" ||
    normalizedValue === "LOW"
  ) {
    return normalizedValue;
  }

  return null;
}

function normalizeStatus(value: string | null): DefectStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (normalizedValue === "OPEN") {
    return "OPEN";
  }

  if (normalizedValue === "IN_PROGRESS" || normalizedValue === "INPROGRESS") {
    return "IN_PROGRESS";
  }

  if (normalizedValue === "MONITORING") {
    return "MONITORING";
  }

  if (normalizedValue === "RESOLVED") {
    return "RESOLVED";
  }

  if (normalizedValue === "CLOSED") {
    return "CLOSED";
  }

  return "UNKNOWN";
}

function normalizeSlaState(value: string | null): DefectSlaState {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "OVERDUE" ||
    normalizedValue === "ON_TRACK" ||
    normalizedValue === "NO_DUE_DATE" ||
    normalizedValue === "STOPPED"
  ) {
    return normalizedValue;
  }

  return "UNKNOWN";
}

function computeSlaState(status: DefectStatus, dueDate: string | null): DefectSlaState {
  if (status === "CLOSED" || status === "RESOLVED") {
    return "STOPPED";
  }

  if (!dueDate) {
    return "NO_DUE_DATE";
  }

  const parsedDueDate = new Date(dueDate);

  if (Number.isNaN(parsedDueDate.getTime())) {
    return "UNKNOWN";
  }

  if (
    (status === "OPEN" || status === "IN_PROGRESS" || status === "MONITORING") &&
    parsedDueDate.getTime() < Date.now()
  ) {
    return "OVERDUE";
  }

  return "ON_TRACK";
}

function normalizeNullableStatus(value: string | null) {
  if (!value) {
    return null;
  }

  return normalizeStatus(value);
}

function normalizeTimelineEventType(value: string | null): DefectTimelineEventType {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "CREATED" ||
    normalizedValue === "STATUS_CHANGED" ||
    normalizedValue === "ASSIGNMENT_CHANGED" ||
    normalizedValue === "DUE_DATE_CHANGED" ||
    normalizedValue === "COMMENT"
  ) {
    return normalizedValue;
  }

  return "COMMENT";
}

function readDate(record: ApiRecord | null) {
  return firstString(record, ["submittedAt", "date", "createdAt", "updatedAt"]);
}

function readLocation(record: ApiRecord | null) {
  const asset = nestedRecord(record, "asset");
  const substation = nestedRecord(record, "substation") ?? nestedRecord(asset, "substation");
  const siteVisit = nestedRecord(record, "siteVisit");
  const siteVisitSubstation = nestedRecord(siteVisit, "substation");
  const latitude = readNumber(record, "latitude") ?? readNumber(asset, "latitude");
  const longitude = readNumber(record, "longitude") ?? readNumber(asset, "longitude");

  return (
    firstString(record, [
      "location",
      "substationLocation",
      "assetLocation",
      "address",
    ]) ??
    firstString(substation, ["location", "name", "code"]) ??
    firstString(siteVisitSubstation, ["location", "name", "code"]) ??
    (latitude !== null && longitude !== null
      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      : null)
  );
}

function extractDefectArray(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["data", "items", "defects", "results"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizeDefect(rawDefect: unknown, index: number): DefectListItem | null {
  const record = asRecord(rawDefect);

  if (!record) {
    return null;
  }

  const asset = nestedRecord(record, "asset");
  const date = readDate(record);
  const inspectionItemResultId = firstString(record, ["inspectionItemResultId", "itemResultId"]);
  const assignedUser = normalizeActor(record.assignedUser);
  const assignedTeam = normalizeTeam(record.assignedTeam);
  const dueDate = firstString(record, ["dueDate"]);
  const status = normalizeStatus(firstString(record, ["status"]));
  const normalizedSlaState = normalizeSlaState(firstString(record, ["slaState"]));
  const slaState =
    normalizedSlaState === "UNKNOWN" ? computeSlaState(status, dueDate) : normalizedSlaState;
  const id =
    firstString(record, ["id", "defectId"]) ??
    inspectionItemResultId ??
    `defect-${index}`;
  const assetCode =
    firstString(record, ["assetCode", "asset_code", "asset"]) ??
    firstString(asset, ["assetCode", "code"]) ??
    "Unassigned";

  return {
    id,
    inspectionItemResultId: inspectionItemResultId ?? undefined,
    assignedUserId: firstString(record, ["assignedUserId", "assigneeUserId"]),
    assignedTeamId: firstString(record, ["assignedTeamId", "assigneeTeamId"]),
    assignedUser,
    assignedTeam,
    assignedTo:
      firstString(record, ["assignedTo", "assignee"]) ??
      formatAssignmentDisplay(assignedUser, assignedTeam),
    inspectionId: firstString(record, ["inspectionId"]) ?? undefined,
    assetId: firstString(record, ["assetId"]) ?? undefined,
    assetCode,
    assetType:
      firstString(record, ["assetType"]) ?? firstString(nestedRecord(asset, "assetType"), ["name", "code"]),
    defectType:
      firstString(record, ["defectType", "type", "label", "defectTitle", "title", "code"]) ??
      "Unspecified defect",
    severity: normalizeSeverity(
      firstString(record, ["severity", "defectSeverity", "priority"]),
    ),
    status,
    date,
    location: readLocation(record),
    remark: firstString(record, ["remark", "checklistRemark", "description"]),
    actionRemark: firstString(record, ["actionRemark"]),
    dueDate,
    resolvedAt: firstString(record, ["resolvedAt"]),
    closedAt: firstString(record, ["closedAt"]),
    isOverdue: readBoolean(record, "isOverdue") ?? slaState === "OVERDUE",
    slaState,
    submittedAt: firstString(record, ["submittedAt"]),
    createdAt: firstString(record, ["createdAt"]),
  };
}

function normalizeActor(rawActor: unknown): DefectActor | null {
  const record = asRecord(rawActor);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id", "userId"]);

  if (!id) {
    return null;
  }

  return {
    id,
    email: firstString(record, ["email"]),
    name: firstString(record, ["name"]),
    role: firstString(record, ["role"]),
  };
}

function normalizeTeam(rawTeam: unknown): DefectAssignedTeam | null {
  const record = asRecord(rawTeam);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id", "teamId"]);

  if (!id) {
    return null;
  }

  return {
    id,
    code: firstString(record, ["code"]),
    name: firstString(record, ["name"]),
  };
}

function formatAssignmentDisplay(
  assignedUser: DefectActor | null,
  assignedTeam: DefectAssignedTeam | null,
) {
  const labels = [
    assignedUser?.name?.trim() || assignedUser?.email?.trim() || null,
    assignedTeam?.name?.trim() || assignedTeam?.code?.trim() || null,
  ].filter((label): label is string => Boolean(label));

  return labels.length > 0 ? labels.join(" / ") : "Unassigned";
}

function normalizeImage(rawImage: unknown, index: number): DefectEvidenceImage | null {
  const record = asRecord(rawImage);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id", "imageId"]) ?? `image-${index}`;

  return {
    id,
    inspectionId: firstString(record, ["inspectionId"]) ?? undefined,
    url: firstString(record, ["url", "uri"]),
    path: firstString(record, ["path", "storageKey"]),
    filename: firstString(record, ["filename", "fileName"]),
    mimeType: firstString(record, ["mimeType", "contentType"]),
    sizeBytes: readNumber(record, "sizeBytes"),
    latitude: readNumber(record, "latitude"),
    longitude: readNumber(record, "longitude"),
    timestamp: firstString(record, ["timestamp"]),
    createdAt: firstString(record, ["createdAt"]) ?? undefined,
  };
}

function normalizeTimelineEntry(
  rawEntry: unknown,
  index: number,
  fallbackDefect: DefectListItem,
): DefectTimelineEntry | null {
  const record = asRecord(rawEntry);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id"]) ?? `timeline-${index}`;
  const createdAt = firstString(record, ["createdAt", "date"]) ?? fallbackDefect.createdAt ?? "";

  if (!createdAt) {
    return null;
  }

  return {
    id,
    type: normalizeTimelineEventType(firstString(record, ["type", "eventType"])),
    fromStatus: normalizeNullableStatus(firstString(record, ["fromStatus"])),
    toStatus: normalizeNullableStatus(firstString(record, ["toStatus", "status"])),
    comment: firstString(record, ["comment", "remark", "message"]),
    createdAt,
    createdBy: normalizeActor(record.createdBy),
  };
}

function normalizeTimeline(record: ApiRecord, fallbackDefect: DefectListItem) {
  const rawTimeline =
    readArray(record, "timeline").length > 0
      ? readArray(record, "timeline")
      : readArray(record, "history");
  const timeline = rawTimeline
    .map((entry, index) => normalizeTimelineEntry(entry, index, fallbackDefect))
    .filter((entry): entry is DefectTimelineEntry => Boolean(entry));

  if (timeline.length > 0) {
    return timeline;
  }

  return [
    {
      id: `${fallbackDefect.id}-created`,
      type: "CREATED" as const,
      fromStatus: null,
      toStatus: fallbackDefect.status,
      comment: fallbackDefect.remark ?? "Defect opened from failed inspection item.",
      createdAt: fallbackDefect.createdAt ?? fallbackDefect.date ?? new Date().toISOString(),
      createdBy: null,
    },
  ];
}

function normalizeDefectDetail(rawDefect: unknown): DefectDetail | null {
  const record = asRecord(rawDefect);
  const baseDefect = normalizeDefect(rawDefect, 0);

  if (!record || !baseDefect) {
    return null;
  }

  const asset = nestedRecord(record, "asset");
  const assetType = nestedRecord(asset, "assetType");
  const substation = nestedRecord(record, "substation") ?? nestedRecord(asset, "substation");
  const inspection = nestedRecord(record, "inspection");
  const siteVisit = nestedRecord(inspection, "siteVisit");
  const siteVisitTeam = nestedRecord(siteVisit, "team");
  const siteVisitSubstation = nestedRecord(siteVisit, "substation");
  const template = nestedRecord(inspection, "template");
  const submittedBy = normalizeActor(record.submittedBy ?? inspection?.createdBy);
  const images = readArray(record, "images")
    .map(normalizeImage)
    .filter((image): image is DefectEvidenceImage => Boolean(image));

  return {
    ...baseDefect,
    checklistItemId: firstString(record, ["checklistItemId"]),
    checklistRemark: firstString(record, ["checklistRemark", "remark"]),
    result: firstString(record, ["result", "inspectionResultValue"]),
    cycleNumber:
      readNumber(record, "cycleNumber") ??
      readNumber(inspection, "cycleNumber") ??
      undefined,
    updatedAt: firstString(record, ["updatedAt"]),
    closedAt: firstString(record, ["closedAt"]),
    asset: asset
      ? {
          id: firstString(asset, ["id"]) ?? baseDefect.assetId ?? "",
          assetCode:
            firstString(asset, ["assetCode", "code"]) ??
            baseDefect.assetCode,
          name: firstString(asset, ["name"]),
          latitude: readNumber(asset, "latitude"),
          longitude: readNumber(asset, "longitude"),
          assetType: assetType
            ? {
                id: firstString(assetType, ["id"]) ?? undefined,
                code: firstString(assetType, ["code"]),
                name: firstString(assetType, ["name"]),
              }
            : null,
          substation: substation
            ? {
                id: firstString(substation, ["id"]) ?? undefined,
                code: firstString(substation, ["code"]),
                name: firstString(substation, ["name"]),
                location: firstString(substation, ["location"]),
              }
            : null,
        }
      : null,
    inspection: inspection
      ? {
          id: firstString(inspection, ["id"]) ?? baseDefect.inspectionId ?? "",
          templateId: firstString(inspection, ["templateId"]) ?? undefined,
          cycleNumber: readNumber(inspection, "cycleNumber") ?? undefined,
          completionStatus: firstString(inspection, ["completionStatus"]) ?? undefined,
          submittedAt: firstString(inspection, ["submittedAt"]),
          createdAt: firstString(inspection, ["createdAt"]),
          updatedAt: firstString(inspection, ["updatedAt"]),
          createdBy: submittedBy,
          template: template
            ? {
                id: firstString(template, ["id"]) ?? undefined,
                name: firstString(template, ["name"]),
                version: readNumber(template, "version"),
              }
            : null,
          siteVisit: siteVisit
            ? {
                id: firstString(siteVisit, ["id"]) ?? undefined,
                status: firstString(siteVisit, ["status"]) ?? undefined,
                startedAt: firstString(siteVisit, ["startedAt"]),
                endedAt: firstString(siteVisit, ["endedAt"]),
                team: siteVisitTeam
                  ? {
                      id: firstString(siteVisitTeam, ["id"]) ?? undefined,
                      code: firstString(siteVisitTeam, ["code"]),
                      name: firstString(siteVisitTeam, ["name"]),
                    }
                  : null,
                substation: siteVisitSubstation
                  ? {
                      id: firstString(siteVisitSubstation, ["id"]) ?? undefined,
                      code: firstString(siteVisitSubstation, ["code"]),
                      name: firstString(siteVisitSubstation, ["name"]),
                      location: firstString(siteVisitSubstation, ["location"]),
                    }
                  : null,
              }
            : null,
        }
      : null,
    submittedBy,
    substation: substation
      ? {
          code: firstString(substation, ["code"]),
          name: firstString(substation, ["name"]),
          location: firstString(substation, ["location"]),
        }
      : null,
    images,
    timeline: normalizeTimeline(record, baseDefect),
  };
}

export async function fetchDefects(token: string): Promise<DefectListItem[]> {
  const payload = await apiRequest<unknown>("/defects", { token });

  return extractDefectArray(payload)
    .map(normalizeDefect)
    .filter((defect): defect is DefectListItem => Boolean(defect));
}

export async function fetchDefectDetail(
  token: string,
  defectId: string,
): Promise<DefectDetail> {
  const payload = await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}`, {
    token,
  });
  const defect = normalizeDefectDetail(payload);

  if (!defect) {
    throw new Error("Unable to read defect detail.");
  }

  return defect;
}

export async function updateDefectStatus(
  token: string,
  defectId: string,
  status: DefectWorkflowStatus,
  actionRemark?: string | null,
): Promise<DefectDetail> {
  const payload = await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/status`, {
    method: "PATCH",
    token,
    body: JSON.stringify({
      status,
      ...(actionRemark !== undefined ? { actionRemark } : {}),
    }),
  });
  const defect = normalizeDefectDetail(payload);

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function updateDefectAssignment(
  token: string,
  defectId: string,
  payload: {
    assignedUserId?: string | null;
    assignedTeamId?: string | null;
  },
): Promise<DefectDetail> {
  const body: {
    assignedUserId?: string | null;
    assignedTeamId?: string | null;
  } = {};

  if ("assignedUserId" in payload) {
    body.assignedUserId = payload.assignedUserId;
  }

  if ("assignedTeamId" in payload) {
    body.assignedTeamId = payload.assignedTeamId;
  }

  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/assignment`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    }),
  );

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function updateDefectDueDate(
  token: string,
  defectId: string,
  dueDate: string | null,
): Promise<DefectDetail> {
  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/due-date`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ dueDate }),
    }),
  );

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function addDefectComment(
  token: string,
  defectId: string,
  comment: string,
): Promise<DefectDetail> {
  const payload = await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/comments`, {
    method: "POST",
    token,
    body: JSON.stringify({ comment }),
  });
  const defect = normalizeDefectDetail(payload);

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}
