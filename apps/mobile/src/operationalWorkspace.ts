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

// Any of these capabilities unlock the Inspection workspace. A field
// technician is frequently granted only scope-specific inspection
// capabilities (SAVR/SAVT/PENCAWANG/...) without the umbrella INSPECTION code.
const INSPECTION_CAPABILITY_CODES = new Set<string>([
  INSPECTION_WORKSPACE_CAPABILITY_CODE,
  'SAVR',
  'SAVT',
  'PENCAWANG',
  'FEEDER_PILLAR',
  'CABLE_BRIDGE',
  'LINK_BOX',
]);

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

export function getAvailableMobileWorkspaces(
  user: Pick<SessionUser, 'role'>,
  capabilities: ReadonlyArray<Pick<EffectiveCapability, 'code'>>,
): MobileWorkspace[] {
  const codes = new Set(
    capabilities.map((capability) => normalizeCapabilityCode(capability.code)),
  );
  const isAdmin = user.role === 'ADMIN';
  const workspaces: MobileWorkspace[] = [];

  // Inspection: ADMIN, the umbrella INSPECTION code, OR any scope-specific
  // inspection capability (SAVR/SAVT/PENCAWANG/...).
  const hasInspectionAuthority =
    isAdmin || [...codes].some((code) => INSPECTION_CAPABILITY_CODES.has(code));

  if (hasInspectionAuthority) {
    workspaces.push(INSPECTION_WORKSPACE);
  }

  // Maintenance: STRICT. Only an explicit MAINTENANCE capability or ADMIN.
  // Never inferred from the presence of other capabilities, and never
  // defaulted on.
  const hasMaintenanceAuthority =
    isAdmin || codes.has(MAINTENANCE_WORKSPACE_CAPABILITY_CODE);

  if (hasMaintenanceAuthority) {
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
