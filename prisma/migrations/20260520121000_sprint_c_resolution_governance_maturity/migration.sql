-- Sprint C: preserve resolution outcome history as explicit timeline metadata.
ALTER TYPE "DefectTimelineEventType" ADD VALUE 'RESOLUTION_OUTCOME_UPDATED';

ALTER TABLE "DefectTimelineEntry"
ADD COLUMN "fromResolutionOutcome" "DefectResolutionOutcome",
ADD COLUMN "toResolutionOutcome" "DefectResolutionOutcome";
