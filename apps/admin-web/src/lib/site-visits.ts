import { apiRequest } from "@/lib/api";
import { DISPLAY_STATUS_LABELS } from "@/types/site-visits";
import type {
  ChecklistColumn,
  DisplayStatus,
  OperationalDomain,
  OperationalHealthStatus,
  SiteVisitAssetLink,
  SiteVisitDetail,
  SiteVisitImage,
  SiteVisitInspection,
  SiteVisitListItem,
  SiteVisitMainhead,
  SiteVisitSensorPhoto,
  SiteVisitStatus,
  SiteVisitSubstation,
  SiteVisitTeam,
  SiteVisitType,
  SiteVisitUser,
  SurveyScope,
  SiteVisitValidationStatus,
  SurveyLifecycleEvent,
  SurveyLifecycleState,
  SurveyLifecycleStatus,
  CycleDelta,
  CycleDeltaPole,
  SurveyDueStatus,
  SiteVisitContributions,
  TeamContributionShare,
  TeamContributionSnapshot,
  ReassignmentRecord,
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

function normalizeOperationalDomain(value: string | null): OperationalDomain {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "SURVEY" ||
    normalizedValue === "INSPECTION" ||
    normalizedValue === "MAINTENANCE" ||
    normalizedValue === "REPAIR" ||
    normalizedValue === "AUDIT" ||
    normalizedValue === "CIVIL" ||
    normalizedValue === "DISTRIBUTION" ||
    normalizedValue === "THIRTY_THREE_KV" ||
    normalizedValue === "EMERGENCY" ||
    normalizedValue === "OTHER"
  ) {
    return normalizedValue;
  }

  return "UNSPECIFIED";
}

/** Derive SAVR vs SAVT for a visit. A visit is SAVT when its operational scope is
 *  SAVT, its session is a ROUTE, or it carries a route code — any one of these is
 *  a reliable route-survey signal. Everything else is treated as SAVR (the system
 *  default scope), which also keeps visits created before `operationalScope` was
 *  populated in the SAVR bucket. Mirrors the Reports page's two-way SAVR/SAVT split. */
function normalizeSurveyScope(record: ApiRecord | null): SurveyScope {
  const scope = firstString(record, ["operationalScope"])?.toUpperCase();
  const sessionKind = firstString(record, ["sessionKind"])?.toUpperCase();
  const routeCode = firstString(record, ["routeCode"]);

  if (scope === "SAVT" || sessionKind === "ROUTE" || Boolean(routeCode)) {
    return "SAVT";
  }

  return "SAVR";
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

function normalizeDisplayStatus(
  value: string | null,
  operationalStatus: SiteVisitStatus,
): DisplayStatus {
  const v = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (
    v === "NOT_STARTED" ||
    v === "IN_PROGRESS" ||
    v === "NEEDS_AMENDMENT" ||
    v === "IN_REVIEW" ||
    v === "COMPLETED" ||
    v === "ARCHIVED" ||
    v === "CANCELLED"
  ) {
    return v;
  }
  // Fallback for an API that predates displayStatus: coarse map from operational status.
  if (operationalStatus === "CANCELLED") return "CANCELLED";
  if (operationalStatus === "COMPLETED") return "COMPLETED";
  if (operationalStatus === "OPEN") return "NOT_STARTED";
  return "IN_PROGRESS";
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
  const displayStatus = normalizeDisplayStatus(
    firstString(record, ["displayStatus"]),
    status,
  );
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
    displayStatus,
    displayStatusLabel:
      firstString(record, ["displayStatusLabel"]) ?? DISPLAY_STATUS_LABELS[displayStatus],
    validationStatus: normalizeValidationStatus(firstString(record, ["validationStatus"])),
    operationalHealthStatus: normalizeHealthStatus(
      firstString(record, ["operationalHealthStatus", "healthStatus"]),
    ),
    isOverdue: readBoolean(record, "isOverdue") ?? false,
    overdueThresholdHours: numberOrZero(readNumber(record, "overdueThresholdHours") ?? 24),
    visitType: normalizeVisitType(firstString(record, ["visitType"])),
    operationalDomain: normalizeOperationalDomain(
      firstString(record, ["operationalDomain"]),
    ),
    surveyScope: normalizeSurveyScope(record),
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

function normalizeSensorPhoto(raw: unknown): SiteVisitSensorPhoto | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  const url = firstString(record, ["url", "path"]);

  if (!url) {
    return null;
  }

  return {
    url,
    filename: firstString(record, ["filename"]),
    timestamp: firstString(record, ["timestamp", "createdAt"]),
    latitude: readNumber(record, "latitude"),
    longitude: readNumber(record, "longitude"),
  };
}

/** Coerce the API's per-pole checklist value map (label → value) into a plain
 *  string|null record. Non-string values (numbers/booleans already stringified
 *  server-side) are defensively coerced; undefined when the field is absent. */
function normalizeChecklistValues(
  raw: unknown,
): Record<string, string | null> | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = value == null ? null : typeof value === "string" ? value : String(value);
  }
  return out;
}

