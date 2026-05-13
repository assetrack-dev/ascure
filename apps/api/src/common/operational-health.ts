import {
  SiteVisitStatus,
  SiteVisitValidationStatus,
} from '@prisma/client';

export type OperationalHealthStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export const DEFAULT_OPERATIONAL_VISIT_OVERDUE_HOURS = 24;
const OPERATIONAL_WARNING_RATIO = 0.75;

const ACTIVE_SITE_VISIT_STATUSES = new Set<SiteVisitStatus>([
  SiteVisitStatus.ACTIVE,
  SiteVisitStatus.OPEN,
  SiteVisitStatus.IN_PROGRESS,
]);

export function parseOperationalOverdueThresholdHours(value?: string | null) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_OPERATIONAL_VISIT_OVERDUE_HOURS;
  }

  return parsedValue;
}

export function isActiveSiteVisitStatus(status: SiteVisitStatus) {
  return ACTIVE_SITE_VISIT_STATUSES.has(status);
}

export function isSiteVisitOverdue({
  status,
  startedAt,
  now,
  overdueThresholdHours,
}: {
  status: SiteVisitStatus;
  startedAt: Date;
  now: Date;
  overdueThresholdHours: number;
}) {
  if (!isActiveSiteVisitStatus(status)) {
    return false;
  }

  return hoursBetween(startedAt, now) >= overdueThresholdHours;
}

export function calculateOperationalHealthStatus({
  status,
  validationStatus,
  startedAt,
  lastActivityAt,
  now,
  overdueThresholdHours,
}: {
  status: SiteVisitStatus;
  validationStatus?: SiteVisitValidationStatus | null;
  startedAt: Date;
  lastActivityAt?: Date | null;
  now: Date;
  overdueThresholdHours: number;
}): OperationalHealthStatus {
  if (validationStatus === SiteVisitValidationStatus.FAILED) {
    return 'CRITICAL';
  }

  if (
    isSiteVisitOverdue({
      status,
      startedAt,
      now,
      overdueThresholdHours,
    })
  ) {
    return 'CRITICAL';
  }

  if (
    status === SiteVisitStatus.CANCELLED ||
    validationStatus === SiteVisitValidationStatus.WARNING ||
    (status === SiteVisitStatus.COMPLETED &&
      validationStatus === SiteVisitValidationStatus.PENDING)
  ) {
    return 'WARNING';
  }

  if (isActiveSiteVisitStatus(status)) {
    const warningThresholdHours =
      overdueThresholdHours * OPERATIONAL_WARNING_RATIO;
    const elapsedHours = hoursBetween(startedAt, now);
    const idleHours = lastActivityAt
      ? hoursBetween(lastActivityAt, now)
      : elapsedHours;

    if (
      elapsedHours >= warningThresholdHours ||
      idleHours >= warningThresholdHours
    ) {
      return 'WARNING';
    }
  }

  return 'HEALTHY';
}

function hoursBetween(startDate: Date, endDate: Date) {
  return (endDate.getTime() - startDate.getTime()) / (60 * 60 * 1000);
}
