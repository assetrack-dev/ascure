-- CreateTable
CREATE TABLE "MaterialCatalogItem" (
    "id" UUID NOT NULL,
    "catalogueNo" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectMaterial" (
    "id" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCatalogItem_catalogueNo_key" ON "MaterialCatalogItem"("catalogueNo");

-- CreateIndex
CREATE INDEX "MaterialCatalogItem_isActive_sortOrder_idx" ON "MaterialCatalogItem"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "DefectMaterial_materialId_idx" ON "DefectMaterial"("materialId");

-- CreateIndex
CREATE INDEX "DefectMaterial_updatedByUserId_idx" ON "DefectMaterial"("updatedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectMaterial_defectId_materialId_key" ON "DefectMaterial"("defectId", "materialId");

-- AddForeignKey
ALTER TABLE "DefectMaterial" ADD CONSTRAINT "DefectMaterial_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "Defect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectMaterial" ADD CONSTRAINT "DefectMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "MaterialCatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectMaterial" ADD CONSTRAINT "DefectMaterial_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- TNB material list "LIST BARANG IMBANGAN TNB — SAVR" (TNB feedback #1, 2026-10-11),
-- from prisma/seeds/tnb-materials-savr.csv. Re-runnable: existing catalogue numbers are kept.
INSERT INTO "MaterialCatalogItem" ("id", "catalogueNo", "description", "unit", "sortOrder", "isActive", "updatedAt") VALUES
  (gen_random_uuid(), '11074158', 'BOX,JUNCTION,LV', 'EA', 1, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074160', 'BOX,JUNCTION,BASE', 'EA', 2, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11131087', 'WALL SUPPORT', 'UNT', 3, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11131088', 'BRACKET.TWO LEGGED', 'UNT', 4, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074210', 'NEUTRAL LINK,LV,100A', 'EA', 5, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074290', 'INSULATOR,SHACKLE', 'EA', 6, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11132500', 'FUSE,LV,DIN,NH-000,32AMPS', 'EA', 7, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11132501', 'FUSE,LV,DIN,NH-2,200AMPS', 'EA', 8, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11132466', 'FUSE,LV,DIN,NH-000,63AMPS', 'EA', 9, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11130049', 'FUSE,SWITCH DISCONNECTOR,LV,CUT OUT,100A', 'UNT', 10, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074068', 'ARRESTER,LIGHTNING,LV', 'EA', 11, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074500', 'FUSE SWITCH,LV,400AMPS (3X1 POLE)', 'EA', 12, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074499', 'FUSE SWITCH,LV,160AMPS (3X1 POLE)', 'EA', 13, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074508', 'FUSE,LV,DIN,NH-1,200AMPS', 'EA', 14, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074507', 'FUSE,LV,DIN,NH-1,160AMPS', 'EA', 15, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074505', 'FUSE,LV,DIN,NH-00,100AMPS', 'EA', 16, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074526', 'FUSE,TIME LAG,FOR RMU SF6,5AMP', 'SET', 17, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074527', 'FUSE,TIME LAG,FOR RMU SF6,7.5AMP', 'SET', 18, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075055', 'CONDUCTOR,PVC,AL,1C,2.5MMP (3/.044")', 'M', 19, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075057', 'CONDUCTOR,PVC,AL,1C,25MMP (7/.083)', 'M', 20, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075058', 'CONDUCTOR,PVC,AL,1C,35MMP (19/.064)', 'M', 21, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075072', 'CONDUCTOR,ABC,LV,1X16+25MMP', 'M', 22, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075073', 'CONDUCTOR,ABC,LV,3X16+25MMP', 'M', 23, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075080', 'CONDUCTOR,ABC,LV,3X95+70+16MMP', 'M', 24, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075081', 'CONDUCTOR,ABC,LV,3X185+120+16MMP', 'M', 25, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075084', 'CLAMP,ABC DEAD END,25-16MMP', 'EA', 26, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075087', 'CLAMP,ABC DEAD END,70MMP', 'EA', 27, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075088', 'CLAMP,ABC DEAD END,120MMP', 'EA', 28, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075099', 'CLAMP,ABC SUSPENSION,25-120MM2', 'SET', 29, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075119', 'TUBE,ABC DEAD END,16-25MM2', 'EA', 30, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075097', 'TUBE,ABC DEAD END,95-70MMP', 'EA', 31, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075096', 'TUBE,ABC DEAD END,185-120MMP', 'EA', 32, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075100', 'HOOK,ABC SUSPENSION,LV', 'EA', 33, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11117106', 'Q-HOOK,FOR SERVICE CABLE', 'EA', 34, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11084859', 'IPC,ABC,MAIN 16-70MM2 T/O 1.5-6MM2', 'EA', 35, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11084891', 'IPC,ABC,MAIN 70-185MM2 T/O 1.5-6MM2', 'EA', 36, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075109', 'IPC,ABC,MAIN 70-95MM2 T/O 70-95MM2', 'EA', 37, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075113', 'IPC,ABC,MAIN 16-95MM2 T/O 16-25MM2', 'EA', 38, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11135912', 'IPC,ABC,MAIN 70-95MM2 T/O 6-35MM2', 'EA', 39, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11135914', 'IPC,ABC,MAIN 120-185MM2 T/O 6-35MM2', 'EA', 40, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075115', 'IPC,ABC,MAIN 120-185MM2 T/O 16-25MM2', 'EA', 41, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075116', 'IPC,ABC,MAIN 120-185MM2 T/O 70-185MM2', 'EA', 42, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075152', 'IPC,BARE-ABC/PVC,MAIN 25-50 T/O 16-70', 'EA', 43, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075153', 'IPC,BARE-ABC/PVC,MAIN 25-100 T/O 95-185', 'EA', 44, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11092497', 'COPPER,CLAD STEEL EARTH ROD ASSEMBLY', 'SET', 45, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075260', 'BRACKET,"D" MILD STEE GALVANISED', 'EA', 46, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075297', 'BAND,UNIVERSAL FOR SPUN POLE,7.5M & 9M', 'EA', 47, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075333', 'POLE,SPUN CONCRETE,7.5M - 2.0KN', 'EA', 48, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075334', 'POLE,SPUN CONCRETE,9.0M - 2.0KN', 'EA', 49, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11131086', 'BLOCK,KICKING', 'UNT', 50, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075241', 'WIRE,STAY,45 TON,SWG 7/12', 'KG', 51, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075242', 'WIRE,STAY,45 TON,SWG 7/10', 'KG', 52, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11138421', 'ROD,STAY,2.5MX19MM DIA', 'EA', 53, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074287', 'INSULATOR,STAY', 'EA', 54, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11138422', 'BOW,WITH THIMBLE,FOR 2.5MX19MM STAY ROD', 'EA', 55, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11138410', 'PLATE,STAY,450X450X6MM,WITH 19MM SQ HOLE', 'EA', 56, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075364', 'THIMBLE,STAY,5/8"', 'EA', 57, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075126', 'CABLE TIE,ABC', 'EA', 58, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075435', 'PVC CASING,2 WIRE COMPLETE WITH 5 CLIP', 'M', 59, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075436', 'PVC CASING,3 WIRE COMPLETE WITH 5 CLIP', 'M', 60, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075437', 'PVC CASING,4 WIRE COMPLETE WITH 5 CLIP', 'M', 61, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11076009', 'BOLT & NUT,GVD. HRH DIA. 5/8" X 4 1/2"', 'EA', 62, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11076013', 'BOLT & NUT,GVD. HRH DIA. 5/8" X 7"', 'EA', 63, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11076015', 'BOLT & NUT,GVD. HRH DIA. 5/8" X 9"', 'EA', 64, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11076018', 'BOLT & NUT,GVD. HRH DIA. 5/8" X 12"', 'EA', 65, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075143', 'CONNECTOR,ABC PRE-INSULATED,16MMP', 'EA', 66, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075144', 'CONNECTOR,ABC PRE-INSULATED,25MMP', 'EA', 67, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075145', 'CONNECTOR,ABC PRE-INSULATED,70MMP', 'EA', 68, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075146', 'CONNECTOR,ABC PRE-INSULATED,95MMP', 'EA', 69, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075147', 'CONNECTOR,ABC PRE-INSULATED,120MMP', 'EA', 70, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11075148', 'CONNECTOR,ABC PRE-INSULATED,185MMP', 'EA', 71, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11126680', 'PRE-INSULATED CON.TRANS JOINT 120-185MMP', 'EA', 72, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11126679', 'PRE-INSULATED CON.TRANS JOINT 95-185MMP', 'EA', 73, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11126675', 'PRE-INSULATED CON.TRANS JOINT 70-120MMP', 'EA', 74, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11126676', 'PRE-INSULATED CON.TRANS JOINT 70-185MMP', 'EA', 75, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11126677', 'PRE-INSULATED CON.TRANS JOINT 95-70MMP', 'EA', 76, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074939', 'INSULATION SLEEVE,5MCABLE,TERM 185/300MM', 'SET', 77, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11087603', 'SLEEVE,INSULATION,5MCABLE,TERM 70/120MMP', 'SET', 78, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074459', 'FUSE,11KV,DIN,50AMP', 'EA', 79, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074461', 'FUSE,11KV,DIN,80AMP', 'EA', 80, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11092223', 'FUSE,11KV,DIN,31.5AMP', 'EA', 81, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074976', 'CABLE END CAP,FOR CABLE DIA. 17 - 30MM', 'SET', 82, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074977', 'CABLE END CAP,FOR CABLE DIA. 28 - 47MM', 'SET', 83, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074978', 'CABLE END CAP,FOR CABLE DIA. 45-65MM', 'SET', 84, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11074979', 'CABLE END CAP,FOR CABLE DIA. 65 - 90MM', 'SET', 85, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11251537', 'CABLE END CAP,FOR CABLE DIA. 16 - 30MM', 'SET', 86, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11251538', 'CABLE END CAP,FOR CABLE DIA. 26 - 48MM', 'SET', 87, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11251539', 'CABLE END CAP,FOR CABLE DIA. 48 - 84MM', 'SET', 88, true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '11251540', 'CABLE END CAP,FOR CABLE DIA. 84 - 110MM', 'SET', 89, true, CURRENT_TIMESTAMP)
ON CONFLICT ("catalogueNo") DO NOTHING;
