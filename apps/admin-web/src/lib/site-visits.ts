import { apiRequest } from "@/lib/api";
import type {
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitDetail,
  SiteVisitImage,
  SiteVisitInspection,
  SiteVisitListItem,
  SiteVisitMainhead,
  SiteVisitStatus,
  SiteVisitTeam,
  SiteVisitType,
  SiteVisitUser,
  SiteVisitValidationStatus,
} from "@/types/site-visits";

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

function readArray(record: ApiRecord | null, keys: string[]) {
  if (!record) {
    return [];
  }

  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function extractSiteVisitArray(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["data", "items", "siteVisits", "visits", "results"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function numberOrZero(value: unknown) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeStatus(value: string | null): SiteVisitStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "ACTIVE" ||
    normalizedValue === "OPEN" ||
    normalizedValue === "IN_PROGRESS" ||
    normalizedValue === "COMPLETED" ||
    normalizedValue === "CANCELLED"
  ) {
    return normalizedValue;
  }

  return "UNKNOWN";
}

function normalizeValidationStatus(value: string | null): SiteVisitValidationStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "PENDING" ||
    normalizedValue === "VALIDATED" ||
    normalizedValue === "WARNING" ||
    normalizedValue === "FAILED"
  ) {
    return normalizedValue;
  }

  return "UNKNOWN";
}

function normalizeHealthStatus(value: string | null): OperationalHealthStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "HEALTHY" ||
    normalizedValue === "WARNING" ||
    normalizedValue === "CRITICAL"
  ) {
    return normalizedValue;
  }

  return "HEALTHY";
}

function normalizeVisitType(value: string | null): SiteVisitType {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "DISCOVERY" ||
    normalizedValue === "REINSPECTION" ||
    normalizedValue === "SPECIAL" ||
    normalizedValue === "AUDIT"
  ) {
    return normalizedValue;
  }

  return "UNSPECIFIED";
}

function normalizeUser(rawUser: unknown): SiteVisitUser | null {
  const record = asRecord(rawUser);

  if (!record) {
    return null;
  }

  const nestedUser = nestedRecord(record, "user");
  const source = nestedUser ?? record;
  const id = firstString(source, ["id", "userId"]) ?? firstString(record, ["userId"]);

  if (!id) {
    return null;
  }

  return {
    id,
    email: firstString(source, ["email"]),
    name: firstString(source, ["name"]),
    role: firstString(source, ["role"]),
    siteVisitUserId: firstString(record, ["siteVisitUserId", "id"]) ?? undefined,
    joinedAt: firstString(record, ["joinedAt"]),
  };
}

function normalizeTeam(rawTeam: unknown): SiteVisitTeam | null {
  const record = asRecord(rawTeam);

  if (!record) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? undefined,
    code: firstString(record, ["code"]),
    name: firstString(record, ["name"]),
  };
}

function normalizeSubstation(rawSubstation: unknown) {
  const record = asRecord(rawSubstation);

  if (!record) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? undefined,
    code: firstString(record, ["code"]),
    name: firstString(record, ["name"]),
    location: firstString(record, ["location"]),
  };
}

function normalizeMainheadReference(rawMainhead: unknown): SiteVisitMainhead | null {
  const record = asRecord(rawMainhead);

  if (!record) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? undefined,
    branchId: firstString(record, ["branchId"]),
    code: firstString(record, ["code"]),
    name: firstString(record, ["name"]),
    isActive: readBoolean(record, "isActive"),
  };
}

function displayMainheadReference(mainhead: SiteVisitMainhead | null) {
  return mainhead?.name?.trim() || mainhead?.code?.trim() || null;
}

function normalizeTeamMembers(record: ApiRecord | null) {
  return readArray(record, ["teamMembers", "users"])
    .map(normalizeUser)
    .filter((user): user is SiteVisitUser => Boolean(user));
}

