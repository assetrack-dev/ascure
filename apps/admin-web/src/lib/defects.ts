import { apiRequest } from "@/lib/api";
import type {
  DefectActor,
  DefectAssignedTeam,
  DefectDetail,
  DefectEvidenceImage,
  DefectLifecycleStatus,
  DefectListItem,
  DefectOperationsBoardAsset,
  DefectOperationsBoardFilters,
  DefectOperationsBoardItem,
  DefectOperationsBoardMainhead,
  DefectOperationsBoardQueue,
  DefectOperationsBoardQueueKey,
  DefectOperationsBoardResponse,
  DefectOperationsBoardSiteVisit,
  DefectResolutionOutcome,
  DefectSeverity,
  DefectSlaState,
  DefectStatus,
  DefectTimelineEntry,
  DefectTimelineEventType,
  DefectWorkflowStatus,
} from "@/types/defects";

type ApiRecord = Record<string, unknown>;

const OPERATIONS_BOARD_QUEUE_KEYS = [
  "awaitingQaQc",
  "maintenanceReady",
  "inMaintenance",
  "awaitingClosureVerification",
  "closedResolved",
  "exceptions",
] as const;

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

function normalizeLifecycleStatus(value: string | null): DefectLifecycleStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "DETECTED" ||
    normalizedValue === "UNDER_REVIEW" ||
    normalizedValue === "VERIFIED" ||
    normalizedValue === "REJECTED" ||
    normalizedValue === "ASSIGNED" ||
    normalizedValue === "IN_PROGRESS" ||
    normalizedValue === "COMPLETED" ||
    normalizedValue === "VERIFICATION_PENDING" ||
    normalizedValue === "CLOSED"
  ) {
    return normalizedValue;
  }

  return "UNKNOWN";
}

