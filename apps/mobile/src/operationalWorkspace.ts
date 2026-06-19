import type {
  EffectiveCapability,
  InspectionCompletionStatus,
  OperationMode,
  OperationalScope,
  SessionKind,
  SessionUser,
} from './types';

const INSPECTION_WORKSPACE_CAPABILITY_CODE = 'INSPECTION';
const MAINTENANCE_WORKSPACE_CAPABILITY_CODE = 'MAINTENANCE';

// Workspace visibility is driven ONLY by the explicit Workspace Access codes
// (INSPECTION / MAINTENANCE), mirroring the admin "Workspace Access" group
// ("Lets users enter this mobile workspace"). Asset-domain codes
// (SAVR/SAVT/PENCAWANG/...) describe which asset classes an account operates on
// WITHIN a workspace — they must never unlock a workspace on their own.
//
// Previously any asset-domain code unlocked Inspection, which leaked the
// Inspection workspace to maintenance-only accounts that hold a domain grant
// (e.g. MAINTENANCE + SAVR). Inspection is now strict and symmetric with
// Maintenance: the explicit INSPECTION code (or ADMIN) is required.

function normalizeCapabilityCode(code: string): string {
  return code.trim().toUpperCase();
}

export type MobileWorkspaceId = OperationMode;

export type MobileWorkspace = {
  id: MobileWorkspaceId;
  label: string;
  operationMode: OperationMode;
};

export type InspectionQueueStatusGroup =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NEEDS_ATTENTION';

type QueueStatus =
  | InspectionCompletionStatus
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NEED_AMENDMENT'
  | 'NEEDS_AMENDMENT'
  | 'REJECTED'
  | 'APPROVED'
  | string;

const INSPECTION_WORKSPACE: MobileWorkspace = {
  id: 'INSPECTION',
  label: 'Inspection',
  operationMode: 'INSPECTION',
};

const MAINTENANCE_WORKSPACE: MobileWorkspace = {
  id: 'MAINTENANCE',
  label: 'Maintenance',
  operationMode: 'MAINTENANCE',
};

const NETWORK_SCOPES = new Set<OperationalScope>(['SAVR', 'SAVT']);
const STANDALONE_SCOPES = new Set<OperationalScope>([
  'PENCAWANG',
  'FEEDER_PILLAR',
  'CABLE_BRIDGE',
  'LINK_BOX',
]);

/**
 * Inspection authority — STRICT. Only the explicit INSPECTION Workspace Access
 * code or ADMIN. Never inferred from asset-domain codes (SAVR/SAVT/PENCAWANG/...),
 * symmetric with the Maintenance gate. This is the single source of truth for
 * "can this account perform inspection-scope actions" (check-in / start a site
 * visit / add an asset / start an inspection) — reuse it everywhere, do not
 * re-derive from role alone.
 */
export function hasInspectionAuthority(
  user: Pick<SessionUser, 'role'>,
  capabilities: ReadonlyArray<Pick<EffectiveCapability, 'code'>>,
): boolean {
  if (user.role === 'ADMIN') {
    return true;
  }
  return capabilities.some(
    (capability) =>
      normalizeCapabilityCode(capability.code) ===
      INSPECTION_WORKSPACE_CAPABILITY_CODE,
  );
}

/** Maintenance authority — STRICT. Only an explicit MAINTENANCE capability or ADMIN. */
export function hasMaintenanceAuthority(
  user: Pick<SessionUser, 'role'>,
  capabilities: ReadonlyArray<Pick<EffectiveCapability, 'code'>>,
): boolean {
  if (user.role === 'ADMIN') {
    return true;
  }
  return capabilities.some(
    (capability) =>
      normalizeCapabilityCode(capability.code) ===
      MAINTENANCE_WORKSPACE_CAPABILITY_CODE,
  );
}

export function getAvailableMobileWorkspaces(
  user: Pick<SessionUser, 'role'>,
  capabilities: ReadonlyArray<Pick<EffectiveCapability, 'code'>>,
): MobileWorkspace[] {
  const workspaces: MobileWorkspace[] = [];

  if (hasInspectionAuthority(user, capabilities)) {
    workspaces.push(INSPECTION_WORKSPACE);
  }

  if (hasMaintenanceAuthority(user, capabilities)) {
    workspaces.push(MAINTENANCE_WORKSPACE);
  }

  return workspaces;
}

export function getAutoOpenWorkspace(
  user: Pick<SessionUser, 'role'>,
  capabilities: ReadonlyArray<Pick<EffectiveCapability, 'code'>>,
) {
  const workspaces = getAvailableMobileWorkspaces(user, capabilities);

  return workspaces.length === 1 ? workspaces[0] : null;
}

export function getWorkspaceCapabilityCodes(): string[] {
  return [
    INSPECTION_WORKSPACE_CAPABILITY_CODE,
    MAINTENANCE_WORKSPACE_CAPABILITY_CODE,
  ];
}

export function getSessionKindForScope(
  scope?: OperationalScope | null,
): SessionKind | null {
  if (!scope) {
    return null;
  }

  if (scope === 'SAVR') {
    return 'PENCENTRIC';
  }

  if (scope === 'SAVT') {
    return 'ROUTE';
  }

  return 'STANDALONE';
}

export function scopeRequiresQAQC(scope?: OperationalScope | null) {
  return scope === 'SAVR' || scope === 'SAVT';
}

export function isNetworkScope(scope?: OperationalScope | null) {
  return Boolean(scope && NETWORK_SCOPES.has(scope));
}

export function isStandaloneScope(scope?: OperationalScope | null) {
  return Boolean(scope && STANDALONE_SCOPES.has(scope));
}

export function canShowInInspectionMobileQueue(status?: QueueStatus | null) {
  return normalizeQueueStatus(status) !== 'APPROVED';
}

export function getInspectionQueueStatusGroup(
  status?: QueueStatus | null,
): InspectionQueueStatusGroup | null {
  const normalizedStatus = normalizeQueueStatus(status);

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

export function filterDefaultInspectionOperationalQueue<
  T extends { completionStatus?: QueueStatus | null; status?: QueueStatus | null },
>(items: T[]) {
  return items.filter((item) =>
    canShowInInspectionMobileQueue(item.completionStatus ?? item.status),
  );
}

function normalizeQueueStatus(status?: QueueStatus | null) {
  return status?.trim().toUpperCase() ?? '';
}