/** Parse a checklist column's dropdown options (SELECT/BOOLEAN), dropping any
 *  entry missing a label/value. */
function normalizeChecklistOptions(
  raw: unknown,
): { label: string; value: string }[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const options: { label: string; value: string }[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const label = firstString(record, ["label"]);
    const value = firstString(record, ["value"]);
    if (!label || !value) {
      continue;
    }
    options.push({ label, value });
  }
  return options.length > 0 ? options : undefined;
}

/** The visit's toggleable checklist columns (template order), dropping any entry
 *  missing a key/label. */
function normalizeChecklistColumns(raw: unknown): ChecklistColumn[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const columns: ChecklistColumn[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const key = firstString(record, ["key"]);
    const label = firstString(record, ["label"]);
    if (!key || !label) {
      continue;
    }
    columns.push({
      key,
      label,
      section: firstString(record, ["section"]) ?? null,
      inputType: firstString(record, ["inputType"]) ?? undefined,
      options: normalizeChecklistOptions(record?.options),
    });
  }
  return columns;
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
      noTiangLama: firstString(asset, ["noTiangLama"]),
      status: firstString(asset, ["status"]),
      latitude: readNumber(asset, "latitude"),
      longitude: readNumber(asset, "longitude"),
      assetType: normalizeTeam(asset.assetType),
      substation: normalizeSubstation(asset.substation),
      latestInspectionId: firstString(nestedRecord(asset, "latestInspection"), ["id"]),
    },
    checklist: {
      bacaanKelegaan1: firstString(nestedRecord(record, "checklist"), [
        "bacaanKelegaan1",
      ]),
      bacaanKelegaan1Image: normalizeSensorPhoto(
        nestedRecord(nestedRecord(record, "checklist"), "bacaanKelegaan1Image"),
      ),
      catitan: firstString(nestedRecord(record, "checklist"), ["catitan"]),
    },
    checklistValues: normalizeChecklistValues(record.checklistValues),
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

function normalizeLifecycleStatus(value: string | null): SurveyLifecycleStatus | null {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "DALAM_RONDAAN" ||
    normalizedValue === "RONDAAN_SELESAI" ||
    normalizedValue === "DISAHKAN_PENGURUS" ||
    normalizedValue === "PERLU_PINDAAN" ||
    normalizedValue === "PINDAAN_SELESAI" ||
    normalizedValue === "LAPORAN_SELESAI" ||
    normalizedValue === "ARKIB"
  ) {
    return normalizedValue;
  }

  return null;
}

function normalizeLifecycleState(rawState: unknown): SurveyLifecycleState | null {
  const record = asRecord(rawState);

  if (!record) {
    return null;
  }

  return {
    status: normalizeLifecycleStatus(firstString(record, ["status"])),
    rondaanSelesaiAt: firstString(record, ["rondaanSelesaiAt"]),
    managerApprovedAt: firstString(record, ["managerApprovedAt"]),
    amendmentRequestedAt: firstString(record, ["amendmentRequestedAt"]),
    amendmentRemark: firstString(record, ["amendmentRemark"]),
    laporanSelesaiAt: firstString(record, ["laporanSelesaiAt"]),
    archivedAt: firstString(record, ["archivedAt"]),
  };
}

