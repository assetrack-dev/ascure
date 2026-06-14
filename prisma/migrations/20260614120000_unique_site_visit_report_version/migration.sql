-- Make the compiled-report version unique per site visit so concurrent report
-- generation can never persist two rows with the same (siteVisitId, version)
-- (one writer wins, the loser's transaction rolls back).
DROP INDEX "SiteVisitReport_siteVisitId_version_idx";

CREATE UNIQUE INDEX "SiteVisitReport_siteVisitId_version_key" ON "SiteVisitReport"("siteVisitId", "version");
