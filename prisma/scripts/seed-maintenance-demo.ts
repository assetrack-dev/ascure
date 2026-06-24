/**
 * Local-only demo data for the maintenance workspace (#2). Creates one SUBMITTED
 * inspection under an existing Pencawang whose failed items carry the three
 * work-types + one emergency, then materializes the defects so the workspace
 * shows a populated package with lanes. Idempotent: re-running reuses the demo
 * asset/visit/inspection and only fills missing defects.
 *
 *   $env:DATABASE_URL='postgresql://postgres:postgres@localhost:5433/ascure?schema=public'
 *   pnpm exec tsx prisma/scripts/seed-maintenance-demo.ts
 *
 * NEVER run against prod.
 */
import { randomUUID } from 'crypto';
import {
  DefectLifecycleStatus,
  DefectSeverity,
  DefectStatus,
  InspectionCompletionStatus,
  InspectionItemResultValue,
  MaintenanceCategory,
  PrismaClient,
  SiteVisitStatus,
} from '@prisma/client';

const DEMO_ASSET_CODE = 'POLE-MTC-DEMO-1';

type SeededItem = {
  label: string;
  category: MaintenanceCategory | null;
  isEmergency: boolean;
  severity: DefectSeverity;
  assignTeam?: boolean;
};

const ITEMS: SeededItem[] = [
  { label: 'Rentis clearance below limit', category: MaintenanceCategory.RENTIS, isEmergency: false, severity: DefectSeverity.MEDIUM },
  { label: 'Pole paint peeling', category: MaintenanceCategory.CAT_TIANG, isEmergency: false, severity: DefectSeverity.LOW, assignTeam: true },
  { label: 'Cracked insulator', category: MaintenanceCategory.SELENGGARAAN, isEmergency: false, severity: DefectSeverity.HIGH },
  { label: 'Loose stay wire', category: MaintenanceCategory.SELENGGARAAN, isEmergency: false, severity: DefectSeverity.MEDIUM },
  { label: 'Conductor down — live', category: MaintenanceCategory.SELENGGARAAN, isEmergency: true, severity: DefectSeverity.CRITICAL },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ select: { id: true } });
    if (!tenant) throw new Error('No tenant found.');
    const tenantId = tenant.id;

    const substation = await prisma.substation.findFirst({ where: { tenantId }, select: { id: true, name: true } });
    if (!substation) throw new Error('No substation found — create a Pencawang first.');

    const assetType = await prisma.assetType.findFirst({ where: { tenantId }, select: { id: true } });
    if (!assetType) throw new Error('No asset type found.');

    const adminUser = await prisma.user.findFirst({ where: { tenantId, role: 'ADMIN' }, select: { id: true } });
    if (!adminUser) throw new Error('No admin user found.');

    const template = await prisma.inspectionTemplate.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!template) throw new Error('No inspection template found.');

    const mainhead = await prisma.mainhead.findFirst({ select: { id: true } });

    let team = await prisma.team.findFirst({ where: { tenantId, code: 'MTC-DEMO' }, select: { id: true } });
    if (!team) {
      team = await prisma.team.create({ data: { tenantId, code: 'MTC-DEMO', name: 'Pasukan Selenggara Demo' }, select: { id: true } });
    }

    let asset = await prisma.asset.findFirst({ where: { tenantId, assetCode: DEMO_ASSET_CODE }, select: { id: true } });
    if (!asset) {
      asset = await prisma.asset.create({
        data: { tenantId, substationId: substation.id, assetTypeId: assetType.id, assetCode: DEMO_ASSET_CODE, name: 'Maintenance demo pole', latitude: 3.139, longitude: 101.6869 },
        select: { id: true },
      });
    }

    let siteVisit = await prisma.siteVisit.findFirst({ where: { tenantId, substationId: substation.id, teamId: team.id, notes: 'MTC_DEMO' }, select: { id: true } });
    if (!siteVisit) {
      siteVisit = await prisma.siteVisit.create({
        data: { tenantId, teamId: team.id, substationId: substation.id, createdByUserId: adminUser.id, mainheadId: mainhead?.id ?? null, status: SiteVisitStatus.COMPLETED, notes: 'MTC_DEMO' },
        select: { id: true },
      });
    }

    let inspection = await prisma.inspection.findFirst({ where: { tenantId, assetId: asset.id, siteVisitId: siteVisit.id }, select: { id: true } });
    if (!inspection) {
      inspection = await prisma.inspection.create({
        data: { tenantId, siteVisitId: siteVisit.id, assetId: asset.id, templateId: template.id, createdByUserId: adminUser.id, completionStatus: InspectionCompletionStatus.SUBMITTED, submittedAt: new Date() },
        select: { id: true },
      });
    }

    const now = new Date();
    let created = 0;
    for (const item of ITEMS) {
      const existing = await prisma.inspectionItemResult.findFirst({ where: { inspectionId: inspection.id, label: item.label }, select: { id: true, defect: { select: { id: true } } } });
      let itemResultId = existing?.id;
      if (!itemResultId) {
        const itemResult = await prisma.inspectionItemResult.create({
          data: {
            inspectionId: inspection.id,
            label: item.label,
            result: InspectionItemResultValue.FAIL,
            isDefect: true,
            isEmergency: item.isEmergency,
            severity: item.severity,
            maintenanceCategory: item.category,
          },
          select: { id: true },
        });
        itemResultId = itemResult.id;
      }

      const hasDefect = existing?.defect?.id;
      if (!hasDefect) {
        await prisma.defect.create({
          data: {
            id: randomUUID(),
            inspectionItemResultId: itemResultId,
            status: DefectStatus.OPEN,
            severity: item.isEmergency ? DefectSeverity.CRITICAL : item.severity,
            maintenanceCategory: item.category ?? MaintenanceCategory.SELENGGARAAN,
            isEmergency: item.isEmergency,
            lifecycleStatus: item.assignTeam ? DefectLifecycleStatus.ASSIGNED : DefectLifecycleStatus.VERIFIED,
            assignedToTeamId: item.assignTeam ? team.id : null,
            assignedTeamId: item.assignTeam ? team.id : null,
            assignedAt: item.assignTeam ? now : null,
            createdAt: now,
            updatedAt: now,
          },
        });
        created += 1;
      }
    }

    console.log(`Demo ready under Pencawang "${substation.name}": ${ITEMS.length} items, ${created} new defects (asset ${DEMO_ASSET_CODE}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