function normalizeLifecycleEvent(
  rawEvent: unknown,
  index: number,
): SurveyLifecycleEvent | null {
  const record = asRecord(rawEvent);

  if (!record) {
    return null;
  }

  const toStatus = normalizeLifecycleStatus(firstString(record, ["toStatus"]));

  if (!toStatus) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? `lifecycle-event-${index}`,
    fromStatus: normalizeLifecycleStatus(firstString(record, ["fromStatus"])),
    toStatus,
    remark: firstString(record, ["remark"]),
    createdAt: firstString(record, ["createdAt"]),
    createdBy: normalizeUser(record.createdBy),
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
    lifecycle: normalizeLifecycleState(record.lifecycle),
    lifecycleEvents: readArray(record, ["lifecycleEvents"])
      .map(normalizeLifecycleEvent)
      .filter((event): event is SurveyLifecycleEvent => Boolean(event)),
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
    checklistColumns: normalizeChecklistColumns(record.checklistColumns),
  };
}

export async function fetchSiteVisits(token: string): Promise<SiteVisitListItem[]> {
  const payload = await apiRequest<unknown>("/site-visits", { token });

  return extractSiteVisitArray(payload)
    .map(normalizeSiteVisit)
    .filter((visit): visit is SiteVisitListItem => Boolean(visit));
}

export async function fetchSubstations(token: string): Promise<SiteVisitSubstation[]> {
  const payload = await apiRequest<unknown>("/substations", { token });

  return extractSiteVisitArray(payload).map(normalizeSubstation).filter(Boolean) as SiteVisitSubstation[];
}

export async function createSiteVisit(
  token: string,
  payload: Record<string, unknown>,
): Promise<SiteVisitListItem> {
  const visit = normalizeSiteVisit(
    await apiRequest<unknown>("/site-visits", {
      method: "POST",
      token,
      body: JSON.stringify(payload),
    }),
    0,
  );

  if (!visit) {
    throw new Error("Unable to read created site visit.");
  }

  return visit;
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

async function transitionSurveyLifecycle(
  token: string,
  siteVisitId: string,
  action:
    | "rondaan-selesai"
    | "manager-approve"
    | "manager-request-amendment"
    | "request-amendment"
    | "generate-report"
    | "archive",
  body?: Record<string, unknown>,
): Promise<SiteVisitDetail> {
  const payload = await apiRequest<unknown>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/lifecycle/${action}`,
    {
      method: "POST",
      token,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const visit = normalizeSiteVisitDetail(payload);

  if (!visit) {
    throw new Error("Unable to read the updated site visit.");
  }

  return visit;
}

/** Inspector marks the walk-through done (→ RONDAAN SELESAI). */
export function markRondaanSelesai(token: string, siteVisitId: string) {
  return transitionSurveyLifecycle(token, siteVisitId, "rondaan-selesai");
}

/** Manager approves the submitted survey, pushing it to DC (→ DISAHKAN PENGURUS). */
export function managerApproveSurvey(token: string, siteVisitId: string) {
  return transitionSurveyLifecycle(token, siteVisitId, "manager-approve");
}

/** Manager bounces the survey back to the field crew (→ PERLU PINDAAN). */
export function managerRequestAmendment(
  token: string,
  siteVisitId: string,
  remark: string,
) {
  return transitionSurveyLifecycle(token, siteVisitId, "manager-request-amendment", {
    remark,
  });
}

/** DC sends the survey back for amendments (→ PERLU PINDAAN). */
export function requestSurveyAmendment(
  token: string,
  siteVisitId: string,
  remark: string,
) {
  return transitionSurveyLifecycle(token, siteVisitId, "request-amendment", { remark });
}

/** DC generates the report — the gate into LAPORAN SELESAI. */
export function generateSurveyReport(token: string, siteVisitId: string) {
  return transitionSurveyLifecycle(token, siteVisitId, "generate-report");
}

/** DC / Admin archives the completed cycle (→ ARKIB). */
export function archiveSurvey(token: string, siteVisitId: string) {
  return transitionSurveyLifecycle(token, siteVisitId, "archive");
}

export interface SurveyDeletePreview {
  siteVisitId: string;
  pencawang: string | null;
  /** Inspections that will be deleted with the survey. */
  inspections: number;
  /** Poles created during this survey. */
  createdAssets: number;
  /** Poles that WILL be deleted (created here, not shared with another survey). */
  assetsToDelete: number;
  /** Poles KEPT because another survey/cycle also references them. */
  sharedAssetsKept: number;
}

export interface SurveyDeleteResult {
  deleted: boolean;
  siteVisitId: string;
  deletedInspections: number;
  deletedAssets: number;
  skippedSharedAssets: number;
}

/** ADMIN: preview what deleting this survey (+ its created poles) would remove. */
export async function fetchSurveyDeletePreview(
  token: string,
  siteVisitId: string,
): Promise<SurveyDeletePreview> {
  return apiRequest<SurveyDeletePreview>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/delete-preview`,
    { token },
  );
}

