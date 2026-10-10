import { INestApplication } from '@nestjs/common';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Materials used per repaired Kejanggalan (TNB feedback #1, 2026-10-11).
 * Owner rules: optional; the crew or the contractor office may set / correct
 * them at any time (even after TNB verification); another company may not.
 * Whole numbers for EA / UNT / SET, up to 3 decimals for M / KG.
 */
const M = {
  sub: '30000000-0000-4000-8000-0000000c1801',
  visit: '60000000-0000-4000-8000-0000000c1801',
  asset: '70000000-0000-4000-8000-0000000c1801',
  inspection: '80000000-0000-4000-8000-0000000c1801',
  item: '90000000-0000-4000-8000-0000000c1801',
  defect: 'a0000000-0000-4000-8000-0000000c1801',
  material: {
    clamp: 'c0000000-0000-4000-8000-0000000c1801',
    cable: 'c0000000-0000-4000-8000-0000000c1802',
    retired: 'c0000000-0000-4000-8000-0000000c1803',
  },
};

describe('Maintenance materials per Kejanggalan (TNB feedback #1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const token: Record<string, string> = {};

  const put = (who: string, items: Array<{ materialId: string; quantity: number }>) =>
    http(app, token[who]).put(`/api/v1/maintenance-materials/defects/${M.defect}`).send({ items });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const t = IDS.tenant.t1;

    await prisma.materialCatalogItem.createMany({
      data: [
        { id: M.material.clamp, catalogueNo: 'T-11075084', description: 'CLAMP,ABC DEAD END,25-16MMP', unit: 'EA', sortOrder: 1 },
        { id: M.material.cable, catalogueNo: 'T-11075073', description: 'CONDUCTOR,ABC,LV,3X16+25MMP', unit: 'M', sortOrder: 2 },
        { id: M.material.retired, catalogueNo: 'T-RETIRED', description: 'OLD ITEM', unit: 'EA', sortOrder: 3, isActive: false },
      ],
    });
    await prisma.substation.create({ data: { id: M.sub, tenantId: t, name: 'Materials PE', code: 'MAT-1' } });
    await prisma.siteVisit.create({
      data: {
        id: M.visit,
        tenantId: t,
        teamId: IDS.team.a,
        substationId: M.sub,
        createdByUserId: IDS.user.mgrA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'LAPORAN_SELESAI',
        laporanSelesaiAt: new Date(),
      },
    });
    await prisma.asset.create({
      data: { id: M.asset, tenantId: t, assetCode: 'MAT-POLE-1', substationId: M.sub, assetTypeId: IDS.assetType.savr },
    });
    await prisma.inspection.create({
      data: {
        id: M.inspection,
        tenantId: t,
        assetId: M.asset,
        siteVisitId: M.visit,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
    await prisma.inspectionItemResult.create({
      data: { id: M.item, inspectionId: M.inspection, label: 'IPC - KESAN BAKAR', result: 'FAIL', isDefect: true, severity: 'HIGH' },
    });
    await prisma.defect.create({
      data: {
        id: M.defect,
        inspectionItemResultId: M.item,
        status: 'OPEN',
        severity: 'HIGH',
        lifecycleStatus: 'ASSIGNED',
        maintenanceCategory: 'SELENGGARAAN',
        maintenanceOrganizationId: IDS.org.a,
        assignedToTeamId: IDS.team.a,
        assignedTeamId: IDS.team.a,
      },
    });
    await prisma.maintenancePackage.create({
      data: { tenantId: t, siteVisitId: M.visit, maintenanceOrganizationId: IDS.org.a, assignedTeamId: IDS.team.a },
    });

    token.techA = await login(app, EMAILS.techA);
    token.mgrA = await login(app, EMAILS.mgrA);
    token.mgrB = await login(app, EMAILS.mgrB);
    token.admin = await login(app, EMAILS.adminT1);
  });

  afterAll(async () => {
    await prisma.defectMaterial.deleteMany({ where: { defectId: M.defect } });
    await prisma.maintenancePackage.deleteMany({ where: { siteVisitId: M.visit } });
    await prisma.defect.deleteMany({ where: { id: M.defect } });
    await prisma.inspectionItemResult.deleteMany({ where: { id: M.item } });
    await prisma.inspection.deleteMany({ where: { id: M.inspection } });
    await prisma.siteVisit.deleteMany({ where: { id: M.visit } });
    await prisma.asset.deleteMany({ where: { id: M.asset } });
    await prisma.substation.deleteMany({ where: { id: M.sub } });
    await prisma.materialCatalogItem.deleteMany({ where: { id: { in: Object.values(M.material) } } });
    await app?.close();
  });

  it('the catalogue lists active materials only, in TNB order', async () => {
    const res = await http(app, token.techA).get('/api/v1/maintenance-materials/catalog').expect(200);
    const ids = res.body.map((row: { id: string }) => row.id);
    expect(ids).toEqual(expect.arrayContaining([M.material.clamp, M.material.cable]));
    expect(ids).not.toContain(M.material.retired);
    expect(ids.indexOf(M.material.clamp)).toBeLessThan(ids.indexOf(M.material.cable));
  });

  it('the crew records materials; the work pack shows them and ships the catalogue', async () => {
    const res = await put('techA', [
      { materialId: M.material.clamp, quantity: 2 },
      { materialId: M.material.cable, quantity: 12.5 },
    ]).expect(200);
    expect(res.body.materials).toEqual([
      { materialId: M.material.clamp, catalogueNo: 'T-11075084', description: 'CLAMP,ABC DEAD END,25-16MMP', unit: 'EA', quantity: 2 },
      { materialId: M.material.cable, catalogueNo: 'T-11075073', description: 'CONDUCTOR,ABC,LV,3X16+25MMP', unit: 'M', quantity: 12.5 },
    ]);

    const pack = await http(app, token.techA).get(`/api/v1/maintenance-work/${M.visit}`).expect(200);
    const item = pack.body.poles[0].kejanggalan[0];
    expect(item.materials).toHaveLength(2);
    expect(pack.body.materialCatalog.map((row: { id: string }) => row.id)).toContain(M.material.clamp);
  });

  it('rejects bad lines: fractional EA, zero, a repeat, an unknown or retired material', async () => {
    await put('techA', [{ materialId: M.material.clamp, quantity: 1.5 }]).expect(400);
    await put('techA', [{ materialId: M.material.cable, quantity: 0 }]).expect(400);
    await put('techA', [{ materialId: M.material.cable, quantity: 1.2345 }]).expect(400);
    await put('techA', [
      { materialId: M.material.clamp, quantity: 1 },
      { materialId: M.material.clamp, quantity: 1 },
    ]).expect(400);
    await put('techA', [{ materialId: 'c0000000-0000-4000-8000-0000000c18ff', quantity: 1 }]).expect(400);
    await put('techA', [{ materialId: M.material.retired, quantity: 1 }]).expect(400);
  });

  it('another company cannot touch them', async () => {
    await put('mgrB', [{ materialId: M.material.clamp, quantity: 9 }]).expect(403);
  });

  it('the claim summary has the three views for the repair date range, scoped to the company', async () => {
    await prisma.defect.update({ where: { id: M.defect }, data: { maintainedAt: new Date('2026-10-05T03:00:00Z') } });
    const download = (who: string, query: string) =>
      http(app, token[who])
        .get(`/api/v1/maintenance-materials/summary.xlsx?${query}`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    const res = await download('mgrA', 'from=2026-10-01&to=2026-10-31').expect(200);
    expect(res.headers['content-disposition']).toContain('Ringkasan_Bahan_2026-10-01_2026-10-31.xlsx');
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    await workbook.xlsx.load(res.body as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Per Pencawang', 'Jumlah Tempoh', 'Butiran Kejanggalan']);
    const values = (name: string) =>
      (workbook.getWorksheet(name)!.getSheetValues() as unknown[][]).slice(4).map((row) => row.slice(1));
    expect(values('Per Pencawang')).toEqual([
      ['Company A', '', 'Materials PE', 'T-11075084', 'CLAMP,ABC DEAD END,25-16MMP', 'EA', 2],
      ['Company A', '', 'Materials PE', 'T-11075073', 'CONDUCTOR,ABC,LV,3X16+25MMP', 'M', 12.5],
    ]);
    expect(values('Jumlah Tempoh').map((row) => [row[1], row[4], row[5]])).toEqual([
      ['T-11075084', 2, 1],
      ['T-11075073', 12.5, 1],
    ]);
    expect(values('Butiran Kejanggalan')).toHaveLength(2);
    expect(values('Butiran Kejanggalan')[0]).toEqual(
      expect.arrayContaining(['MAT-POLE-1', 'Selenggaraan', 'IPC - KESAN BAKAR', '2026-10-05', 'Menunggu pengesahan']),
    );

    // Outside the range → nothing; another company → nothing; a technician → 403.
    const outside = await download('mgrA', 'from=2026-11-01&to=2026-11-30').expect(200);
    const empty = new Workbook();
    await empty.xlsx.load(outside.body as never);
    expect(empty.getWorksheet('Butiran Kejanggalan')!.getCell('A4').value).toMatch(/Tiada bahan/);
    const other = await download('mgrB', 'from=2026-10-01&to=2026-10-31').expect(200);
    const otherBook = new Workbook();
    await otherBook.xlsx.load(other.body as never);
    expect(otherBook.getWorksheet('Per Pencawang')!.getCell('A4').value).toMatch(/Tiada bahan/);
    await http(app, token.techA).get('/api/v1/maintenance-materials/summary.xlsx').expect(403);
  });

  it('the office corrects them any time — even after TNB verification — and the defect detail shows them', async () => {
    await prisma.defect.update({ where: { id: M.defect }, data: { lifecycleStatus: 'CLOSED', status: 'CLOSED' } });
    const res = await put('mgrA', [{ materialId: M.material.clamp, quantity: 3 }]).expect(200);
    expect(res.body.materials).toEqual([expect.objectContaining({ materialId: M.material.clamp, quantity: 3 })]);

    const detail = await http(app, token.admin).get(`/api/v1/defects/${M.defect}`).expect(200);
    expect(detail.body.materials).toEqual([expect.objectContaining({ catalogueNo: 'T-11075084', quantity: 3 })]);

    // An empty list clears them.
    await put('admin', []).expect(200);
    expect(await prisma.defectMaterial.count({ where: { defectId: M.defect } })).toBe(0);
  });
});