function normalizeResolutionOutcome(value: string | null): DefectResolutionOutcome | null {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (!normalizedValue) {
    return null;
  }

  if (
    normalizedValue === "RESOLVED" ||
    normalizedValue === "TEMPORARY_FIX" ||
    normalizedValue === "MONITORING_REQUIRED" ||
    normalizedValue === "DUPLICATE" ||
    normalizedValue === "FALSE_POSITIVE" ||
    normalizedValue === "REPAIRED" ||
    normalizedValue === "EXTERNAL_CONSTRAINT" ||
    normalizedValue === "PARTIAL" ||
    normalizedValue === "DEFERRED" ||
    normalizedValue === "MONITOR_ONLY" ||
    normalizedValue === "ESCALATED"
  ) {
    return normalizedValue;
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
    normalizedValue === "COMMENT" ||
    normalizedValue === "DEFECT_VERIFIED" ||
    normalizedValue === "DEFECT_ASSIGNED" ||
    normalizedValue === "MAINTENANCE_STARTED" ||
    normalizedValue === "MAINTENANCE_COMPLETED" ||
    normalizedValue === "RESOLUTION_OUTCOME_UPDATED" ||
    normalizedValue === "CLOSURE_VERIFIED"
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
  const assignedUser =
    normalizeActor(record.assignedToUser) ?? normalizeActor(record.assignedUser);
  const assignedTeam =
    normalizeTeam(record.assignedToTeam) ?? normalizeTeam(record.assignedTeam);
  const verifiedByUser = normalizeActor(record.verifiedByUser);
  const maintainedByUser = normalizeActor(record.maintainedByUser);
  const closureVerifiedByUser = normalizeActor(record.closureVerifiedByUser);
  const assignedUserId = firstString(record, [
    "assignedToUserId",
    "assignedUserId",
    "assigneeUserId",
  ]);
  const assignedTeamId = firstString(record, [
    "assignedToTeamId",
    "assignedTeamId",
    "assigneeTeamId",
  ]);
  const verificationNotes = firstString(record, [
    "verificationNotes",
    "verificationRemarks",
  ]);
  const closureVerificationNotes = firstString(record, [
    "closureVerificationNotes",
    "closureRemarks",
  ]);
  const dueDate = firstString(record, ["dueDate"]);
  const status = normalizeStatus(firstString(record, ["status"]));
  const lifecycleStatus = normalizeLifecycleStatus(firstString(record, ["lifecycleStatus"]));
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
    assignedUserId,
    assignedTeamId,
    assignedToUserId: assignedUserId,
    assignedToTeamId: assignedTeamId,
    assignedUser,
    assignedTeam,
    assignedToUser: assignedUser,
    assignedToTeam: assignedTeam,
    verifiedByUserId: firstString(record, ["verifiedByUserId"]),
    maintainedByUserId: firstString(record, ["maintainedByUserId"]),
    closureVerifiedByUserId: firstString(record, ["closureVerifiedByUserId"]),
    verifiedByUser,
    maintainedByUser,
    closureVerifiedByUser,
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
    lifecycleStatus: lifecycleStatus === "UNKNOWN" ? "DETECTED" : lifecycleStatus,
    resolutionOutcome: normalizeResolutionOutcome(firstString(record, ["resolutionOutcome"])),
    date,
    location: readLocation(record),
    remark: firstString(record, ["remark", "checklistRemark", "description"]),
    actionRemark: firstString(record, ["actionRemark"]),
    dueDate,
    resolvedAt: firstString(record, ["resolvedAt"]),
    closedAt: firstString(record, ["closedAt"]),
    assignedAt: firstString(record, ["assignedAt"]),
    verifiedAt: firstString(record, ["verifiedAt"]),
    maintainedAt: firstString(record, ["maintainedAt"]),
    verificationNotes,
    verificationRemarks: verificationNotes,
    maintenanceNotes: firstString(record, ["maintenanceNotes"]),
    closureVerifiedAt: firstString(record, ["closureVerifiedAt"]),
    closureVerificationNotes,
    closureRemarks: closureVerificationNotes,
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
    defectId: firstString(record, ["defectId"]) ?? undefined,
    uploadedByUserId: firstString(record, ["uploadedByUserId", "createdByUserId"]),
    inspectionId: firstString(record, ["inspectionId"]) ?? undefined,
    evidenceType: firstString(record, ["evidenceType"]),
    url: firstString(record, ["url", "uri"]),
    path: firstString(record, ["path", "storageKey"]),
    storageKey: firstString(record, ["storageKey", "path"]),
    filename: firstString(record, ["filename", "fileName"]),
    fileName: firstString(record, ["fileName", "filename"]),
    mimeType: firstString(record, ["mimeType", "contentType"]),
    contentType: firstString(record, ["contentType", "mimeType"]),
    sizeBytes: readNumber(record, "sizeBytes"),
    note: firstString(record, ["note"]),
    latitude: readNumber(record, "latitude"),
    longitude: readNumber(record, "longitude"),
    timestamp: firstString(record, ["timestamp"]),
    uploadedAt: firstString(record, ["uploadedAt", "createdAt"]) ?? undefined,
    createdAt: firstString(record, ["createdAt"]) ?? undefined,
    updatedAt: firstString(record, ["updatedAt"]) ?? undefined,
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
    fromLifecycleStatus: normalizeLifecycleStatus(
      firstString(record, ["fromLifecycleStatus"]),
    ),
    toLifecycleStatus: normalizeLifecycleStatus(
      firstString(record, ["toLifecycleStatus", "lifecycleStatus"]),
    ),
    fromResolutionOutcome: normalizeResolutionOutcome(
      firstString(record, ["fromResolutionOutcome"]),
    ),
    toResolutionOutcome: normalizeResolutionOutcome(
      firstString(record, ["toResolutionOutcome", "resolutionOutcome"]),
    ),
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
      fromLifecycleStatus: null,
      toLifecycleStatus: fallbackDefect.lifecycleStatus ?? "DETECTED",
      fromResolutionOutcome: null,
      toResolutionOutcome: fallbackDefect.resolutionOutcome ?? null,
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
  const evidenceImages = readArray(record, "evidenceImages")
    .map(normalizeImage)
    .filter((image): image is DefectEvidenceImage => Boolean(image));
  const maintenanceProofImages = readArray(record, "maintenanceProofImages")
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
    evidenceImages,
    maintenanceProofImages,
    timeline: normalizeTimeline(record, baseDefect),
  };
}

