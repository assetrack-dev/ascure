import { ApiError, apiRequest } from "@/lib/api";
import type {
  AssetChecklist,
  AssetDetail,
  AssetInspectionStatus,
  AssetListItem,
  InspectionEvidenceImage,
  InspectionResultItem,
} from "@/types/assets";
import type { ChecklistColumn, SiteVisitSensorPhoto } from "@/types/site-visits";

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
    substationId:
      firstString(record, ["substationId", "substation_id"]) ??
      readString(asRecord(record.substation), "id"),
    inspectionStatus,
    date: readDate(record, latestInspection),
    assetStatus: firstString(record, ["assetStatus", "status"]),
  };
}

/**
 * The checklist block on an asset's latest inspection: template-defined columns
 * plus the recorded value per column. Mirrors the Site Visit Linked-Assets
 * normalizer — a column with no matching value stays present (blank) so the
 * panel shows the whole checklist, not only what was filled in.
 */
function normalizeAssetChecklist(raw: unknown): AssetChecklist | undefined {
  const record = asRecord(raw);

  if (!record) {
    return undefined;
  }

  const columns = (Array.isArray(record.columns) ? record.columns : [])
    .map((rawColumn): ChecklistColumn | null => {
      const columnRecord = asRecord(rawColumn);
      const key = readString(columnRecord, "key");
      const label = readString(columnRecord, "label");

      if (!key || !label) {
        return null;
      }

      const rawOptions = columnRecord?.options;
      const rawItemIds = columnRecord?.templateItemIds;

      return {
        key,
        label,
        section: readString(columnRecord, "section"),
        inputType: readString(columnRecord, "inputType") ?? undefined,
        options: Array.isArray(rawOptions)
          ? rawOptions
              .map((rawOption) => {
                const optionRecord = asRecord(rawOption);
                const value = readString(optionRecord, "value");
                return value
                  ? { value, label: readString(optionRecord, "label") ?? value }
                  : null;
              })
              .filter((option): option is { label: string; value: string } =>
                Boolean(option),
              )
          : undefined,
        templateItemIds: Array.isArray(rawItemIds)
          ? rawItemIds.filter((id): id is string => typeof id === "string")
          : undefined,
      };
    })
    .filter((column): column is ChecklistColumn => Boolean(column));

  const rawValues = asRecord(record.values);
  const values: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(rawValues ?? {})) {
    values[key] = typeof value === "string" ? value : null;
  }

  const rawImages = asRecord(record.images);
  const images: Record<string, SiteVisitSensorPhoto> = {};
  for (const [templateItemId, rawImage] of Object.entries(rawImages ?? {})) {
    const imageRecord = asRecord(rawImage);
    const url = readString(imageRecord, "url");

    if (!url) {
      continue;
    }

    images[templateItemId] = {
      url,
      filename: readString(imageRecord, "filename"),
      // The capture time when the device recorded one, else the upload time.
      timestamp:
        readString(imageRecord, "timestamp") ?? readString(imageRecord, "createdAt"),
      latitude: readNumber(imageRecord, "latitude"),
      longitude: readNumber(imageRecord, "longitude"),
    };
  }

  return { columns, values, images };
}

