import { apiRequest } from "@/lib/api";
import type { DefectListItem, DefectSeverity, DefectStatus } from "@/types/defects";

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

  if (normalizedValue === "CLOSED" || normalizedValue === "RESOLVED") {
    return "CLOSED";
  }

  return "UNKNOWN";
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
    status: normalizeStatus(firstString(record, ["status"])),
    date,
    location: readLocation(record),
    remark: firstString(record, ["remark", "checklistRemark", "description"]),
    actionRemark: firstString(record, ["actionRemark"]),
    closedAt: firstString(record, ["closedAt"]),
    submittedAt: firstString(record, ["submittedAt"]),
    createdAt: firstString(record, ["createdAt"]),
  };
}

export async function fetchDefects(token: string): Promise<DefectListItem[]> {
  const payload = await apiRequest<unknown>("/defects", { token });

  return extractDefectArray(payload)
    .map(normalizeDefect)
    .filter((defect): defect is DefectListItem => Boolean(defect));
}