function normalizeBoardQueueKey(value: string | null): DefectOperationsBoardQueueKey {
  if (OPERATIONS_BOARD_QUEUE_KEYS.includes(value as DefectOperationsBoardQueueKey)) {
    return value as DefectOperationsBoardQueueKey;
  }

  return "awaitingQaQc";
}

function normalizeBoardMainhead(rawMainhead: unknown): DefectOperationsBoardMainhead {
  const record = asRecord(rawMainhead);
  const code = firstString(record, ["code"]);
  const name = firstString(record, ["name"]);
  const label = firstString(record, ["label"]) ?? name ?? code ?? "Unassigned MAINHEAD";

  return {
    id: firstString(record, ["id"]),
    code,
    name,
    label,
  };
}

function normalizeBoardContextRef(rawContext: unknown) {
  const record = asRecord(rawContext);
  const id = firstString(record, ["id"]);

  if (!record || !id) {
    return null;
  }

  return {
    id,
    code: firstString(record, ["code"]),
    name: firstString(record, ["name"]),
  };
}

function normalizeBoardSiteVisit(rawSiteVisit: unknown): DefectOperationsBoardSiteVisit | null {
  const record = asRecord(rawSiteVisit);
  const id = firstString(record, ["id"]);

  if (!record || !id) {
    return null;
  }

  const team = normalizeTeam(record.team);
  const substation = nestedRecord(record, "substation");

  return {
    id,
    status: firstString(record, ["status"]),
    startedAt: firstString(record, ["startedAt"]),
    endedAt: firstString(record, ["endedAt"]),
    team,
    substation: substation
      ? {
          id: firstString(substation, ["id"]),
          code: firstString(substation, ["code"]),
          name: firstString(substation, ["name"]),
          location: firstString(substation, ["location"]),
        }
      : null,
  };
}

function normalizeBoardAsset(rawAsset: unknown): DefectOperationsBoardAsset | null {
  const record = asRecord(rawAsset);
  const id = firstString(record, ["id"]);
  const code = firstString(record, ["code", "assetCode"]);

  if (!record || !id || !code) {
    return null;
  }

  const assetType = nestedRecord(record, "assetType");

  return {
    id,
    code,
    name: firstString(record, ["name"]),
    assetType: assetType
      ? {
          id: firstString(assetType, ["id"]),
          code: firstString(assetType, ["code"]),
          name: firstString(assetType, ["name"]),
        }
      : null,
  };
}

function normalizeBoardLatestTimelineEvent(rawEntry: unknown): DefectTimelineEntry | null {
  const record = asRecord(rawEntry);
  const createdAt = firstString(record, ["createdAt", "date"]);

  if (!record || !createdAt) {
    return null;
  }

  const fromLifecycleStatus = firstString(record, ["fromLifecycleStatus"]);
  const toLifecycleStatus = firstString(record, ["toLifecycleStatus", "lifecycleStatus"]);

  return {
    id: firstString(record, ["id"]) ?? `timeline-${createdAt}`,
    type: normalizeTimelineEventType(firstString(record, ["type", "eventType"])),
    fromStatus: normalizeNullableStatus(firstString(record, ["fromStatus"])),
    toStatus: normalizeNullableStatus(firstString(record, ["toStatus", "status"])),
    fromLifecycleStatus: fromLifecycleStatus
      ? normalizeLifecycleStatus(fromLifecycleStatus)
      : null,
    toLifecycleStatus: toLifecycleStatus ? normalizeLifecycleStatus(toLifecycleStatus) : null,
    fromResolutionOutcome: normalizeResolutionOutcome(
      firstString(record, ["fromResolutionOutcome"]),
    ),
    toResolutionOutcome: normalizeResolutionOutcome(
      firstString(record, ["toResolutionOutcome", "resolutionOutcome"]),
    ),
    comment: firstString(record, ["comment", "remark", "message"]),
    createdAt,
    createdBy: normalizeActor(record.createdBy),
  };
}

