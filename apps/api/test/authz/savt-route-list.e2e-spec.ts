import { INestApplication } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { createTestApp } from '../utils/test-app';
import { http, login } from '../utils/http';
import { getTestPrisma } from '../utils/prisma';
import { EMAILS, IDS } from '../fixtures/seed-multi-company';

/**
 * SAVT Route list export (savt-route-list.xlsx) — the route analogue of the
 * Pencawang list, built so DC can reconcile HOW MANY POLES each KOD TIANG route
 * carries. The shared seed holds no SAVT work, so this spec seeds a throwaway
 * route (one SAVT visit + two inspected poles) and tears it down — the pole
 * count asserted is therefore exact, not seed-relative.
 */
describe('Reports · SAVT route list export (pole count per route)', () => {
  let app: INestApplication;
  let admin: string;

  const ROUTE_CODE = 'UT 99';
  const VISIT = '6f000000-0000-4000-8000-0000000000f1';
  const POLE_1 = '7f000000-0000-4000-8000-0000000000f1';
  const POLE_2 = '7f000000-0000-4000-8000-0000000000f2';
  const INSPECTION_1 = '8f000000-0000-4000-8000-0000000000f1';
  const INSPECTION_2 = '8f000000-0000-4000-8000-0000000000f2';

  beforeAll(async () => {
    app = await createTestApp();
    admin = await login(app, EMAILS.adminT1);

    const prisma = getTestPrisma();
    await prisma.siteVisit.create({
      data: {
        id: VISIT,
        tenantId: IDS.tenant.t1,
        teamId: IDS.team.a,
        substationId: IDS.substation.s1,
        createdByUserId: IDS.user.techA,
        organizationId: IDS.org.a,
        status: 'ACTIVE',
        lifecycleStatus: 'DALAM_RONDAAN',
        operationalScope: 'SAVT',
        routeCode: ROUTE_CODE,
        fromPencawangId: IDS.substation.s1,
        mainhead: 'UJIAN MAINHEAD',
      },
    });
    await prisma.asset.createMany({
      data: [POLE_1, POLE_2].map((id, index) => ({
        id,
        tenantId: IDS.tenant.t1,
        substationId: IDS.substation.s1,
        assetTypeId: IDS.assetType.savr,
        assetCode: `${ROUTE_CODE} A ${index + 1}`,
        name: `SAVT pole ${index + 1}`,
        createdDuringVisitId: VISIT,
        createdByUserId: IDS.user.techA,
      })),
    });
    await prisma.inspection.createMany({
      data: [
        { id: INSPECTION_1, assetId: POLE_1 },
        { id: INSPECTION_2, assetId: POLE_2 },
      ].map(({ id, assetId }) => ({
        id,
        tenantId: IDS.tenant.t1,
        siteVisitId: VISIT,
        assetId,
        templateId: IDS.template.tmpl,
        createdByUserId: IDS.user.techA,
        completionStatus: 'SUBMITTED',
        submittedAt: new Date(),
      })),
    });
  });

  afterAll(async () => {
    const prisma = getTestPrisma();
    await prisma.inspection.deleteMany({
      where: { id: { in: [INSPECTION_1, INSPECTION_2] } },
    });
    await prisma.asset.deleteMany({ where: { id: { in: [POLE_1, POLE_2] } } });
    await prisma.siteVisit.deleteMany({ where: { id: VISIT } });
    await app?.close();
  });

  async function downloadRows(query = ''): Promise<string[][]> {
    const res = await http(app, admin)
      .get(`/api/v1/reports/savt-route-list.xlsx${query}`)
      .expect(200)
      .expect(
        'Content-Type',
        /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
      )
      .responseType('blob');
    const workbook = new Workbook();
    await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('SAVT ROUTES');
    expect(sheet).toBeDefined();
    const rows: string[][] = [];
    sheet!.eachRow((row) => {
      rows.push(
        (row.values as unknown[]).slice(1).map((cell) => String(cell ?? '')),
      );
    });
    return rows;
  }

  it('exports the route with its exact pole count', async () => {
    const rows = await downloadRows();
    expect(rows[0]).toEqual([
      'No',
      'Route (KOD TIANG)',
      'From Pencawang',
      'To Pencawang',
      'Mainhead',
      'Latitude',
      'Longitude',
      'Number of Poles',
      'Start Survey Date',
      'Status',
    ]);
    const routeRow = rows.find((row) => row[1] === ROUTE_CODE);
    expect(routeRow).toBeDefined();
    expect(routeRow![7]).toBe('2'); // both inspected poles, counted once each
    expect(routeRow![4]).toBe('UJIAN MAINHEAD');
    expect(routeRow![9]).not.toBe(''); // unified survey status present
  });

  it('ids filter narrows to the selected route codes only', async () => {
    const rows = await downloadRows(
      `?ids=${encodeURIComponent(`${ROUTE_CODE},NO SUCH ROUTE`)}`,
    );
    expect(rows).toHaveLength(2); // header + exactly the one matching route
    expect(rows[1][1]).toBe(ROUTE_CODE);
  });
});
