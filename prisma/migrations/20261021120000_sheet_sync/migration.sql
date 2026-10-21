-- docs/PLAN-google-sheet-repair-sync.md: nightly repair dates into a TNB Google Sheet.

-- CreateTable
CREATE TABLE "SheetSyncTarget" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetTitle" TEXT NOT NULL DEFAULT 'QR03',
    "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SheetSyncTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetSyncCell" (
    "id" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "rowKey" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "writtenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SheetSyncCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SheetSyncRun" (
    "id" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "summary" JSONB,
    "issues" JSONB,
    "triggeredByEmail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SheetSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SheetSyncTarget_tenantId_idx" ON "SheetSyncTarget"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SheetSyncCell_targetId_rowKey_groupKey_key" ON "SheetSyncCell"("targetId", "rowKey", "groupKey");

-- CreateIndex
CREATE INDEX "SheetSyncRun_targetId_startedAt_idx" ON "SheetSyncRun"("targetId", "startedAt");

-- AddForeignKey
ALTER TABLE "SheetSyncCell" ADD CONSTRAINT "SheetSyncCell_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "SheetSyncTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SheetSyncRun" ADD CONSTRAINT "SheetSyncRun_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "SheetSyncTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
