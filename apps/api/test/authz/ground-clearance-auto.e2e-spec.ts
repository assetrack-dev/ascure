import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';
import { evaluatePencawangGroundClearance } from '../../src/inspections/ground-clearance.apply';

/**
 * Auto "TIDAK PATUH GROUND CLEARANCE" (TNB feedback #3, 2026-10-10) — the QR
 * AUTO rule run inside ASCURE. A SAVR Pencawang with poles 1–2–3 on one feeder:
 * pole 1 is the feeder head (its reading is never graded), pole 2 reads 4.0 m
 * over a road (TAK PATUH < 5.49), pole 3 reads 6.0 m (PATUH). The survey's
 * report is final and the Pencawang is with Company B, so a new Kejanggalan
 * opens released and lands with Company B.
 */
const P = {
  template: 'b0000000-0000-4000-8000-0000000c1701',
  section: 'b1000000-0000-4000-8000-0000000c1701',
  item: {
    reading: 'b2000000-0000-4000-8000-0000000c1701',
    terrain: 'b2000000-0000-4000-8000-0000000c1702',
    umbang: 'b2000000-0000-4000-8000-0000000c1703',
    catatan: 'b2000000-0000-4000-8000-0000000c1704',
    gc: 'b2000000-0000-4000-8000-0000000c1705',
  },
  sub: '30000000-0000-4000-8000-0000000c1701',
  visit: '60000000-0000-4000-8000-0000000c1701',
  asset: ['70000000-0000-4000-8000-0000000c1701', '70000000-0000-4000-8000-0000000c1702', '70000000-0000-4000-8000-0000000c1703'],
  inspection: ['80000000-0000-4000-8000-0000000c1701', '80000000-0000-4000-8000-0000000c1702', '80000000-0000-4000-8000-0000000c1703'],
};
const ROAD = 'MELINTASI JALAN RAYA';
const READINGS = ['3.0', '4.0', '6.0'];

