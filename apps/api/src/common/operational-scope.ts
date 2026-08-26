import {
  OperationMode,
  OperationalScope,
  SessionKind,
} from '@prisma/client';

export const DEFAULT_OPERATION_MODE = OperationMode.INSPECTION;
export const DEFAULT_OPERATIONAL_SCOPE = OperationalScope.SAVR;

const NETWORK_SCOPES = new Set<OperationalScope>([
  OperationalScope.SAVR,
  OperationalScope.SAVT,
]);

const STANDALONE_SCOPES = new Set<OperationalScope>([
  OperationalScope.PENCAWANG,
  OperationalScope.FEEDER_PILLAR,
  OperationalScope.CABLE_BRIDGE,
  OperationalScope.LINK_BOX,
]);

export type InspectionMobileQueueGroup =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NEEDS_ATTENTION';

export function getSessionKindForScope(
  scope?: OperationalScope | null,
): SessionKind | null {
  if (!scope) {
    return null;
  }

  if (scope === OperationalScope.SAVR) {
    return SessionKind.PENCENTRIC;
  }

  if (scope === OperationalScope.SAVT) {
    return SessionKind.ROUTE;
  }

  return SessionKind.STANDALONE;
}

export function scopeRequiresQAQC(scope?: OperationalScope | null) {
  return scope === OperationalScope.SAVR || scope === OperationalScope.SAVT;
}

export function isNetworkScope(scope?: OperationalScope | null) {
  return Boolean(scope && NETWORK_SCOPES.has(scope));
}

export function isStandaloneScope(scope?: OperationalScope | null) {
  return Boolean(scope && STANDALONE_SCOPES.has(scope));
}

/**
 * refCode prefix per standalone scope: the server-assigned tenant-wide asset
 * code is `<prefix>-<NNNN>` (PC-0001, FP-0001, …) — the stable handle a crew
 * uses to find the same equipment again next cycle. Network scopes (SAVR/SAVT)
 * have no prefix: pole identity is the NO TIANG grammar, not a refCode.
 */
const STANDALONE_REF_CODE_PREFIXES: Partial<Record<OperationalScope, string>> = {
  [OperationalScope.PENCAWANG]: 'PC',
  [OperationalScope.FEEDER_PILLAR]: 'FP',
  [OperationalScope.LINK_BOX]: 'LB',
  [OperationalScope.CABLE_BRIDGE]: 'CB',
};

export function standaloneRefCodePrefix(
  scope?: OperationalScope | null,
): string | null {
  return (scope && STANDALONE_REF_CODE_PREFIXES[scope]) || null;
}

export function canShowInInspectionMobileQueue(status?: string | null) {
  return normalizeInspectionQueueStatus(status) !== 'APPROVED';
}

export function getInspectionMobileQueueGroup(
  status?: string | null,
): InspectionMobileQueueGroup | null {
  const normalizedStatus = normalizeInspectionQueueStatus(status);

  if (normalizedStatus === 'APPROVED') {
    return null;
  }

  if (
    normalizedStatus === 'NEED_AMENDMENT' ||
    normalizedStatus === 'NEEDS_AMENDMENT' ||
    normalizedStatus === 'REJECTED'
  ) {
    return 'NEEDS_ATTENTION';
  }

  if (
    normalizedStatus === 'COMPLETED' ||
    normalizedStatus === 'SUBMITTED'
  ) {
    return 'COMPLETED';
  }

  return 'IN_PROGRESS';
}

export function inferOperationalScopeFromAssetTypeCode(
  assetTypeCode?: string | null,
): OperationalScope | null {
  const normalizedCode = assetTypeCode
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');

  if (!normalizedCode) {
    return null;
  }

  if (normalizedCode.includes('SAVT')) {
    return OperationalScope.SAVT;
  }

  if (normalizedCode.includes('SAVR')) {
    return OperationalScope.SAVR;
  }

  if (normalizedCode.includes('FEEDER') || normalizedCode.includes('PILLAR')) {
    return OperationalScope.FEEDER_PILLAR;
  }

  if (normalizedCode.includes('CABLE') || normalizedCode.includes('BRIDGE')) {
    return OperationalScope.CABLE_BRIDGE;
  }

  if (normalizedCode.includes('LINK') || normalizedCode.includes('BOX')) {
    return OperationalScope.LINK_BOX;
  }

  if (
    normalizedCode.includes('PENCAWANG') ||
    normalizedCode.includes('SUBSTATION')
  ) {
    return OperationalScope.PENCAWANG;
  }

  return null;
}

function normalizeInspectionQueueStatus(status?: string | null) {
  return status?.trim().toUpperCase() ?? '';
}