/** ADMIN: hard-delete the survey + the poles created during it (shared poles kept). */
export async function deleteSiteVisit(
  token: string,
  siteVisitId: string,
): Promise<SurveyDeleteResult> {
  return apiRequest<SurveyDeleteResult>(
    `/site-visits/${encodeURIComponent(siteVisitId)}`,
    { method: "DELETE", token },
  );
}

/** Open the next annual cycle — a fresh survey against the same poles. */
export async function openNextCycle(
  token: string,
  siteVisitId: string,
): Promise<SiteVisitDetail> {
  const payload = await apiRequest<unknown>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/open-next-cycle`,
    { method: "POST", token },
  );
  const visit = normalizeSiteVisitDetail(payload);

  if (!visit) {
    throw new Error("Unable to read the new cycle survey.");
  }

  return visit;
}

/** Supervisor / Manager / Admin reassigns the survey to another team (ADR 0002 §4). */
export async function reassignSiteVisit(
  token: string,
  siteVisitId: string,
  toTeamId: string,
  reason: string,
): Promise<SiteVisitDetail> {
  const payload = await apiRequest<unknown>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/reassign`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ toTeamId, reason }),
    },
  );
  const visit = normalizeSiteVisitDetail(payload);

  if (!visit) {
    throw new Error("Unable to read the reassigned site visit.");
  }

  return visit;
}

/**
 * In-place DC correction of a pole's recorded BACAAN KELEGAAN 1 reading on its
 * latest submitted inspection (governance override of the submitted-lock — see
 * PATCH /inspections/:id/kelegaan-reading). `value` is free text: a number, the
 * "LO" sentinel, or "" to clear.
 */
export async function correctKelegaanReading(
  token: string,
  inspectionId: string,
  value: string,
  siteVisitId: string,
): Promise<void> {
  await apiRequest<unknown>(
    `/inspections/${encodeURIComponent(inspectionId)}/kelegaan-reading`,
    {
      method: "PATCH",
      token,
      // siteVisitId lets the server reject a cross-cycle correction (the shown
      // reading is the pole's latest submitted inspection, maybe a newer cycle).
      body: JSON.stringify({ value, siteVisitId }),
    },
  );
}

/**
 * In-place edit of ANY recorded checklist value on a pole's latest submitted
 * inspection (generalizes {@link correctKelegaanReading}). `columnKey` is the
 * Linked-Assets column key (the item's normalized label); `value` is free text
 * — the server coerces it to the item's typed column and "" clears it. Allowed
 * for ADMIN / DC / the managing manager (own teams + subcontractor subtree); the
 * API re-enforces scope on each write.
 */
export async function editChecklistValue(
  token: string,
  inspectionId: string,
  columnKey: string,
  value: string,
  siteVisitId: string,
): Promise<void> {
  await apiRequest<unknown>(
    `/inspections/${encodeURIComponent(inspectionId)}/checklist-result`,
    {
      method: "PATCH",
      token,
      body: JSON.stringify({ columnKey, value, siteVisitId }),
    },
  );
}

function normalizeCycleDeltaPole(rawPole: unknown, index: number): CycleDeltaPole | null {
  const record = asRecord(rawPole);

  if (!record) {
    return null;
  }

  return {
    id: firstString(record, ["id"]) ?? `cycle-pole-${index}`,
    assetCode: firstString(record, ["assetCode", "code", "noTiangRondaan"]) ?? "—",
    noTiangLama: firstString(record, ["noTiangLama"]),
    status: firstString(record, ["status"]) ?? "ACTIVE",
  };
}

function normalizeCycleDeltaPoles(record: ApiRecord | null, key: string): CycleDeltaPole[] {
  return readArray(record, [key])
    .map(normalizeCycleDeltaPole)
    .filter((pole): pole is CycleDeltaPole => Boolean(pole));
}