describe('Auto TIDAK PATUH GROUND CLEARANCE (QR AUTO rule in ASCURE)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const gcState = async (index: number) => {
    const [result, itemResult] = await Promise.all([
      prisma.inspectionResult.findUnique({
        where: { inspectionId_templateItemId: { inspectionId: P.inspection[index], templateItemId: P.item.gc } },
        select: { valueBoolean: true },
      }),
      prisma.inspectionItemResult.findFirst({
        where: { inspectionId: P.inspection[index], checklistItemId: P.item.gc },
        select: { result: true, isDefect: true, remark: true, defect: { select: { lifecycleStatus: true, maintenanceOrganizationId: true } } },
      }),
    ]);
    return { value: result?.valueBoolean ?? null, ...itemResult };
  };
  const editReading = (index: number, value: string) =>
    http(app, token.mgrA)
      .patch(`/api/v1/inspections/${P.inspection[index]}/checklist-result`)
      .send({ columnKey: 'GAMBAR KELEGAAN 1', value, siteVisitId: P.visit })
      .expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.inspectionTemplate.create({
      data: {
        id: P.template,
        tenantId: t,
        assetTypeId: IDS.assetType.savr,
        version: 917,
        name: 'SAVR GC test',
        status: 'ARCHIVED',
        isActive: false,
        scopeLevel: 'GLOBAL',
        sections: { create: [{ id: P.section, title: 'General', sortOrder: 0 }] },
      },
    });
    const item = (id: string, key: string, label: string, inputType: 'OCR' | 'SELECT' | 'TEXT' | 'BOOLEAN', sortOrder: number, extra = {}) =>
      prisma.inspectionTemplateItem.create({
        data: { id, templateId: P.template, sectionId: P.section, key, label, inputType, sortOrder, isDefectTrigger: false, ...extra },
      });
    await item(P.item.reading, 'gambar_kelegaan_1', 'GAMBAR KELEGAAN 1', 'OCR', 0);
    await item(P.item.terrain, 'keadaan_di_tapak_1', 'KEADAAN DI TAPAK 1', 'SELECT', 1, {
      optionsJson: [ROAD, 'BAHU JALAN', 'KAWASAN TIDAK DIMASUKI KENDERAAN'],
    });
    await item(P.item.umbang, 'umbang_terbang', 'UMBANG - TERBANG / SUPPORT POLE', 'TEXT', 2);
    await item(P.item.catatan, 'catitan', 'CATITAN', 'TEXT', 3);
    await item(P.item.gc, 'gc', 'TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE', 'BOOLEAN', 4, {
      isDefectTrigger: true,
      severity: 'HIGH',
      maintenanceCategory: 'SELENGGARAAN',
    });

    await prisma.substation.create({ data: { id: P.sub, tenantId: t, name: 'GC Auto PE', code: 'GC-1' } });
    await prisma.siteVisit.create({
      data: {
        id: P.visit,
        tenantId: t,
        teamId: IDS.team.a,
        substationId: P.sub,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
        laporanSelesaiAt: new Date(),
        operationalScope: 'SAVR',
      },
    });
    await prisma.asset.createMany({
      data: P.asset.map((id, index) => ({
        id,
        tenantId: t,
        assetCode: String(index + 1),
        substationId: P.sub,
        assetTypeId: IDS.assetType.savr,
      })),
    });
    await prisma.inspection.createMany({
      data: P.inspection.map((id, index) => ({
        id,
        tenantId: t,
        assetId: P.asset[index],
        siteVisitId: P.visit,
        templateId: P.template,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED' as const,
        submittedAt: new Date(),
        operationalScope: 'SAVR' as const,
      })),
    });
    await prisma.inspectionResult.createMany({
      data: P.inspection.flatMap((inspectionId, index) => [
        { inspectionId, templateItemId: P.item.reading, valueText: READINGS[index] },
        { inspectionId, templateItemId: P.item.terrain, valueText: ROAD },
      ]),
    });

    token.admin = await login(app, EMAILS.adminT1);
    token.mgrA = await login(app, EMAILS.mgrA);

    // The Pencawang is with Company B (no Kejanggalan yet, so nothing routes now).
    await http(app, token.admin)
      .post('/api/v1/maintenance-packages')
      .send({ siteVisitId: P.visit, maintenanceOrganizationId: IDS.org.b })
      .expect(201);
  });

  afterAll(async () => {
    const itemResults = await prisma.inspectionItemResult.findMany({
      where: { inspectionId: { in: P.inspection } },
      select: { id: true },
    });
    const defects = await prisma.defect.findMany({
      where: { inspectionItemResultId: { in: itemResults.map((row) => row.id) } },
      select: { id: true },
    });
    await prisma.defectTimelineEntry.deleteMany({ where: { defectId: { in: defects.map((row) => row.id) } } });
    await prisma.defect.deleteMany({ where: { id: { in: defects.map((row) => row.id) } } });
    await prisma.inspectionItemResult.deleteMany({ where: { inspectionId: { in: P.inspection } } });
    await prisma.inspectionResult.deleteMany({ where: { inspectionId: { in: P.inspection } } });
    await prisma.inspection.deleteMany({ where: { id: { in: P.inspection } } });
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: P.visit } });
    await prisma.siteVisit.deleteMany({ where: { id: P.visit } });
    await prisma.asset.deleteMany({ where: { id: { in: P.asset } } });
    await prisma.substation.deleteMany({ where: { id: P.sub } });
    await prisma.inspectionTemplateItem.deleteMany({ where: { templateId: P.template } });
    await prisma.inspectionTemplateSection.deleteMany({ where: { templateId: P.template } });
    await prisma.inspectionTemplate.deleteMany({ where: { id: P.template } });
    await app?.close();
  });

  it('dry run: only pole 2 fails (the feeder head is never graded)', async () => {
    const report = await evaluatePencawangGroundClearance(prisma, IDS.tenant.t1, P.sub);
    expect(report.poles).toBe(3);
    expect(report.toSet.map((pole) => pole.code)).toEqual(['2']);
    expect(report.toSet[0].reasons[0]).toMatch(/TAK PATUH \(4\.0 < 5\.49/);
  });

  it('an office reading edit re-grades the Pencawang: poles 2 and 3 flagged, released, with Company B', async () => {
    await editReading(2, '4.2');
    for (const index of [1, 2]) {
      expect(await gcState(index)).toMatchObject({
        value: true,
        result: 'FAIL',
        isDefect: true,
        remark: expect.stringMatching(/^Auto \(ground clearance\)/),
        defect: { lifecycleStatus: 'VERIFIED', maintenanceOrganizationId: IDS.org.b },
      });
    }
    expect((await gcState(0)).value).toBeNull();
    const board = await http(app, token.admin).get('/api/v1/maintenance-packages/board').expect(200);
    const row = board.body.pencawangs.find((pe: { siteVisitId: string }) => pe.siteVisitId === P.visit);
    expect(row.totals.total).toBe(2);
  });

  it('correcting the reading back withdraws the auto flag (pole 3); pole 2 stays', async () => {
    await editReading(2, '6.0');
    expect(await gcState(2)).toMatchObject({ value: false, result: 'PASS', isDefect: false, remark: null, defect: null });
    expect(await gcState(1)).toMatchObject({ value: true, isDefect: true });
  });

  it('an office override of the item itself is respected by later re-grades', async () => {
    await http(app, token.mgrA)
      .patch(`/api/v1/inspections/${P.inspection[1]}/checklist-result`)
      .send({ columnKey: 'TALIAN (UTAMA / SERVIS) - TIDAK PATUH GROUND CLEARANCE', value: 'no', siteVisitId: P.visit })
      .expect(200);
    await editReading(2, '6.1'); // triggers a re-grade
    expect(await gcState(1)).toMatchObject({ value: false, isDefect: false, remark: 'Office override (ground clearance)' });
    const report = await evaluatePencawangGroundClearance(prisma, IDS.tenant.t1, P.sub);
    expect(report.overridden).toBe(1);
    expect(report.toSet).toHaveLength(0);
  });

  it('a support pole (UMBANG TERBANG) is never graded', async () => {
    await prisma.inspectionResult.create({
      data: { inspectionId: P.inspection[2], templateItemId: P.item.umbang, valueText: '1 - UMBANG TERBANG' },
    });
    await editReading(2, '3.0');
    expect(await gcState(2)).toMatchObject({ value: false, isDefect: false });
  });
});
