ALTER TABLE "SiteVisit"
  ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "SiteVisit_completedAt_idx" ON "SiteVisit"("completedAt");
