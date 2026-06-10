/**
 * Prefix stamped on `SiteVisit.reportingGroup` and `Inspection.reportingGroup`
 * for AppSheet masterlist imports — i.e. foundation / baseline data, typically a
 * prior year's inspection brought in as the Year-1 register.
 *
 * The defect materializer uses this marker to keep imported defects as
 * *historical observations* (recorded on the archived survey) rather than
 * promoting them to live maintenance work. The annual re-survey is the source of
 * truth for current condition (north-star §1 "provable"): a defect cleared by an
 * untracked third party can't be proven fixed — so we don't assert it, we
 * re-observe it next cycle.
 */
export const APPSHEET_IMPORT_REPORTING_GROUP_PREFIX = 'APPSHEET:';

export function buildAppsheetReportingGroup(batchId: string): string {
  return `${APPSHEET_IMPORT_REPORTING_GROUP_PREFIX}${batchId}`;
}

export function isAppsheetImportReportingGroup(
  reportingGroup: string | null | undefined,
): boolean {
  return (
    typeof reportingGroup === 'string' &&
    reportingGroup.startsWith(APPSHEET_IMPORT_REPORTING_GROUP_PREFIX)
  );
}