function normalizeBoardItem(rawItem: unknown, index: number): DefectOperationsBoardItem | null {
  const record = asRecord(rawItem);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id", "defectId"]) ?? `operation-defect-${index}`;
  const title =
    firstString(record, ["title", "summary", "defectType", "label"]) ?? "Unspecified defect";
  const status = normalizeLifecycleStatus(firstString(record, ["status", "lifecycleStatus"]));
  const lifecycleStatus = status === "UNKNOWN" ? "DETECTED" : status;
  const mainhead = normalizeBoardMainhead(record.mainhead);
  const asset = normalizeBoardAsset(record.asset);
  const dueDate = firstString(record, ["dueDate"]);
  const workflowStatus = normalizeStatus(firstString(record, ["workflowStatus"]));
  const normalizedSlaState = normalizeSlaState(firstString(record, ["slaState"]));
  const slaState =
    normalizedSlaState === "UNKNOWN"
      ? computeSlaState(workflowStatus, dueDate)
      : normalizedSlaState;

  return {
    id,
    inspectionItemResultId: firstString(record, ["inspectionItemResultId"]) ?? undefined,
    title,
    summary: firstString(record, ["summary", "remark"]),
    status: lifecycleStatus,
    lifecycleStatus,
    workflowStatus,
    severity: normalizeSeverity(firstString(record, ["severity"])),
    resolutionOutcome: normalizeResolutionOutcome(firstString(record, ["resolutionOutcome"])),
    mainhead,
    mainheadLabel: firstString(record, ["mainheadLabel"]) ?? mainhead.label,
    project: normalizeBoardContextRef(record.project),
    workPackage: normalizeBoardContextRef(record.workPackage),
    siteVisit: normalizeBoardSiteVisit(record.siteVisit),
    asset,
    assetCode: firstString(record, ["assetCode"]) ?? asset?.code ?? "Unassigned",
    assetName: firstString(record, ["assetName"]) ?? asset?.name ?? null,
    assignedToUserId: firstString(record, ["assignedToUserId", "assignedUserId"]),
    assignedToTeamId: firstString(record, ["assignedToTeamId", "assignedTeamId"]),
    assignedToUser: normalizeActor(record.assignedToUser),
    assignedToTeam: normalizeTeam(record.assignedToTeam),
    assignedTo: firstString(record, ["assignedTo"]),
    verifiedByUser: normalizeActor(record.verifiedByUser),
    maintainedByUser: normalizeActor(record.maintainedByUser),
    closureVerifiedByUser: normalizeActor(record.closureVerifiedByUser),
    detectedAt: firstString(record, ["detectedAt"]),
    createdAt: firstString(record, ["createdAt"]),
    verifiedAt: firstString(record, ["verifiedAt"]),
    assignedAt: firstString(record, ["assignedAt"]),
    maintainedAt: firstString(record, ["maintainedAt"]),
    closureVerifiedAt: firstString(record, ["closureVerifiedAt"]),
    dueDate,
    slaState,
    isOverdue: readBoolean(record, "isOverdue") ?? slaState === "OVERDUE",
    latestTimelineEvent: normalizeBoardLatestTimelineEvent(record.latestTimelineEvent),
  };
}

