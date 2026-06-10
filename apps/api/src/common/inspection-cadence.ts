/**
 * The annual re-survey is a *legal* cadence (north-star §1 "perpetual"), so the
 * meaningful thing about a survey isn't an abstract "Cycle N" — it's **when the
 * Pencawang was last inspected and how overdue it now is**. This describes that
 * recency against a configurable statutory interval (default 12 months).
 */
export type SurveyDueStatus = 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' | 'UNKNOWN';

export interface InspectionRecency {
  lastInspectedAt: string | null;
  monthsSince: number | null;
  intervalMonths: number;
  status: SurveyDueStatus;
}

const AVG_DAYS_PER_MONTH = 30.44;

export function getAnnualSurveyIntervalMonths(): number {
  const raw = Number(process.env.ANNUAL_SURVEY_INTERVAL_MONTHS);
  return Number.isFinite(raw) && raw > 0 ? raw : 12;
}

export function describeInspectionRecency(
  lastInspectedAt: Date | null,
  now: Date,
): InspectionRecency {
  const intervalMonths = getAnnualSurveyIntervalMonths();

  if (!lastInspectedAt) {
    return { lastInspectedAt: null, monthsSince: null, intervalMonths, status: 'UNKNOWN' };
  }

  const ms = now.getTime() - lastInspectedAt.getTime();
  const monthsSince = Math.max(
    0,
    Math.round((ms / (AVG_DAYS_PER_MONTH * 24 * 60 * 60 * 1000)) * 10) / 10,
  );

  let status: SurveyDueStatus;
  if (monthsSince >= intervalMonths) {
    status = 'OVERDUE';
  } else if (monthsSince >= intervalMonths - 2) {
    status = 'DUE_SOON';
  } else {
    status = 'ON_TIME';
  }

  return {
    lastInspectedAt: lastInspectedAt.toISOString(),
    monthsSince,
    intervalMonths,
    status,
  };
}
