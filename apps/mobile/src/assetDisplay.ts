import type { Asset, SiteVisit } from './types';
import { getInspectionQueueStatusGroup } from './operationalWorkspace';

// Some asset payloads expose the pole numbers as first-class fields, others only
// inside `metadata` (and under a few historical key spellings). These optional
// shapes let us read whichever is present without widening the shared Asset type.
type AssetDisplayFields = {
  noTiangRondaan?: unknown;
  no_tiang_rondaan?: unknown;
  noTiangLama?: unknown;
  no_tiang_lama?: unknown;
};

function getMetadataValue(metadata: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in metadata) {
      return metadata[key];
    }
  }

  return undefined;
}

function normalizeDisplayValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function getAssetMetadata(asset: Asset): Record<string, unknown> {
  return asset.metadata && typeof asset.metadata === 'object'
    ? (asset.metadata as Record<string, unknown>)
    : {};
}

/** NO TIANG RONDAAN — the active patrol pole number (e.g. "A 1"). */
export function getNoTiangRondaan(asset: Asset): string | null {
  const flexible = asset as Asset & AssetDisplayFields;
  const value =
    flexible.noTiangRondaan ??
    flexible.no_tiang_rondaan ??
    getMetadataValue(getAssetMetadata(asset), [
      'noTiangRondaan',
      'no_tiang_rondaan',
      'No Tiang Rondaan',
      'NO TIANG RONDAAN',
      'noTiang',
      'poleNumber',
      'ntr',
      'NTR',
    ]);

  // For SAVR assets NO TIANG RONDAAN is captured in assetCode (see AddAssetScreen:
  // assetCodeLabel = 'NO TIANG RONDAAN'), so fall back to it when no explicit
  // field/metadata value exists. This is what makes it the row title.
  return normalizeDisplayValue(value) ?? normalizeDisplayValue(asset.assetCode);
}

/**
 * NO TIANG LAMA — the legacy pole number (e.g. "PP 1"). Historically this value
 * was stored in `asset.name`, so fall back to it when no explicit field exists.
 */
export function getNoTiangLama(asset: Asset): string | null {
  const flexible = asset as Asset & AssetDisplayFields;
  const value =
    flexible.noTiangLama ??
    flexible.no_tiang_lama ??
    getMetadataValue(getAssetMetadata(asset), [
      'noTiangLama',
      'no_tiang_lama',
      'No Tiang Lama',
      'NO TIANG LAMA',
      'poleNumberOld',
      'oldPoleNumber',
      'ntl',
      'NTL',
    ]);

  return normalizeDisplayValue(value) ?? normalizeDisplayValue(asset.name);
}

/**
 * Row display labels for an asset: the primary title is NO TIANG RONDAAN and the
 * subtitle leads with NO TIANG LAMA (per field validation feedback). Each falls
 * back gracefully so a row is never blank when a pole number is missing.
 */
export function getAssetRowLabels(asset: Asset): { title: string; subtitle: string | null } {
  const noTiangRondaan = getNoTiangRondaan(asset);
  const noTiangLama = getNoTiangLama(asset);
  const title = noTiangRondaan ?? noTiangLama ?? asset.assetCode ?? 'Unnamed asset';

  const subtitleParts: string[] = [];
  if (noTiangLama && noTiangLama !== title) {
    subtitleParts.push(`NTL ${noTiangLama}`);
  }
  if (noTiangRondaan && noTiangRondaan !== title) {
    subtitleParts.push(`NTR ${noTiangRondaan}`);
  }
  if (subtitleParts.length === 0 && asset.assetCode && asset.assetCode !== title) {
    subtitleParts.push(asset.assetCode);
  }

  return { title, subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : null };
}

/** Asset IDs with at least one submitted inspection on this visit. */
export function getSubmittedInspectionAssetIds(visit: SiteVisit): Set<string> {
  const assetIds = new Set<string>();

  for (const inspection of visit.inspections ?? []) {
    if (
      getInspectionQueueStatusGroup(inspection.completionStatus) === 'COMPLETED' ||
      inspection.submittedAt
    ) {
      assetIds.add(inspection.assetId);
    }
  }

  return assetIds;
}

/** Asset IDs whose inspection answers triggered at least one defect on this visit. */
export function getDefectAssetIds(visit: SiteVisit): Set<string> {
  const assetIds = new Set<string>();

  for (const inspection of visit.inspections ?? []) {
    if ((inspection.itemResults ?? []).some((item) => item.isDefect)) {
      assetIds.add(inspection.assetId);
    }
  }

  return assetIds;
}
