-- Governance G4 — detach Branch from Project.
-- Projects are scoped by Organization -> Operational Region -> MAINHEAD and no
-- longer require (or auto-create) a Branch. Make Project.branchId optional and
-- switch the foreign key to ON DELETE SET NULL so removing a legacy Branch can
-- never cascade-delete a Project. Existing branchId values are preserved.

ALTER TABLE "Project" ALTER COLUMN "branchId" DROP NOT NULL;

ALTER TABLE "Project" DROP CONSTRAINT "Project_branchId_fkey";

ALTER TABLE "Project" ADD CONSTRAINT "Project_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
