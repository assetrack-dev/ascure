import type {
  OperationalSession,
  OperationalSessionProgress,
  OperationalSessionScope,
  OperationalSessionStatus,
} from './types';

export type OperationalSessionGroupKey =
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'NEEDS_ATTENTION'
  | 'COMPLETED';

export const OPERATIONAL_SESSION_GROUPS: Array<{
  group: OperationalSessionGroupKey;
  label: string;
  tone: 'info' | 'success' | 'danger';
}> = [
  { group: 'ASSIGNED', label: 'Assigned', tone: 'info' },
  { group: 'IN_PROGRESS', label: 'In Progress', tone: 'info' },
  { group: 'NEEDS_ATTENTION', label: 'Need Amendment / Rejected', tone: 'danger' },
  { group: 'COMPLETED', label: 'Completed', tone: 'success' },
];

export const OPERATIONAL_SESSION_SCOPE_LABELS: Record<OperationalSessionScope, string> = {
  SAVR: 'SAVR',
  SAVT: 'SAVT',
  PENCAWANG: 'Pencawang',
  FEEDER_PILLAR: 'Feeder Pillar',
  CABLE_BRIDGE: 'Cable Bridge',
  LINK_BOX: 'Link Box',
};

const STATUS_LABELS: Record<OperationalSessionStatus, string> = {
  DRAFT: 'Draft',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  QA_REVIEW: 'QA Review',
  AMENDMENT_REQUIRED: 'Amendment Required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

const EMPTY_PROGRESS: OperationalSessionProgress = {
  totalAssets: 0,
  completedAssets: 0,
  completionPercentage: 0,
};

export function getOperationalSessionGroup(
  status: OperationalSessionStatus,
  showFinalItems: boolean,
): OperationalSessionGroupKey | null {
  if (status === 'DRAFT' || status === 'ASSIGNED') {
    return 'ASSIGNED';
  }

  if (status === 'IN_PROGRESS' || status === 'SUBMITTED' || status === 'QA_REVIEW') {
    return 'IN_PROGRESS';
  }

  if (status === 'AMENDMENT_REQUIRED' || status === 'REJECTED') {
    return 'NEEDS_ATTENTION';
  }

  if (status === 'APPROVED' && showFinalItems) {
    return 'COMPLETED';
  }

  return null;
}

export function formatOperationalSessionScope(scope: OperationalSessionScope) {
  return OPERATIONAL_SESSION_SCOPE_LABELS[scope] ?? scope;
}

export function formatOperationalSessionStatus(status: OperationalSessionStatus) {
  return STATUS_LABELS[status] ?? status;
}

export function getOperationalSessionStatusTone(
  status: OperationalSessionStatus,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'APPROVED') {
    return 'success';
  }

  if (status === 'AMENDMENT_REQUIRED' || status === 'REJECTED') {
    return 'danger';
  }

  if (status === 'IN_PROGRESS') {
    return 'warning';
  }

  if (status === 'SUBMITTED' || status === 'QA_REVIEW' || status === 'ASSIGNED') {
    return 'info';
  }

  return 'neutral';
}

export function getOperationalSessionMetadataSummary(session: OperationalSession) {
  const metadata = isMetadataRecord(session.metadata) ? session.metadata : null;

  if (metadata) {
    if (session.scope === 'SAVR') {
      const pencawang = getMetadataText(metadata, ['pencawang', 'pencawangName']);

      if (pencawang) {
        return pencawang;
      }
    }

    if (session.scope === 'SAVT') {
      const fromPencawang = getMetadataText(metadata, ['fromPencawang', 'fromPencawangName']);
      const toPencawang = getMetadataText(metadata, ['toPencawang', 'toPencawangName']);

      if (fromPencawang && toPencawang) {
        return `${fromPencawang} to ${toPencawang}`;
      }

      if (fromPencawang || toPencawang) {
        return fromPencawang ?? toPencawang ?? 'Route not set';
      }
    }

    const assetReference = getMetadataText(metadata, [
      'assetReference',
      'assetRef',
      'assetCode',
      'assetName',
    ]);

    if (assetReference) {
      return assetReference;
    }

    const fallback = Object.values(metadata)
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
      .slice(0, 2)
      .join(' / ');

    if (fallback) {
      return fallback;
    }
  }

  return session.branch?.name ?? session.mainhead?.name ?? 'Location not set';
}

export function getOperationalSessionProgress(session: OperationalSession) {
  return session.progress ?? EMPTY_PROGRESS;
}

export function getOperationalSessionProgressLabel(session: OperationalSession) {
  const progress = getOperationalSessionProgress(session);

  return `${progress.completedAssets}/${progress.totalAssets} assets - ${progress.completionPercentage}%`;
}

export function getOperationalSessionAssignedQaLabel(session: OperationalSession) {
  return session.assignedQaUser?.name ?? session.assignedQaUser?.email ?? 'QA/QC not assigned';
}

export function getOperationalSessionCompanyLabel(session: OperationalSession) {
  return session.assignedCompany?.name ?? session.assignedCompanyId;
}

export function formatSessionDate(value?: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString();
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getMetadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
