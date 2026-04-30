import { ApiError, apiRequest } from "@/lib/api";
import type { AssetDetail, AssetInspectionStatus, AssetListItem } from "@/types/assets";

type ApiRecord = Record<string, unknown>;

interface Substation {
  id: string;
}

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

function extractAssetArray(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  if (!record) {
    return [];
  }

  for (const key of ["data", "items", "assets", "results"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function firstArray(record: ApiRecord | null, keys: string[]) {
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

function normalizeInspectionStatus(value: string | null, hasInspection: boolean): AssetInspectionStatus {
  const normalizedValue = value?.trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (
    normalizedValue === "COMPLETED" ||
    normalizedValue === "COMPLETE" ||
    normalizedValue === "SUBMITTED" ||
    normalizedValue === "DONE"
  ) {
    return "COMPLETED";
  }

  if (
    normalizedValue === "PENDING" ||
    normalizedValue === "DRAFT" ||
    normalizedValue === "IN_PROGRESS" ||
    normalizedValue === "OPEN"
  ) {
    return "PENDING";
  }

  return hasInspection ? "COMPLETED" : "PENDING";
}

function readLatestInspection(record: ApiRecord | null) {
  const directInspection =
    nestedRecord(record, "latestInspection") ??
    nestedRecord(record, "lastInspection") ??
    nestedRecord(record, "inspection");

  if (directInspection) {
    return directInspection;
  }

  const inspections = firstArray(record, ["inspections"]);
  return asRecord(inspections[0]);
}

function readMetadata(record: ApiRecord | null) {
  return asRecord(record?.metadata);
}

function readAssetType(record: ApiRecord | null) {
  const assetType = nestedRecord(record, "assetType");

  return (
    readString(record, "assetType") ??
    readString(record, "assetTypeName") ??
    firstString(assetType, ["name", "code"])
  );
}

function readFeeder(record: ApiRecord | null) {
  const metadata = readMetadata(record);
  const feeder = nestedRecord(record, "feeder");

  return (
    firstString(record, ["feeder", "feederName", "feederCode", "feeder_name", "feeder_code"]) ??
    firstString(metadata, ["feeder", "feederName", "feederCode", "feeder_name", "feeder_code"]) ??
    firstString(feeder, ["name", "code"])
  );
}

function readPencawangName(record: ApiRecord | null) {
  const substation = nestedRecord(record, "substation") ?? nestedRecord(record, "pencawang");

  return (
    firstString(record, ["pencawangName", "substationName", "pencawang", "substation"]) ??
    firstString(substation, ["name", "code"])
  );
}

function readLocation(record: ApiRecord | null) {
  const metadata = readMetadata(record);
  const substation = nestedRecord(record, "substation") ?? nestedRecord(record, "pencawang");
  const latitude = readNumber(record, "latitude");
  const longitude = readNumber(record, "longitude");

  return (
    firstString(record, ["location", "assetLocation", "address"]) ??
    firstString(metadata, ["location", "assetLocation", "address"]) ??
    firstString(substation, ["location", "name", "code"]) ??
    (latitude !== null && longitude !== null
      ? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
      : null)
  );
}

function readDate(record: ApiRecord | null, latestInspection: ApiRecord | null) {
  return (
    firstString(latestInspection, ["submittedAt", "completedAt", "date", "createdAt", "updatedAt"]) ??
    firstString(record, [
      "lastInspectedAt",
      "latestInspectionDate",
      "inspectionDate",
      "submittedAt",
      "date",
      "updatedAt",
      "createdAt",
    ])
  );
}

function normalizeAsset(rawAsset: unknown, index: number): AssetListItem | null {
  const record = asRecord(rawAsset);

  if (!record) {
    return null;
  }

  const latestInspection = readLatestInspection(record);
  const id = firstString(record, ["id", "assetId"]) ?? `asset-${index}`;
  const assetCode =
    firstString(record, ["assetCode", "asset_code", "code", "noTiangRondaan"]) ??
    "Unassigned";
  const inspectionStatus = normalizeInspectionStatus(
    firstString(record, ["inspectionStatus", "completionStatus"]) ??
      firstString(latestInspection, ["inspectionStatus", "completionStatus", "status"]),
    Boolean(latestInspection),
  );

  return {
    id,
    assetCode,
    assetType: readAssetType(record),
    feeder: readFeeder(record),
    location: readLocation(record),
    pencawangName: readPencawangName(record),
    inspectionStatus,
    date: readDate(record, latestInspection),
    assetStatus: firstString(record, ["assetStatus", "status"]),
  };
}

function normalizeAssetDetail(rawAsset: unknown, index = 0): AssetDetail | null {
  const record = asRecord(rawAsset);
  const baseAsset = normalizeAsset(rawAsset, index);

  if (!record || !baseAsset) {
    return null;
  }

  const latestInspection = readLatestInspection(record);
  const images = firstArray(latestInspection, ["images", "inspectionImages"])
    .map((image) => {
      const imageRecord = asRecord(image);
      const url = readString(imageRecord, "url");

      return url ? { url } : null;
    })
    .filter((image): image is { url: string } => Boolean(image));

  return {
    ...baseAsset,
    name: firstString(record, ["name", "assetName"]),
    latitude: readNumber(record, "latitude"),
    longitude: readNumber(record, "longitude"),
    latestInspection: latestInspection
      ? {
          id: firstString(latestInspection, ["id", "inspectionId"]) ?? "latest-inspection",
          cycleNumber: readNumber(latestInspection, "cycleNumber") ?? readNumber(latestInspection, "inspectionCycle"),
          status:
            firstString(latestInspection, ["status", "completionStatus", "inspectionStatus"]) ??
            null,
          submittedAt:
            firstString(latestInspection, ["submittedAt", "completedAt", "date", "createdAt"]) ??
            null,
          remarks: firstString(latestInspection, ["remarks", "remark", "notes"]),
          images,
        }
      : null,
  };
}

function sortAssets(assets: AssetListItem[]) {
  return [...assets].sort((left, right) =>
    left.assetCode.localeCompare(right.assetCode, "en", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

async function fetchAssetsBySubstation(token: string): Promise<AssetListItem[]> {
  const substations = await apiRequest<Substation[]>("/substations", { token });
  const results = await Promise.allSettled(
    substations.map((substation) =>
      apiRequest<unknown>(`/assets?substation_id=${encodeURIComponent(substation.id)}`, {
        token,
      }),
    ),
  );
  const assets = results.flatMap((result) =>
    result.status === "fulfilled" ? extractAssetArray(result.value) : [],
  );
  const uniqueAssets = new Map<string, AssetListItem>();

  assets
    .map(normalizeAsset)
    .filter((asset): asset is AssetListItem => Boolean(asset))
    .forEach((asset) => uniqueAssets.set(asset.id, asset));

  return sortAssets(Array.from(uniqueAssets.values()));
}

export async function fetchAssets(token: string): Promise<AssetListItem[]> {
  try {
    const payload = await apiRequest<unknown>("/assets", { token });

    return sortAssets(
      extractAssetArray(payload)
        .map(normalizeAsset)
        .filter((asset): asset is AssetListItem => Boolean(asset)),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      return fetchAssetsBySubstation(token);
    }

    throw error;
  }
}

export async function fetchAssetDetail(token: string, assetId: string): Promise<AssetDetail | null> {
  const payload = await apiRequest<unknown>(`/assets/${encodeURIComponent(assetId)}`, { token });

  return normalizeAssetDetail(payload);
}