function normalizeAssetDetail(rawAsset: unknown, index = 0): AssetDetail | null {
  const record = asRecord(rawAsset);
  const baseAsset = normalizeAsset(rawAsset, index);

  if (!record || !baseAsset) {
    return null;
  }

  const latestInspection = readLatestInspection(record);
  const items = firstArray(latestInspection, ["items", "itemResults", "results"])
    .map((raw): InspectionResultItem | null => {
      const itemRecord = asRecord(raw);
      const label = readString(itemRecord, "label");

      if (!label) {
        return null;
      }

      const result = readString(itemRecord, "result");
      return {
        id: readString(itemRecord, "id") ?? label,
        label,
        result: result ? result.toUpperCase() : null,
        remark: readString(itemRecord, "remark"),
        isDefect: itemRecord?.isDefect === true,
        severity: readString(itemRecord, "severity"),
      };
    })
    .filter((item): item is InspectionResultItem => Boolean(item));
  const images = firstArray(latestInspection, ["images", "inspectionImages"])
    .map((image): InspectionEvidenceImage | null => {
      const imageRecord = asRecord(image);
      const url = readString(imageRecord, "url");

      if (!url) {
        return null;
      }

      return {
        id: readString(imageRecord, "id") ?? url,
        inspectionId: readString(imageRecord, "inspectionId") ?? "",
        templateItemId: readString(imageRecord, "templateItemId"),
        url,
        path: readString(imageRecord, "path"),
        filename: readString(imageRecord, "filename"),
        mimeType: readString(imageRecord, "mimeType"),
        sizeBytes: readNumber(imageRecord, "sizeBytes"),
        latitude: readNumber(imageRecord, "latitude"),
        longitude: readNumber(imageRecord, "longitude"),
        timestamp: readString(imageRecord, "timestamp"),
        createdAt: readString(imageRecord, "createdAt"),
      };
    })
    .filter((image): image is InspectionEvidenceImage => Boolean(image));

  const savtRoutes = (Array.isArray(record.savtRoutes) ? record.savtRoutes : [])
    .map((raw) => {
      const routeRecord = asRecord(raw);
      const routeCode = readString(routeRecord, "routeCode");
      const noTiang = readString(routeRecord, "noTiang");
      if (!routeCode || !noTiang) {
        return null;
      }
      return {
        routeCode,
        noTiang,
        poleCode: readString(routeRecord, "poleCode") ?? `${routeCode} ${noTiang}`,
      };
    })
    .filter((route): route is NonNullable<typeof route> => Boolean(route));

  return {
    ...baseAsset,
    name: firstString(record, ["name", "assetName"]),
    latitude: readNumber(record, "latitude"),
    longitude: readNumber(record, "longitude"),
    savtRoutes,
    latestInspection: latestInspection
      ? {
          id: firstString(latestInspection, ["id", "inspectionId"]) ?? "latest-inspection",
          siteVisitId: firstString(latestInspection, ["siteVisitId"]),
          checklist: normalizeAssetChecklist(latestInspection.checklist),
          cycleNumber: readNumber(latestInspection, "cycleNumber") ?? readNumber(latestInspection, "inspectionCycle"),
          status:
            firstString(latestInspection, ["status", "completionStatus", "inspectionStatus"]) ??
            null,
          submittedAt:
            firstString(latestInspection, ["submittedAt", "completedAt", "date", "createdAt"]) ??
            null,
          remarks: firstString(latestInspection, ["remarks", "remark", "notes"]),
          reinspectionReason: readString(latestInspection, "reinspectionReason"),
          reinspectionRequestedAt: readString(
            latestInspection,
            "reinspectionRequestedAt",
          ),
          totalDefects:
            readNumber(latestInspection, "totalDefects") ??
            items.filter((item) => item.isDefect).length,
          items,
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

/** Update a pole's NO TIANG RONDAAN (asset code). Pass an already-canonicalized
 *  code (normalizePoleInput) so the stored value matches the rondaan grammar. */
export async function updateAssetCode(
  token: string,
  assetId: string,
  assetCode: string,
): Promise<void> {
  await apiRequest<unknown>(`/assets/${encodeURIComponent(assetId)}`, {
    method: "PUT",
    token,
    body: JSON.stringify({ assetCode }),
  });
}

export interface DeleteAssetsResult {
  deleted: number;
  deletedIds: string[];
  notFound: string[];
}

/** Hard-delete a single asset (and its inspections/defects/photos). */
export async function deleteAsset(token: string, id: string): Promise<DeleteAssetsResult> {
  return apiRequest<DeleteAssetsResult>(`/assets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

/** Hard-delete a selected set of assets by id. */
export async function bulkDeleteAssets(token: string, ids: string[]): Promise<DeleteAssetsResult> {
  return apiRequest<DeleteAssetsResult>("/assets/bulk-delete", {
    method: "POST",
    token,
    body: JSON.stringify({ ids }),
  });
}

/** ADMIN-only: hard-delete every asset in a Pencawang (substation). */
export async function deleteAssetsBySubstation(
  token: string,
  substationId: string,
): Promise<DeleteAssetsResult> {
  return apiRequest<DeleteAssetsResult>(
    `/assets/by-substation/${encodeURIComponent(substationId)}`,
    { method: "DELETE", token },
  );
}

/** ADMIN-only: hard-delete every asset associated with an Operational Session. */
export async function deleteAssetsBySession(
  token: string,
  sessionId: string,
): Promise<DeleteAssetsResult> {
  return apiRequest<DeleteAssetsResult>(
    `/assets/by-session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", token },
  );
}
