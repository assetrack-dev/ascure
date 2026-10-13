-- Plan §19 (N55): TNB Supervisor rank + the contractor companies they handle. Additive.
ALTER TYPE "ClientRank" ADD VALUE 'SUPERVISOR';

CREATE TABLE "ClientCompanyAccess" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCompanyAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientCompanyAccess_userId_organizationId_key" ON "ClientCompanyAccess"("userId", "organizationId");
CREATE INDEX "ClientCompanyAccess_organizationId_idx" ON "ClientCompanyAccess"("organizationId");

ALTER TABLE "ClientCompanyAccess" ADD CONSTRAINT "ClientCompanyAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCompanyAccess" ADD CONSTRAINT "ClientCompanyAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