function normalizeSiteVisit(rawVisit: unknown, index: number): SiteVisitListItem | null {
  const record = asRecord(rawVisit);

  if (!record) {
    return null;
  }

  const id = firstString(record, ["id", "siteVisitId"]) ?? `site-visit-${index}`;
  const summary = asRecord(record.summary);
  const substation = normalizeSubstation(record.substation);
  const status = normalizeStatus(firstString(record, ["status"]));
  const startedAt = firstString(record, ["startedAt", "createdAt"]);
  const mainheadRecord =
    normalizeMainheadReference(record.mainheadRecord) ??
    normalizeMainheadReference(nestedRecord(record, "workPackage")?.mainheadRecord) ??
    normalizeMainheadReference(nestedRecord(record, "project")?.mainhead);
  const mainhead =
    firstString(record, ["mainhead", "mainHead"]) ??
    displayMainheadReference(mainheadRecord);

  return {
    id,
    status,
    validationStatus: normalizeValidationStatus(firstString(record, ["validationStatus"])),
    operationalHealthStatus: normalizeHealthStatus(
      firstString(record, ["operationalHealthStatus", "healthStatus"]),
    ),
    isOverdue: readBoolean(record, "isOverdue") ?? false,
    overdueThresholdHours: numberOrZero(readNumber(record, "overdueThresholdHours") ?? 24),
    visitType: normalizeVisitType(firstString(record, ["visitType"])),
    cycleNumber: readNumber(record, "cycleNumber"),
    mainhead,
    mainheadRecord,
    pencawangCode:
      firstString(record, ["pencawangCode"]) ?? substation?.code ?? null,
    pencawangName:
      firstString(record, ["pencawangName"]) ?? substation?.name ?? null,
    functionalLocation:
      firstString(record, ["functionalLocation"]) ?? substation?.location ?? null,
    team: normalizeTeam(record.team),
    substation,
    createdBy: normalizeUser(record.createdBy),
    teamMembers: normalizeTeamMembers(record),
    startedAt,
    completedAt: firstString(record, ["completedAt"]),
    endedAt: firstString(record, ["endedAt"]),
    lastActivityAt: firstString(record, ["lastActivityAt", "updatedAt"]) ?? startedAt,
    updatedAt: firstString(record, ["updatedAt"]),
    notes: firstString(record, ["notes"]),
    completionNotes: firstString(record, ["completionNotes"]),
    totalAssets: numberOrZero(record.totalAssets ?? summary?.totalAssets),
    inspectedAssets: numberOrZero(record.inspectedAssets ?? summary?.inspectedAssets),
    pendingAssets: numberOrZero(record.pendingAssets ?? summary?.pendingAssets),
    defectsFound: numberOrZero(record.defectsFound ?? summary?.defectsFound),
    completionPercentage: numberOrZero(
      record.completionPercentage ?? summary?.completionPercentage,
    ),
  };
}

function normalizeAssetLink(rawLink: unknown, index: number): SiteVisitAssetLink | null {
  const record = asRecord(rawLink);
  const asset = nestedRecord(record, "asset") ?? record;

  if (!record || !asset) {
    return null;
  }

  const assetId = firstString(record, ["assetId"]) ?? firstString(asset, ["id"]);

  if (!assetId) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? `visit-asset-${index}`,
    siteVisitId: firstString(record, ["siteVisitId"]) ?? undefined,
    assetId,
    addedAt: firstString(record, ["addedAt", "createdAt"]),
    source: firstString(record, ["source"]),
    notes: firstString(record, ["notes"]),
    addedBy: normalizeUser(record.addedBy),
    asset: {
      id: assetId,
      assetCode:
        firstString(asset, ["assetCode", "code", "noTiangRondaan"]) ?? "Unassigned",
      name: firstString(asset, ["name", "assetName"]),
      status: firstString(asset, ["status"]),
      latitude: readNumber(asset, "latitude"),
      longitude: readNumber(asset, "longitude"),
      assetType: normalizeTeam(asset.assetType),
      substation: normalizeSubstation(asset.substation),
    },
  };
}