function normalizeBoardQueue(rawQueue: unknown): DefectOperationsBoardQueue | null {
  const record = asRecord(rawQueue);

  if (!record) {
    return null;
  }

  const key = normalizeBoardQueueKey(firstString(record, ["key"]));
  const items = readArray(record, "items")
    .map(normalizeBoardItem)
    .filter((item): item is DefectOperationsBoardItem => Boolean(item));
  const statuses = readArray(record, "statuses")
    .map((status) => normalizeLifecycleStatus(typeof status === "string" ? status : null))
    .filter((status): status is Exclude<DefectLifecycleStatus, "UNKNOWN"> => status !== "UNKNOWN");

  return {
    key,
    title: firstString(record, ["title"]) ?? key,
    description: firstString(record, ["description"]) ?? undefined,
    statuses,
    count: readNumber(record, "count") ?? items.length,
    items,
  };
}

function normalizeBoardFilters(rawFilters: unknown): DefectOperationsBoardFilters {
  const record = asRecord(rawFilters);
  const severity = normalizeSeverity(firstString(record, ["severity"]));
  const status = normalizeLifecycleStatus(firstString(record, ["status"]));
  const resolutionOutcome = normalizeResolutionOutcome(firstString(record, ["resolutionOutcome"]));

  return {
    mainhead: firstString(record, ["mainhead"]) ?? undefined,
    projectId: firstString(record, ["projectId"]) ?? undefined,
    workPackageId: firstString(record, ["workPackageId"]) ?? undefined,
    siteVisitId: firstString(record, ["siteVisitId"]) ?? undefined,
    severity: severity ?? undefined,
    status: status === "UNKNOWN" ? undefined : status,
    resolutionOutcome:
      !resolutionOutcome || resolutionOutcome === "UNKNOWN" ? undefined : resolutionOutcome,
    assignedToUserId: firstString(record, ["assignedToUserId"]) ?? undefined,
    overdueOnly: readBoolean(record, "overdueOnly") ?? undefined,
    q: firstString(record, ["q"]) ?? undefined,
  };
}

function normalizeOperationsBoard(payload: unknown): DefectOperationsBoardResponse {
  const record = asRecord(payload);
  const queues = readArray(record, "queues")
    .map(normalizeBoardQueue)
    .filter((queue): queue is DefectOperationsBoardQueue => Boolean(queue));
  const mainheads = readArray(record, "mainheads")
    .map((rawGroup) => {
      const group = asRecord(rawGroup);
      const groupQueues = readArray(group, "queues")
        .map(normalizeBoardQueue)
        .filter((queue): queue is DefectOperationsBoardQueue => Boolean(queue));

      if (!group) {
        return null;
      }

      return {
        mainhead: normalizeBoardMainhead(group.mainhead),
        count:
          readNumber(group, "count") ??
          groupQueues.reduce((total, queue) => total + queue.count, 0),
        queues: groupQueues,
      };
    })
    .filter((group): group is DefectOperationsBoardResponse["mainheads"][number] =>
      Boolean(group),
    );

  return {
    generatedAt: firstString(record, ["generatedAt"]),
    inspectorOwns: record?.inspectorOwns === true,
    governanceMode:
      record?.governanceMode === "QA_GATED" ||
      record?.governanceMode === "RELEASE_ON_REPORT"
        ? record.governanceMode
        : "INSPECTOR_OWNS",
    filters: normalizeBoardFilters(record?.filters),
    totalCount:
      readNumber(record, "totalCount") ??
      queues.reduce((total, queue) => total + queue.items.length, 0),
    queues,
    mainheads,
  };
}

function appendBoardFilter(params: URLSearchParams, key: string, value: unknown) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (typeof value === "boolean") {
    if (value) {
      params.set(key, "true");
    }

    return;
  }

  params.set(key, String(value));
}

export async function fetchDefects(token: string): Promise<DefectListItem[]> {
  const payload = await apiRequest<unknown>("/defects", { token });

  return extractDefectArray(payload)
    .map(normalizeDefect)
    .filter((defect): defect is DefectListItem => Boolean(defect));
}

