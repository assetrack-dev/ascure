import type {
  InspectionCompletionStatus,
  OperationMode,
  OperationalScope,
  SessionKind,
  SessionUser,
  UserRole,
} from './types';

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

export function getAvailableMobileWorkspaces(user: Pick<SessionUser, 'role'>) {
  const workspaces: MobileWorkspace[] = [];

  if (hasInspectionWorkspaceAccess(user.role)) {
    workspaces.push(INSPECTION_WORKSPACE);
  }

  if (hasMaintenanceWorkspaceAccess(user.role)) {
    workspaces.push(MAINTENANCE_WORKSPACE);
  }

  return workspaces;
}

export function getAutoOpenWorkspace(user: Pick<SessionUser, 'role'>) {
  const workspaces = getAvailableMobileWorkspaces(user);

  return workspaces.length === 1 ? workspaces[0] : null;
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

function hasInspectionWorkspaceAccess(role: UserRole) {
  return Boolean(role);
}

function hasMaintenanceWorkspaceAccess(role: UserRole) {
  return (
    role === 'ADMIN' ||
    role === 'MANAGER' ||
    role === 'SUPERVISOR' ||
    role === 'TECHNICIAN'
  );
}

function normalizeQueueStatus(status?: QueueStatus | null) {
  return status?.trim().toUpperCase() ?? '';
}