function normalizeInspection(rawInspection: unknown, index: number): SiteVisitInspection | null {
  const record = asRecord(rawInspection);

  if (!record) {
    return null;
  }

  const asset = nestedRecord(record, "asset");
  const template = nestedRecord(record, "template");
  const itemResults = readArray(record, ["itemResults", "results"]);
  const images = readArray(record, ["inspectionImages", "images"]);
  const id = firstString(record, ["id", "inspectionId"]) ?? `inspection-${index}`;

  return {
    id,
    assetId: firstString(record, ["assetId"]) ?? firstString(asset, ["id"]) ?? "",
    assetCode:
      firstString(asset, ["assetCode", "code"]) ??
      firstString(record, ["assetCode"]) ??
      "Unassigned",
    assetName: firstString(asset, ["name"]),
    templateName: firstString(template, ["name"]),
    templateVersion: readNumber(template, "version"),
    completionStatus:
      firstString(record, ["completionStatus", "status"]) ?? "UNKNOWN",
    cycleNumber:
      readNumber(record, "inspectionCycle") ?? readNumber(record, "cycleNumber"),
    submittedAt: firstString(record, ["submittedAt"]),
    createdAt: firstString(record, ["createdAt"]),
    updatedAt: firstString(record, ["updatedAt"]),
    imageCount: images.length,
    defectCount: itemResults.filter((item) => readBoolean(asRecord(item), "isDefect")).length,
    createdBy: normalizeUser(record.createdBy),
  };
}

function normalizeImage(rawImage: unknown, index: number): SiteVisitImage | null {
  const record = asRecord(rawImage);

  if (!record) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? `site-visit-image-${index}`,
    fileName: firstString(record, ["fileName", "filename"]),
    storageKey: firstString(record, ["storageKey", "path"]),
    contentType: firstString(record, ["contentType", "mimeType"]),
    url: firstString(record, ["url"]),
    createdAt: firstString(record, ["createdAt"]),
  };
}

function normalizeSiteVisitDetail(rawVisit: unknown): SiteVisitDetail | null {
  const record = asRecord(rawVisit);
  const baseVisit = normalizeSiteVisit(rawVisit, 0);

  if (!record || !baseVisit) {
    return null;
  }

  return {
    ...baseVisit,
    validatedAt: firstString(record, ["validatedAt"]),
    validationSummary: firstString(record, ["validationSummary"]),
    validatedBy: normalizeUser(record.validatedBy),
    checkInLatitude: readNumber(record, "checkInLatitude"),
    checkInLongitude: readNumber(record, "checkInLongitude"),
    checkInAccuracyMeters: readNumber(record, "checkInAccuracyMeters"),
    checkInCapturedAt: firstString(record, ["checkInCapturedAt"]),
    feederId: firstString(record, ["feederId"]),
    feederRouteId: firstString(record, ["feederRouteId"]),
    gisGeometryVersion: firstString(record, ["gisGeometryVersion"]),
    cancelReason: firstString(record, ["cancelReason"]),
    linkedAssets: readArray(record, ["linkedAssets", "visitAssets"])
      .map(normalizeAssetLink)
      .filter((link): link is SiteVisitAssetLink => Boolean(link)),
    inspections: readArray(record, ["inspections"])
      .map(normalizeInspection)
      .filter((inspection): inspection is SiteVisitInspection => Boolean(inspection)),
    images: readArray(record, ["images"])
      .map(normalizeImage)
      .filter((image): image is SiteVisitImage => Boolean(image)),
  };
}

export async function fetchSiteVisits(token: string): Promise<SiteVisitListItem[]> {
  const payload = await apiRequest<unknown>("/site-visits", { token });

  return extractSiteVisitArray(payload)
    .map(normalizeSiteVisit)
    .filter((visit): visit is SiteVisitListItem => Boolean(visit));
}

export async function fetchSiteVisitDetail(
  token: string,
  siteVisitId: string,
): Promise<SiteVisitDetail> {
  const payload = await apiRequest<unknown>(`/site-visits/${encodeURIComponent(siteVisitId)}`, {
    token,
  });
  const visit = normalizeSiteVisitDetail(payload);

  if (!visit) {
    throw new Error("Unable to read site visit detail.");
  }

  return visit;
}
