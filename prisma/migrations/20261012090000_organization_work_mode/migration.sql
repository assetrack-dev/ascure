-- Plan §17 (L38): per-company web view. Additive; null = unchanged full console.
CREATE TYPE "OrganizationWorkMode" AS ENUM ('SURVEY', 'MAINTENANCE', 'BOTH');

ALTER TABLE "Organization" ADD COLUMN "workMode" "OrganizationWorkMode";