export async function fetchDefectOperationsBoard(
  token: string,
  filters: DefectOperationsBoardFilters = {},
): Promise<DefectOperationsBoardResponse> {
  const params = new URLSearchParams();

  appendBoardFilter(params, "mainhead", filters.mainhead);
  appendBoardFilter(params, "projectId", filters.projectId);
  appendBoardFilter(params, "workPackageId", filters.workPackageId);
  appendBoardFilter(params, "siteVisitId", filters.siteVisitId);
  appendBoardFilter(params, "severity", filters.severity);
  appendBoardFilter(params, "status", filters.status);
  appendBoardFilter(params, "resolutionOutcome", filters.resolutionOutcome);
  appendBoardFilter(params, "assignedToUserId", filters.assignedToUserId);
  appendBoardFilter(params, "overdueOnly", filters.overdueOnly);
  appendBoardFilter(params, "q", filters.q);

  const queryString = params.toString();
  const payload = await apiRequest<unknown>(
    `/defects/operations-board${queryString ? `?${queryString}` : ""}`,
    { token },
  );

  return normalizeOperationsBoard(payload);
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
    assignedToUserId?: string | null;
    assignedToTeamId?: string | null;
  },
): Promise<DefectDetail> {
  const body: {
    assignedUserId?: string | null;
    assignedTeamId?: string | null;
    assignedToUserId?: string | null;
    assignedToTeamId?: string | null;
  } = {};

  if ("assignedUserId" in payload) {
    body.assignedUserId = payload.assignedUserId;
    body.assignedToUserId = payload.assignedUserId;
  }

  if ("assignedToUserId" in payload) {
    body.assignedToUserId = payload.assignedToUserId;
    body.assignedUserId = payload.assignedToUserId;
  }

  if ("assignedTeamId" in payload) {
    body.assignedTeamId = payload.assignedTeamId;
    body.assignedToTeamId = payload.assignedTeamId;
  }

  if ("assignedToTeamId" in payload) {
    body.assignedToTeamId = payload.assignedToTeamId;
    body.assignedTeamId = payload.assignedToTeamId;
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

export async function verifyDefect(
  token: string,
  defectId: string,
  verificationNotes?: string | null,
): Promise<DefectDetail> {
  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/verify`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        verificationNotes,
        verificationRemarks: verificationNotes,
      }),
    }),
  );

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function rejectDefect(
  token: string,
  defectId: string,
  verificationNotes?: string | null,
): Promise<DefectDetail> {
  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(`/defects/${encodeURIComponent(defectId)}/reject`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        verificationNotes,
        verificationRemarks: verificationNotes,
      }),
    }),
  );

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function completeDefectMaintenance(
  token: string,
  defectId: string,
  payload: {
    resolutionOutcome?: Exclude<DefectResolutionOutcome, "UNKNOWN">;
    completionRemarks?: string | null;
    maintenanceNotes?: string | null;
  },
): Promise<DefectDetail> {
  const maintenanceNotes = payload.maintenanceNotes ?? payload.completionRemarks;
  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(
      `/defects/${encodeURIComponent(defectId)}/maintenance-completion`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          ...payload,
          maintenanceNotes,
          completionRemarks: maintenanceNotes,
        }),
      },
    ),
  );

  if (!defect) {
    throw new Error("Unable to read updated defect detail.");
  }

  return defect;
}

export async function verifyDefectClosure(
  token: string,
  defectId: string,
  closureVerificationNotes?: string | null,
): Promise<DefectDetail> {
  const defect = normalizeDefectDetail(
    await apiRequest<unknown>(
      `/defects/${encodeURIComponent(defectId)}/closure-verification`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          closureVerificationNotes,
          closureRemarks: closureVerificationNotes,
        }),
      },
    ),
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