/** The year-over-year delta for a cycle survey (new / removed / carried poles). */
export async function fetchCycleDelta(
  token: string,
  siteVisitId: string,
): Promise<CycleDelta> {
  const payload = await apiRequest<unknown>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/cycle-delta`,
    { token },
  );
  const record = asRecord(payload);
  const prior = nestedRecord(record, "priorCycle");
  const summary = nestedRecord(record, "summary");
  const recencyRecord = nestedRecord(record, "recency");
  const dueStatus = (firstString(recencyRecord, ["status"]) ?? "UNKNOWN") as SurveyDueStatus;

  return {
    isBaseline: readBoolean(record, "isBaseline") ?? !prior,
    cycleNumber: readNumber(record, "cycleNumber"),
    recency: {
      lastInspectedAt: firstString(recencyRecord, ["lastInspectedAt"]),
      monthsSince: readNumber(recencyRecord, "monthsSince"),
      intervalMonths: numberOrZero(recencyRecord?.intervalMonths) || 12,
      status: ["ON_TIME", "DUE_SOON", "OVERDUE", "UNKNOWN"].includes(dueStatus)
        ? dueStatus
        : "UNKNOWN",
    },
    priorCycle: prior
      ? {
          id: firstString(prior, ["id"]) ?? "",
          startedAt: firstString(prior, ["startedAt"]),
          cycleNumber: readNumber(prior, "cycleNumber"),
          pencawangCode: firstString(prior, ["pencawangCode"]),
        }
      : null,
    summary: {
      observed: numberOrZero(summary?.observed),
      added: numberOrZero(summary?.added),
      removed: numberOrZero(summary?.removed),
      carried: numberOrZero(summary?.carried),
    },
    newPoles: normalizeCycleDeltaPoles(record, "newPoles"),
    removedPoles: normalizeCycleDeltaPoles(record, "removedPoles"),
    carriedPoles: normalizeCycleDeltaPoles(record, "carriedPoles"),
  };
}

function normalizeContributionSnapshot(raw: unknown): TeamContributionSnapshot {
  const record = asRecord(raw);

  return {
    reason: firstString(record, ["reason"]) ?? "",
    assetsCompleted: numberOrZero(record?.assetsCompleted),
    totalAssets: numberOrZero(record?.totalAssets),
    at: firstString(record, ["at"]),
  };
}

function normalizeContributionTeam(raw: unknown): TeamContributionShare | null {
  const record = asRecord(raw);
  const teamId = firstString(record, ["teamId"]);

  if (!record || !teamId) {
    return null;
  }

  return {
    teamId,
    teamName: firstString(record, ["teamName"]),
    assetsCompleted: numberOrZero(record.assetsCompleted),
    isCurrent: readBoolean(record, "isCurrent") ?? false,
    snapshots: readArray(record, ["snapshots"]).map(normalizeContributionSnapshot),
  };
}

function normalizeReassignmentRecord(raw: unknown): ReassignmentRecord | null {
  const record = asRecord(raw);

  if (!record) {
    return null;
  }

  return {
    fromTeamId: firstString(record, ["fromTeamId"]) ?? "",
    fromTeamName: firstString(record, ["fromTeamName"]),
    toTeamId: firstString(record, ["toTeamId"]) ?? "",
    toTeamName: firstString(record, ["toTeamName"]),
    reason: firstString(record, ["reason"]) ?? "",
    at: firstString(record, ["at"]),
  };
}

/** Per-team billing contribution ledger for a Pencawang (ADR 0002 §5). */
export async function fetchSiteVisitContributions(
  token: string,
  siteVisitId: string,
): Promise<SiteVisitContributions> {
  const payload = await apiRequest<unknown>(
    `/site-visits/${encodeURIComponent(siteVisitId)}/contributions`,
    { token },
  );
  const record = asRecord(payload);

  return {
    siteVisitId: firstString(record, ["siteVisitId"]) ?? siteVisitId,
    currentTeamId: firstString(record, ["currentTeamId"]) ?? "",
    totalAssets: numberOrZero(record?.totalAssets),
    totalCompleted: numberOrZero(record?.totalCompleted),
    teams: readArray(record, ["teams"])
      .map(normalizeContributionTeam)
      .filter((team): team is TeamContributionShare => Boolean(team)),
    reassignments: readArray(record, ["reassignments"])
      .map(normalizeReassignmentRecord)
      .filter((entry): entry is ReassignmentRecord => Boolean(entry)),
  };
}
